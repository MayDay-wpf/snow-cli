/**
 * SubAgent Live Slot store (useSyncExternalStore compatible).
 *
 * Tracks one live UI slot per sub-agent instance (keyed by agentId).
 * Snapshot rebuilds immediately; listener notifications are throttled (~200ms).
 */

import {sessionManager} from '../../../utils/session/sessionManager.js';

/** Feature flag: when false, keep legacy toolPending message flooding. */
export const SUBAGENT_LIVE_SLOTS_ENABLED = true;

export type SubAgentLiveStatus =
	| 'thinking'
	| 'writing'
	| 'tool_focus'
	| 'multi_pending'
	| 'waiting_user'
	| 'completed'
	| 'error';

export type SubAgentLiveFocus = {
	kind: 'tool' | 'text' | 'status';
	toolCallId?: string;
	toolName?: string;
	title: string;
	startedAt?: number;
	paramsPreview?: string;
};

export type SubAgentLivePendingTool = {
	toolCallId: string;
	toolName: string;
	title: string;
	startedAt: number;
	paramsPreview?: string;
};

export type SubAgentLiveSlot = {
	agentId: string;
	agentName: string;
	status: SubAgentLiveStatus;
	/** Locally estimated streamed output tokens (reasoning/content/tool-call deltas). */
	tokenCount: number;
	startedAt: number;
	/** Frozen wall-clock duration once the agent is terminal (completed/error). */
	durationMs?: number;
	isReasoning: boolean;
	ctxUsage?: {percentage: number; inputTokens: number; maxTokens: number};
	focus?: SubAgentLiveFocus;
	/** Recent focus titles for multi-line display (newest last). */
	historyLines?: string[];
	otherPendingCount: number;
	preview?: string;
	updatedAt: number;
	/** Session that owns this live slot (for multi-session isolation). */
	sessionId?: string;
	/** Project that owns the session (for multi-project isolation). */
	projectId?: string;
};

export type SubAgentLiveSnapshotOptions = {
	sessionId?: string;
	projectId?: string;
	/** When true, return every slot regardless of session/project. */
	all?: boolean;
};

type LiveSlotInternal = SubAgentLiveSlot & {
	pendingTools: Map<string, SubAgentLivePendingTool>;
};

type LiveToolStartInput = {
	agentId: string;
	agentName: string;
	toolCallId: string;
	toolName: string;
	title: string;
	startedAt?: number;
	paramsPreview?: string;
};

type LiveToolEndInput = {
	agentId: string;
	toolCallId: string;
	ok: boolean;
};

type LiveAgentStatusInput = {
	agentId: string;
	agentName: string;
	status: SubAgentLiveStatus;
	tokenCount?: number;
	isReasoning?: boolean;
	preview?: string;
	ctxUsage?: {percentage: number; inputTokens: number; maxTokens: number};
};

const NOTIFY_THROTTLE_MS = 200;

const _slots = new Map<string, LiveSlotInternal>();
const _listeners = new Set<() => void>();
let _allSnapshot: SubAgentLiveSlot[] = [];
/** Default public snapshot: slots for the current session (plus unscoped). */
let _snapshot: SubAgentLiveSlot[] = [];
let _cachedFilterSessionId: string | undefined;
let _notifyTimer: ReturnType<typeof setTimeout> | null = null;

function resolveCurrentSessionScope(): {
	sessionId?: string;
	projectId?: string;
} {
	const session = sessionManager.getCurrentSession();
	return {
		sessionId: session?.id,
		projectId: session?.projectId ?? sessionManager.getProjectId?.(),
	};
}

function matchesLiveSlotFilter(
	slot: SubAgentLiveSlot,
	options?: SubAgentLiveSnapshotOptions,
): boolean {
	if (options?.all) {
		return true;
	}

	const current = resolveCurrentSessionScope();
	const sessionId = options?.sessionId ?? current.sessionId;
	const projectId = options?.projectId ?? current.projectId;

	if (options?.sessionId !== undefined) {
		if (slot.sessionId && slot.sessionId !== options.sessionId) {
			return false;
		}
	} else if (sessionId) {
		if (slot.sessionId && slot.sessionId !== sessionId) {
			return false;
		}
	}

	if (options?.projectId !== undefined) {
		if (slot.projectId && slot.projectId !== options.projectId) {
			return false;
		}
	} else if (projectId && options?.sessionId === undefined) {
		if (slot.projectId && slot.projectId !== projectId) {
			return false;
		}
	}

	return true;
}

