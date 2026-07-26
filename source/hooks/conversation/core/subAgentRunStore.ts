/**
 * Sub-agent run history store.
 * Keeps recent run records in memory for detail/history UI, and mirrors them
 * onto the current session for persistence across resume.
 */
import {sessionManager} from '../../../utils/session/sessionManager.js';

export type SubAgentRunStatus = 'running' | 'completed' | 'error';

export type SubAgentRunRecord = {
	instanceId: string;
	agentId: string;
	agentName: string;
	prompt: string;
	sourceType: 'subagent' | 'teammate';
	status: SubAgentRunStatus;
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
	tokenCount: number;
	/** Rolling tool/focus titles for timeline replay. */
	historyLines: string[];
	finalSummary?: string;
	errorMessage?: string;
	sessionId?: string;
};

const MAX_RUNS = 50;
const MAX_HISTORY_LINES = 40;
const PERSIST_DEBOUNCE_MS = 400;

const _runs = new Map<string, SubAgentRunRecord>();
const _listeners = new Set<() => void>();
let _snapshot: SubAgentRunRecord[] = [];
let _hydratedSessionId: string | null = null;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _dirty = false;

function cloneRun(run: SubAgentRunRecord): SubAgentRunRecord {
	return {
		...run,
		historyLines: [...run.historyLines],
	};
}

function rebuildSnapshot(): void {
	_snapshot = Array.from(_runs.values())
		.map(cloneRun)
		.sort((a, b) => b.startedAt - a.startedAt);
}

function notify(): void {
	for (const listener of _listeners) {
		try {
			listener();
		} catch {
			// ignore listener errors
		}
	}
}

function schedulePersist(): void {
	_dirty = true;
	if (_persistTimer) return;
	_persistTimer = setTimeout(() => {
		_persistTimer = null;
		if (!_dirty) return;
		_dirty = false;
		persistToCurrentSession();
	}, PERSIST_DEBOUNCE_MS);
}

