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
	/** Locally estimated streamed output tokens (reasoning/content/tool-call deltas). */
	tokenCount: number;
	/** Rolling tool/focus titles for timeline replay. */
	historyLines: string[];
	finalSummary?: string;
	errorMessage?: string;
	sessionId?: string;
	projectId?: string;
};

export type SubAgentRunSnapshotOptions = {
	sessionId?: string;
	projectId?: string;
	/** When true, return every run regardless of session/project. */
	all?: boolean;
};

const MAX_RUNS = 50;
const MAX_HISTORY_LINES = 40;
const PERSIST_DEBOUNCE_MS = 400;

const _runs = new Map<string, SubAgentRunRecord>();
const _listeners = new Set<() => void>();
let _allSnapshot: SubAgentRunRecord[] = [];
/** Default public snapshot: runs for the current session (plus unscoped). */
let _snapshot: SubAgentRunRecord[] = [];
let _cachedFilterSessionId: string | undefined;
let _hydratedSessionId: string | null = null;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
let _dirty = false;
let _notifyScheduled = false;

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

function matchesRunFilter(
	run: SubAgentRunRecord,
	options?: SubAgentRunSnapshotOptions,
): boolean {
	if (options?.all) {
		return true;
	}

	const current = resolveCurrentSessionScope();
	const sessionId = options?.sessionId ?? current.sessionId;
	const projectId = options?.projectId ?? current.projectId;

	if (options?.sessionId !== undefined) {
		if (run.sessionId && run.sessionId !== options.sessionId) {
			return false;
		}
	} else if (sessionId) {
		if (run.sessionId && run.sessionId !== sessionId) {
			return false;
		}
	}

	if (options?.projectId !== undefined) {
		if (run.projectId && run.projectId !== options.projectId) {
			return false;
		}
	} else if (projectId && options?.sessionId === undefined) {
		if (run.projectId && run.projectId !== projectId) {
			return false;
		}
	}

	return true;
}

function cloneRun(run: SubAgentRunRecord): SubAgentRunRecord {
	return {
		...run,
		historyLines: [...run.historyLines],
	};
}

function rebuildSnapshot(): void {
	_allSnapshot = Array.from(_runs.values())
		.map(cloneRun)
		.sort((a, b) => b.startedAt - a.startedAt);
	_cachedFilterSessionId = resolveCurrentSessionScope().sessionId;
	_snapshot = _allSnapshot.filter(run => matchesRunFilter(run, undefined));
}

function notifyListenersNow(): void {
	for (const listener of _listeners) {
		try {
			listener();
		} catch {
			// ignore listener errors
		}
	}
}

function scheduleNotify(): void {
	if (_notifyScheduled) return;
	_notifyScheduled = true;
	queueMicrotask(() => {
		_notifyScheduled = false;
		notifyListenersNow();
	});
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
	// SubAgentUIHandler can commit while React evaluates a ChatScreen state
	// updater. Notify after that render stack so ChatInput subscribers are not
	// updated while another component is rendering.
	scheduleNotify();
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

	// Only persist runs that belong to the current session (or unscoped runs
	// hydrated for this session) so other sessions are not polluted.
	const runsForSession = _allSnapshot
		.filter(run => {
			if (run.sessionId) {
				return run.sessionId === session.id;
			}
			// Unscoped runs are treated as belonging to the hydrated session.
			return !_hydratedSessionId || _hydratedSessionId === session.id;
		})
		.map(cloneRun);

	(session as {subAgentRuns?: SubAgentRunRecord[]}).subAgentRuns =
		runsForSession;
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

export function getSubAgentRunSnapshot(
	options?: SubAgentRunSnapshotOptions,
): SubAgentRunRecord[] {
	if (options?.all) {
		return _allSnapshot;
	}

	if (options?.sessionId !== undefined || options?.projectId !== undefined) {
		return _allSnapshot.filter(run => matchesRunFilter(run, options));
	}

	const currentSessionId = resolveCurrentSessionScope().sessionId;
	if (currentSessionId !== _cachedFilterSessionId) {
		_cachedFilterSessionId = currentSessionId;
		_snapshot = _allSnapshot.filter(run => matchesRunFilter(run, undefined));
	}

	return _snapshot;
}

/** Unfiltered alias for getSubAgentRunSnapshot({all: true}). */
export function getAllSubAgentRuns(): SubAgentRunRecord[] {
	return _allSnapshot;
}

export function getSubAgentRun(
	instanceId: string,
): SubAgentRunRecord | undefined {
	const run = _runs.get(instanceId);
	return run ? cloneRun(run) : undefined;
}

export function getRecentSubAgentRuns(
	limit = 20,
	options?: SubAgentRunSnapshotOptions,
): SubAgentRunRecord[] {
	return getSubAgentRunSnapshot(options)
		.slice(0, Math.max(0, limit))
		.map(cloneRun);
}

export function clearSubAgentRuns(): void {
	if (_runs.size === 0 && _snapshot.length === 0 && _allSnapshot.length === 0)
		return;
	_runs.clear();
	_allSnapshot = [];
	_snapshot = [];
	_cachedFilterSessionId = undefined;
	_hydratedSessionId = null;
	_dirty = false;
	if (_persistTimer) {
		clearTimeout(_persistTimer);
		_persistTimer = null;
	}
	scheduleNotify();
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
			projectId:
				raw.projectId ||
				(session as {projectId?: string}).projectId ||
				sessionManager.getProjectId?.(),
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
	scheduleNotify();
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
		projectId: session?.projectId ?? sessionManager.getProjectId?.(),
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
	const cleaned = stripAnsi(line)
		.replace(/[\r\n]+/g, ' ')
		.trim();
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