function toPublicSlot(slot: LiveSlotInternal): SubAgentLiveSlot {
	return {
		agentId: slot.agentId,
		agentName: slot.agentName,
		status: slot.status,
		tokenCount: slot.tokenCount,
		startedAt: slot.startedAt,
		durationMs: slot.durationMs,
		isReasoning: slot.isReasoning,
		ctxUsage: slot.ctxUsage,
		focus: slot.focus,
		historyLines: slot.historyLines ? [...slot.historyLines] : undefined,
		otherPendingCount: slot.otherPendingCount,
		preview: slot.preview,
		updatedAt: slot.updatedAt,
		sessionId: slot.sessionId,
		projectId: slot.projectId,
	};
}

function computeOtherPendingCount(slot: LiveSlotInternal): number {
	const pendingCount = slot.pendingTools.size;
	if (pendingCount === 0) return 0;
	if (slot.focus?.kind === 'tool' && slot.focus.toolCallId) {
		return Math.max(0, pendingCount - 1);
	}
	return pendingCount;
}

function deriveStatusFromPending(slot: LiveSlotInternal): SubAgentLiveStatus {
	const pendingCount = slot.pendingTools.size;
	if (pendingCount > 1) return 'multi_pending';
	if (pendingCount === 1) return 'tool_focus';
	if (slot.isReasoning) return 'thinking';
	if (slot.preview) return 'writing';
	// Keep prior non-tool status when possible; default to writing.
	if (
		slot.status === 'waiting_user' ||
		slot.status === 'error' ||
		slot.status === 'completed' ||
		slot.status === 'thinking' ||
		slot.status === 'writing'
	) {
		return slot.status;
	}
	return 'writing';
}

function ensureSlot(
	agentId: string,
	agentName: string,
	now: number,
): LiveSlotInternal {
	const existing = _slots.get(agentId);
	if (existing) {
		if (agentName && existing.agentName !== agentName) {
			existing.agentName = agentName;
		}
		// Backfill scope if slot was created before session was available.
		if (!existing.sessionId || !existing.projectId) {
			const scope = resolveCurrentSessionScope();
			if (!existing.sessionId && scope.sessionId) {
				existing.sessionId = scope.sessionId;
			}
			if (!existing.projectId && scope.projectId) {
				existing.projectId = scope.projectId;
			}
		}
		return existing;
	}

	const scope = resolveCurrentSessionScope();
	const created: LiveSlotInternal = {
		agentId,
		agentName,
		status: 'thinking',
		tokenCount: 0,
		startedAt: now,
		isReasoning: false,
		otherPendingCount: 0,
		historyLines: [],
		updatedAt: now,
		pendingTools: new Map(),
		sessionId: scope.sessionId,
		projectId: scope.projectId,
	};
	_slots.set(agentId, created);
	return created;
}

function notifyListenersNow(): void {
	for (const listener of _listeners) {
		try {
			listener();
		} catch {
			/* noop */
		}
	}
}

function rebuildSnapshot(): void {
	_allSnapshot = Array.from(_slots.values()).map(toPublicSlot);
	_cachedFilterSessionId = resolveCurrentSessionScope().sessionId;
	_snapshot = _allSnapshot.filter(slot =>
		matchesLiveSlotFilter(slot, undefined),
	);
	if (!_notifyTimer) {
		_notifyTimer = setTimeout(() => {
			_notifyTimer = null;
			notifyListenersNow();
		}, NOTIFY_THROTTLE_MS);
	}
}

function commitSlot(slot: LiveSlotInternal, now: number): void {
	slot.otherPendingCount = computeOtherPendingCount(slot);
	slot.updatedAt = now;
	rebuildSnapshot();
}

export function subscribeSubAgentLive(listener: () => void): () => void {
	_listeners.add(listener);
	return () => {
		_listeners.delete(listener);
	};
}
export function getSubAgentLiveSnapshot(
	options?: SubAgentLiveSnapshotOptions,
): SubAgentLiveSlot[] {
	if (options?.all) {
		return _allSnapshot;
	}

	if (options?.sessionId !== undefined || options?.projectId !== undefined) {
		return _allSnapshot.filter(slot => matchesLiveSlotFilter(slot, options));
	}

	const currentSessionId = resolveCurrentSessionScope().sessionId;
	if (currentSessionId !== _cachedFilterSessionId) {
		_cachedFilterSessionId = currentSessionId;
		_snapshot = _allSnapshot.filter(slot =>
			matchesLiveSlotFilter(slot, undefined),
		);
	}

	return _snapshot;
}