function commit(options?: {persistImmediately?: boolean}): void {
	rebuildSnapshot();
	notify();
	if (options?.persistImmediately) {
		if (_persistTimer) {
			clearTimeout(_persistTimer);
			_persistTimer = null;
		}
		_dirty = false;
		persistToCurrentSession();
	} else {
		schedulePersist();
	}
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function persistToCurrentSession(): void {
	const session = sessionManager.getCurrentSession();
	if (!session) return;

	(session as {subAgentRuns?: SubAgentRunRecord[]}).subAgentRuns =
		_snapshot.map(cloneRun);
	session.updatedAt = Date.now();
	void sessionManager.saveSession(session).catch(() => {
		// Persistence is best-effort; in-memory history remains usable.
	});
}

export function subscribeSubAgentRuns(listener: () => void): () => void {
	_listeners.add(listener);
	return () => {
		_listeners.delete(listener);
	};
}

export function getSubAgentRunSnapshot(): SubAgentRunRecord[] {
	return _snapshot;
}

export function getSubAgentRun(
	instanceId: string,
): SubAgentRunRecord | undefined {
	const run = _runs.get(instanceId);
	return run ? cloneRun(run) : undefined;
}

export function getRecentSubAgentRuns(limit = 20): SubAgentRunRecord[] {
	return _snapshot.slice(0, Math.max(0, limit)).map(cloneRun);
}

export function clearSubAgentRuns(): void {
	if (_runs.size === 0 && _snapshot.length === 0) return;
	_runs.clear();
	_snapshot = [];
	_hydratedSessionId = null;
	_dirty = false;
	if (_persistTimer) {
		clearTimeout(_persistTimer);
		_persistTimer = null;
	}
	notify();
}

/** Load runs from a session (resume). Replaces in-memory history. */
export function hydrateSubAgentRunsFromSession(
	session:
		| {
				id: string;
				subAgentRuns?: SubAgentRunRecord[];
		  }
		| null
		| undefined,
): void {
	if (!session) {
		clearSubAgentRuns();
		return;
	}
	if (_hydratedSessionId === session.id && _runs.size > 0) {
		return;
	}

	_runs.clear();
	const list = Array.isArray(session.subAgentRuns) ? session.subAgentRuns : [];
	for (const raw of list) {
		if (!raw?.instanceId) continue;
		_runs.set(raw.instanceId, {
			instanceId: raw.instanceId,
			agentId: raw.agentId || raw.instanceId,
			agentName: raw.agentName || 'Sub-agent',
			prompt: raw.prompt || '',
			sourceType: raw.sourceType === 'teammate' ? 'teammate' : 'subagent',
			status:
				raw.status === 'running' || raw.status === 'error'
					? raw.status
					: 'completed',
			startedAt: Number(raw.startedAt) || Date.now(),
			endedAt: raw.endedAt,
			durationMs: raw.durationMs,
			tokenCount: Number(raw.tokenCount) || 0,
			historyLines: Array.isArray(raw.historyLines)
				? raw.historyLines.map(String).slice(-MAX_HISTORY_LINES)
				: [],
			finalSummary: raw.finalSummary,
			errorMessage: raw.errorMessage,
			sessionId: session.id,
		});
	}
	for (const run of _runs.values()) {
		if (run.status === 'running') {
			run.status = 'completed';
			run.endedAt = run.endedAt ?? Date.now();
			run.durationMs =
				run.durationMs ??
				Math.max(0, (run.endedAt || Date.now()) - run.startedAt);
		}
	}
	_hydratedSessionId = session.id;
	rebuildSnapshot();
	notify();
}

export function startSubAgentRun(input: {
	instanceId: string;
	agentId: string;
	agentName: string;
	prompt?: string;
	sourceType?: 'subagent' | 'teammate';
	startedAt?: number | Date;
}): SubAgentRunRecord {
	const startedAt =
		typeof input.startedAt === 'number'
			? input.startedAt
			: input.startedAt instanceof Date
				? input.startedAt.getTime()
				: Date.now();
	const session = sessionManager.getCurrentSession();
	const existing = _runs.get(input.instanceId);
	const run: SubAgentRunRecord = {
		instanceId: input.instanceId,
		agentId: input.agentId,
		agentName: input.agentName,
		prompt: input.prompt ?? existing?.prompt ?? '',
		sourceType: input.sourceType ?? existing?.sourceType ?? 'subagent',
		status: 'running',
		startedAt: existing?.startedAt ?? startedAt,
		tokenCount: existing?.tokenCount ?? 0,
		historyLines: existing?.historyLines ? [...existing.historyLines] : [],
		sessionId: session?.id,
	};
	run.endedAt = undefined;
	run.durationMs = undefined;
	run.errorMessage = undefined;
	_runs.set(run.instanceId, run);
	if (_runs.size > MAX_RUNS) {
		const ordered = Array.from(_runs.values()).sort(
			(a, b) => a.startedAt - b.startedAt,
		);
		while (_runs.size > MAX_RUNS && ordered.length > 0) {
			const oldest = ordered.shift();
			if (!oldest) break;
			if (oldest.status === 'running') continue;
			_runs.delete(oldest.instanceId);
		}
	}
	commit({persistImmediately: true});
	return cloneRun(run);
}

export function appendSubAgentRunHistory(
	instanceId: string,
	line: string,
): void {
	const run = _runs.get(instanceId);
	if (!run) return;
	const cleaned = stripAnsi(line).replace(/[\r\n]+/g, ' ').trim();
	if (!cleaned) return;
	const last = run.historyLines[run.historyLines.length - 1];
	if (last === cleaned) return;
	run.historyLines.push(cleaned);
	if (run.historyLines.length > MAX_HISTORY_LINES) {
		run.historyLines = run.historyLines.slice(-MAX_HISTORY_LINES);
	}
	commit();
}

export function updateSubAgentRun(
	instanceId: string,
	patch: Partial<
		Pick<
			SubAgentRunRecord,
			| 'agentName'
			| 'prompt'
			| 'tokenCount'
			| 'status'
			| 'finalSummary'
			| 'errorMessage'
		>
	>,
): void {
	const run = _runs.get(instanceId);
	if (!run) return;
	if (patch.agentName !== undefined) run.agentName = patch.agentName;
	if (patch.prompt !== undefined) run.prompt = patch.prompt;
	if (typeof patch.tokenCount === 'number') run.tokenCount = patch.tokenCount;
	if (patch.status !== undefined) run.status = patch.status;
	if (patch.finalSummary !== undefined) run.finalSummary = patch.finalSummary;
	if (patch.errorMessage !== undefined) run.errorMessage = patch.errorMessage;
	commit();
}

export function completeSubAgentRun(
	instanceId: string,
	options?: {
		error?: boolean;
		finalSummary?: string;
		errorMessage?: string;
		tokenCount?: number;
		durationMs?: number;
		endedAt?: number;
	},
): SubAgentRunRecord | undefined {
	const run = _runs.get(instanceId);
	if (!run) return undefined;

	const endedAt = options?.endedAt ?? Date.now();
	if (run.status === 'running') {
		run.status = options?.error ? 'error' : 'completed';
		run.endedAt = endedAt;
		run.durationMs =
			typeof options?.durationMs === 'number'
				? Math.max(0, options.durationMs)
				: Math.max(0, endedAt - run.startedAt);
	} else if (typeof run.durationMs !== 'number') {
		run.endedAt = run.endedAt ?? endedAt;
		run.durationMs = Math.max(0, (run.endedAt || endedAt) - run.startedAt);
	}

	if (options?.error) {
		run.status = 'error';
	}
	if (options?.finalSummary !== undefined) {
		run.finalSummary = options.finalSummary;
	}
	if (options?.errorMessage !== undefined) {
		run.errorMessage = options.errorMessage;
	}
	if (typeof options?.tokenCount === 'number') {
		run.tokenCount = options.tokenCount;
	}

	commit({persistImmediately: true});
	return cloneRun(run);
}

/** Ensure a run exists when live activity arrives before tracker register. */
export function ensureSubAgentRun(input: {
	instanceId: string;
	agentName?: string;
	agentId?: string;
}): SubAgentRunRecord {
	const existing = _runs.get(input.instanceId);
	if (existing) return cloneRun(existing);
	return startSubAgentRun({
		instanceId: input.instanceId,
		agentId: input.agentId || input.instanceId,
		agentName: input.agentName || 'Sub-agent',
		prompt: '',
		sourceType: 'subagent',
	});
}