/** Unfiltered alias for getSubAgentLiveSnapshot({all: true}). */
export function getAllSubAgentLiveSlots(): SubAgentLiveSlot[] {
	return _allSnapshot;
}

export function getSubAgentLiveSlot(
	agentId: string,
): SubAgentLiveSlot | undefined {
	const slot = _slots.get(agentId);
	return slot ? toPublicSlot(slot) : undefined;
}

export function clearAllSubAgentLiveSlots(): void {
	if (
		_slots.size === 0 &&
		_snapshot.length === 0 &&
		_allSnapshot.length === 0
	) {
		return;
	}
	_slots.clear();
	_allSnapshot = [];
	_snapshot = [];
	_cachedFilterSessionId = undefined;
	if (_notifyTimer) {
		clearTimeout(_notifyTimer);
		_notifyTimer = null;
	}
	notifyListenersNow();
}

/**
 * Drop live slots that do not belong to the given session.
 * Helper for session-switch cleanup (wired in a later phase).
 */
export function clearSubAgentLiveSlotsNotInSession(sessionId: string): void {
	let removed = false;
	for (const [agentId, slot] of _slots) {
		if (slot.sessionId && slot.sessionId !== sessionId) {
			_slots.delete(agentId);
			removed = true;
		}
	}
	if (!removed) {
		return;
	}
	rebuildSnapshot();
	if (_notifyTimer) {
		clearTimeout(_notifyTimer);
		_notifyTimer = null;
	}
	notifyListenersNow();
}

/** Drop terminal slots (completed/error). Active agents remain. */
export function clearCompletedSubAgentLiveSlots(): void {
	let removed = false;
	for (const [agentId, slot] of _slots) {
		if (slot.status === 'completed' || slot.status === 'error') {
			_slots.delete(agentId);
			removed = true;
		}
	}
	if (!removed) {
		return;
	}
	rebuildSnapshot();
	// Immediate notify so residual Done cards clear promptly.
	if (_notifyTimer) {
		clearTimeout(_notifyTimer);
		_notifyTimer = null;
	}
	notifyListenersNow();
}

export function liveOnToolStart(input: LiveToolStartInput): void {
	const now = Date.now();
	const startedAt = input.startedAt ?? now;
	const slot = ensureSlot(input.agentId, input.agentName, now);
	// New work after a terminal state reopens the same instance slot.
	if (slot.status === 'completed' || slot.status === 'error') {
		slot.durationMs = undefined;
		slot.startedAt = now;
	}

	const existing = slot.pendingTools.get(input.toolCallId);
	const pending: SubAgentLivePendingTool = {
		toolCallId: input.toolCallId,
		toolName: input.toolName,
		title: input.title,
		// Preserve original start time on dedupe/replace.
		startedAt: existing?.startedAt ?? startedAt,
		paramsPreview: input.paramsPreview ?? existing?.paramsPreview,
	};
	slot.pendingTools.set(input.toolCallId, pending);

	slot.focus = {
		kind: 'tool',
		toolCallId: pending.toolCallId,
		toolName: pending.toolName,
		title: pending.title,
		startedAt: pending.startedAt,
		paramsPreview: pending.paramsPreview,
	};
	// Keep a short rolling history for multi-line display mode.
	if (!slot.historyLines) slot.historyLines = [];
	const histTitle = pending.title.replace(/\x1b\[[0-9;]*m/g, '');
	if (histTitle) {
		const last = slot.historyLines[slot.historyLines.length - 1];
		if (last !== histTitle) {
			slot.historyLines.push(histTitle);
			if (slot.historyLines.length > 8) {
				slot.historyLines = slot.historyLines.slice(-8);
			}
		}
	}
	slot.status = slot.pendingTools.size > 1 ? 'multi_pending' : 'tool_focus';
	slot.isReasoning = false;
	commitSlot(slot, now);

	// Mirror tool activity into durable history for post-run review.
	try {
		const {ensureSubAgentRun, appendSubAgentRunHistory} =
			require('./subAgentRunStore.js') as typeof import('./subAgentRunStore.js');
		ensureSubAgentRun({
			instanceId: input.agentId,
			agentId: input.agentId,
			agentName: input.agentName || slot.agentName,
		});
		if (histTitle) {
			appendSubAgentRunHistory(input.agentId, histTitle);
		}
	} catch {
		// optional history
	}
}

export function liveOnToolEnd(input: LiveToolEndInput): void {
	const slot = _slots.get(input.agentId);
	if (!slot) return;

	const now = Date.now();
	const removed = slot.pendingTools.delete(input.toolCallId);
	if (!removed) {
		// Still allow status refresh if caller reports a terminal error.
		if (!input.ok && slot.pendingTools.size === 0) {
			slot.status = 'error';
			commitSlot(slot, now);
		}
		return;
	}

	const focusWasRemoved =
		slot.focus?.kind === 'tool' && slot.focus.toolCallId === input.toolCallId;

	if (focusWasRemoved) {
		// Next oldest pending tool becomes focus.
		let next: SubAgentLivePendingTool | undefined;
		for (const pending of slot.pendingTools.values()) {
			if (!next || pending.startedAt < next.startedAt) {
				next = pending;
			}
		}
		if (next) {
			slot.focus = {
				kind: 'tool',
				toolCallId: next.toolCallId,
				toolName: next.toolName,
				title: next.title,
				startedAt: next.startedAt,
				paramsPreview: next.paramsPreview,
			};
		} else {
			slot.focus = undefined;
		}
	}

	if (!input.ok && slot.pendingTools.size === 0) {
		slot.status = 'error';
	} else {
		slot.status = deriveStatusFromPending(slot);
	}

	commitSlot(slot, now);
}

export function liveOnAgentStatus(input: LiveAgentStatusInput): void {
	const now = Date.now();
	const slot = ensureSlot(input.agentId, input.agentName, now);

	// Never wipe startedAt or pending tools on status merge.
	slot.agentName = input.agentName || slot.agentName;
	slot.status = input.status;
	if (typeof input.tokenCount === 'number') {
		slot.tokenCount = input.tokenCount;
	}
	if (typeof input.isReasoning === 'boolean') {
		slot.isReasoning = input.isReasoning;
	}
	if (input.preview !== undefined) {
		slot.preview = input.preview;
	}
	if (input.ctxUsage !== undefined) {
		slot.ctxUsage = input.ctxUsage;
	}

	// Status fields that imply non-tool focus should not invent focus,
	// but keep existing pending/focus metadata intact.
	if (input.status === 'thinking' || input.status === 'writing') {
		// If tools are still pending, prefer tool-derived status.
		if (slot.pendingTools.size > 0) {
			slot.status = deriveStatusFromPending(slot);
		}
	}

	commitSlot(slot, now);
}

/**
 * Mark agent terminal in the live panel (keep visible as Done/Error).
 * Does NOT remove the slot — turn-end cleanup via clearCompletedSubAgentLiveSlots.
 */
export function liveOnAgentDone(
	agentId: string,
	options?: {error?: boolean},
): void {
	const slot = _slots.get(agentId);
	if (!slot) {
		return;
	}
	const now = Date.now();
	// Idempotent: do not restart elapsed if already terminal.
	if (slot.status !== 'completed' && slot.status !== 'error') {
		slot.durationMs = Math.max(0, now - slot.startedAt);
	} else if (typeof slot.durationMs !== 'number') {
		slot.durationMs = Math.max(0, now - slot.startedAt);
	}
	slot.status = options?.error ? 'error' : 'completed';
	slot.isReasoning = false;
	slot.focus = undefined;
	slot.preview = undefined;
	slot.pendingTools.clear();
	slot.otherPendingCount = 0;
	// Keep historyLines for residual multi-mode cards until turn-end clear.
	commitSlot(slot, now);
	try {
		const {completeSubAgentRun} =
			require('./subAgentRunStore.js') as typeof import('./subAgentRunStore.js');
		completeSubAgentRun(agentId, {
			error: options?.error,
			durationMs: slot.durationMs,
			tokenCount: slot.tokenCount,
			endedAt: now,
		});
	} catch {
		// optional
	}
}

/** Flush throttled listener notifications immediately (tests / shutdown). */
export function _flushSubAgentLiveNotifyForTests(): void {
	if (_notifyTimer) {
		clearTimeout(_notifyTimer);
		_notifyTimer = null;
	}
	notifyListenersNow();
}
