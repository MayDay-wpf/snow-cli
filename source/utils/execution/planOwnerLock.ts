/**
 * Repository-scoped plan owner lock.
 * Prevents two snow processes from both treating different plans as
 * "the" executing plan in the same working tree.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {getPlanDir} from './planPaths.js';

export const PLAN_OWNER_LOCK_ENABLED = true;

/** Heartbeat older than this is hard-stale when pid status is unknown. */
export const PLAN_OWNER_LOCK_STALE_MS = 30 * 60 * 1000;

/**
 * Heartbeat older than this is soft-stale when the pid is confirmed alive.
 * Soft-stale never auto-adopts without force.
 */
export const PLAN_OWNER_LOCK_SOFT_STALE_MS = 12 * 60 * 1000;

export type PlanOwnerLock = {
	version: 1;
	planPath: string;
	sessionId: string;
	pid: number;
	hostname: string;
	acquiredAt: string;
	heartbeatAt: string;
};

export type PlanOwnerLockLiveness = {
	pidAlive: boolean | 'unknown';
	hardStale: boolean;
	softStale: boolean;
};

export type PlanOwnerLockConflict = {
	lock: PlanOwnerLock;
	stale: boolean;
	pidAlive: boolean | 'unknown';
};

function lockDir(cwd: string): string {
	return path.join(getPlanDir(cwd), '.runtime');
}

export function getPlanOwnerLockPath(cwd: string): string {
	return path.join(lockDir(cwd), 'owner.lock.json');
}

/** Best-effort pid liveness. `unknown` when the OS refuses to say. */
export function isPidAlive(pid: number): boolean | 'unknown' {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		// signal 0: existence check; throws ESRCH when gone.
		process.kill(pid, 0);
		return true;
	} catch (error: any) {
		const code = error?.code;
		if (code === 'ESRCH') {
			return false;
		}
		// EPERM etc. — process may exist but we cannot signal it.
		return 'unknown';
	}
}

function lockHeartbeatAgeMs(
	lock: PlanOwnerLock,
	nowMs: number = Date.now(),
): number {
	const heartbeat = Date.parse(lock.heartbeatAt || lock.acquiredAt);
	return Number.isFinite(heartbeat)
		? nowMs - heartbeat
		: Number.POSITIVE_INFINITY;
}

/**
 * Classify lock liveness for multi-process ownership decisions.
 * - hardStale: pid dead, or unknown pid with heartbeat older than HARD
 * - softStale: same-host pid alive but heartbeat older than SOFT
 * - cross-host (hostname mismatch): pidAlive is unknown; only hard rules apply
 */
export function getLockLiveness(
	lock: PlanOwnerLock,
	nowMs: number = Date.now(),
): PlanOwnerLockLiveness {
	const pidAlive =
		lock.hostname && lock.hostname !== os.hostname()
			? 'unknown'
			: isPidAlive(lock.pid);
	const age = lockHeartbeatAgeMs(lock, nowMs);

	if (pidAlive === false) {
		return {pidAlive, hardStale: true, softStale: false};
	}

	if (pidAlive === 'unknown') {
		return {
			pidAlive,
			hardStale: age > PLAN_OWNER_LOCK_STALE_MS,
			softStale: false,
		};
	}

	// Confirmed-live same-host process: soft-stale when heartbeat is old.
	return {
		pidAlive: true,
		hardStale: false,
		softStale: age > PLAN_OWNER_LOCK_SOFT_STALE_MS,
	};
}

/**
 * Backward-compatible stale check.
 * `stale` is hard-stale only; soft-stale remains non-stale for force-gating.
 */
export function isLockStale(
	lock: PlanOwnerLock,
	nowMs: number = Date.now(),
): {stale: boolean; pidAlive: boolean | 'unknown'} {
	const liveness = getLockLiveness(lock, nowMs);
	return {stale: liveness.hardStale, pidAlive: liveness.pidAlive};
}

async function readPlanOwnerLockAtPath(
	filePath: string,
): Promise<PlanOwnerLock | null> {
	try {
		const raw = await fs.readFile(filePath, 'utf8');
		const data = JSON.parse(raw) as Partial<PlanOwnerLock>;
		if (
			data?.version !== 1 ||
			typeof data.planPath !== 'string' ||
			typeof data.sessionId !== 'string' ||
			typeof data.pid !== 'number'
		) {
			return null;
		}
		return {
			version: 1,
			planPath: data.planPath,
			sessionId: data.sessionId,
			pid: data.pid,
			hostname: typeof data.hostname === 'string' ? data.hostname : '',
			acquiredAt:
				typeof data.acquiredAt === 'string'
					? data.acquiredAt
					: new Date(0).toISOString(),
			heartbeatAt:
				typeof data.heartbeatAt === 'string'
					? data.heartbeatAt
					: typeof data.acquiredAt === 'string'
					? data.acquiredAt
					: new Date(0).toISOString(),
		};
	} catch {
		return null;
	}
}

export async function readPlanOwnerLock(
	cwd: string,
): Promise<PlanOwnerLock | null> {
	return readPlanOwnerLockAtPath(getPlanOwnerLockPath(cwd));
}

function serializeLock(lock: PlanOwnerLock): string {
	return `${JSON.stringify(lock, null, 2)}\n`;
}

async function createLockFile(
	cwd: string,
	lock: PlanOwnerLock,
): Promise<boolean> {
	await fs.mkdir(lockDir(cwd), {recursive: true});
	try {
		await fs.writeFile(getPlanOwnerLockPath(cwd), serializeLock(lock), {
			encoding: 'utf8',
			flag: 'wx',
		});
		return true;
	} catch (error: any) {
		if (error?.code === 'EEXIST') {
			return false;
		}
		throw error;
	}
}

function sameOwner(
	lock: PlanOwnerLock,
	input: {planPath: string; sessionId: string; pid: number; hostname: string},
): boolean {
	return (
		path.normalize(lock.planPath).toLowerCase() ===
			path.normalize(input.planPath).toLowerCase() &&
		lock.sessionId === input.sessionId &&
		lock.pid === input.pid &&
		lock.hostname === input.hostname
	);
}

function sameLock(left: PlanOwnerLock, right: PlanOwnerLock): boolean {
	return (
		sameOwner(left, right) &&
		left.version === right.version &&
		left.acquiredAt === right.acquiredAt &&
		left.heartbeatAt === right.heartbeatAt
	);
}

function movedLockPath(lockPath: string, operation: string): string {
	return `${lockPath}.${operation}.${process.pid}.${Date.now()}.${Math.random()
		.toString(16)
		.slice(2)}.tmp`;
}

async function restoreMovedLock(
	lockPath: string,
	movedPath: string,
): Promise<void> {
	let raw: string;
	try {
		raw = await fs.readFile(movedPath, 'utf8');
	} catch (error: any) {
		if (error?.code === 'ENOENT') {
			return;
		}
		throw error;
	}

	try {
		await fs.writeFile(lockPath, raw, {encoding: 'utf8', flag: 'wx'});
	} catch (error: any) {
		if (error?.code !== 'EEXIST') {
			throw error;
		}
	}
	await fs.unlink(movedPath).catch(() => {});
}
export type AcquirePlanOwnerLockInput = {
	planPath: string;
	sessionId: string;
	/** When true, overwrite a live foreign lock. */
	force?: boolean;
	pid?: number;
};

export type AcquirePlanOwnerLockResult =
	| {
			ok: true;
			lock: PlanOwnerLock;
			tookOver: boolean;
			previousLock?: PlanOwnerLock;
	  }
	| {ok: false; conflict: PlanOwnerLockConflict};

/**
 * Acquire or refresh the repo owner lock for an executing plan.
 * A live foreign owner requires an explicit force takeover.
 */
export async function acquirePlanOwnerLock(
	cwd: string,
	input: AcquirePlanOwnerLockInput,
): Promise<AcquirePlanOwnerLockResult> {
	const now = new Date().toISOString();
	const owner = {
		planPath: path.resolve(input.planPath),
		sessionId: input.sessionId || '',
		pid: input.pid ?? process.pid,
		hostname: os.hostname(),
	};
	const buildLock = (acquiredAt = now): PlanOwnerLock => ({
		version: 1,
		...owner,
		acquiredAt,
		heartbeatAt: now,
	});

	if (!PLAN_OWNER_LOCK_ENABLED) {
		return {ok: true, tookOver: false, lock: buildLock()};
	}

	for (let attempt = 0; attempt < 3; attempt++) {
		const existing = await readPlanOwnerLock(cwd);
		if (!existing) {
			const lock = buildLock();
			if (await createLockFile(cwd, lock)) {
				return {ok: true, lock, tookOver: false};
			}
			continue;
		}

		const same = sameOwner(existing, owner);
		const state = isLockStale(existing);
		if (!same && !state.stale && !input.force) {
			return {
				ok: false,
				conflict: {...state, lock: existing},
			};
		}

		const lockPath = getPlanOwnerLockPath(cwd);
		const movedPath = movedLockPath(lockPath, same ? 'refresh' : 'takeover');
		try {
			await fs.rename(lockPath, movedPath);
		} catch (error: any) {
			if (error?.code === 'ENOENT') {
				continue;
			}
			throw error;
		}
		const moved = await readPlanOwnerLockAtPath(movedPath);
		if (!moved || !sameLock(moved, existing)) {
			await restoreMovedLock(lockPath, movedPath);
			continue;
		}

		const lock = buildLock(same ? existing.acquiredAt : now);
		if (await createLockFile(cwd, lock)) {
			await fs.unlink(movedPath).catch(() => {});
			return {
				ok: true,
				lock,
				tookOver: !same,
				...(same ? {} : {previousLock: existing}),
			};
		}
		await restoreMovedLock(lockPath, movedPath);
	}

	const conflict = await readPlanOwnerLock(cwd);
	if (conflict) {
		return {
			ok: false,
			conflict: {...isLockStale(conflict), lock: conflict},
		};
	}
	throw new Error(
		`Failed to acquire plan owner lock at ${getPlanOwnerLockPath(cwd)}`,
	);
}

export type ReleasePlanOwnerLockOptions = {
	planPath?: string;
	sessionId?: string;
	pid?: number;
	force?: boolean;
};

export async function releasePlanOwnerLock(
	cwd: string,
	options: ReleasePlanOwnerLockOptions = {},
): Promise<boolean> {
	if (!PLAN_OWNER_LOCK_ENABLED) {
		return true;
	}

	for (let attempt = 0; attempt < 3; attempt++) {
		const existing = await readPlanOwnerLock(cwd);
		if (!existing) {
			return true;
		}
		const expected = {
			planPath: path.resolve(options.planPath || existing.planPath),
			sessionId: options.sessionId ?? existing.sessionId,
			pid: options.pid ?? process.pid,
			hostname: os.hostname(),
		};
		if (!options.force && !sameOwner(existing, expected)) {
			return false;
		}

		const lockPath = getPlanOwnerLockPath(cwd);
		const movedPath = movedLockPath(lockPath, 'release');
		try {
			await fs.rename(lockPath, movedPath);
		} catch (error: any) {
			if (error?.code === 'ENOENT') {
				continue;
			}
			throw error;
		}
		const moved = await readPlanOwnerLockAtPath(movedPath);
		if (!moved || !sameLock(moved, existing)) {
			await restoreMovedLock(lockPath, movedPath);
			continue;
		}
		await fs.unlink(movedPath);
		return true;
	}
	return false;
}

export async function verifyPlanOwnerLock(
	cwd: string,
	input: {planPath: string; sessionId: string; pid?: number},
): Promise<{ok: true; lock: PlanOwnerLock} | {ok: false; message: string}> {
	if (!PLAN_OWNER_LOCK_ENABLED) {
		const lockResult = await acquirePlanOwnerLock(cwd, input);
		return lockResult.ok
			? {ok: true, lock: lockResult.lock}
			: {ok: false, message: formatOwnerLockConflict(lockResult.conflict)};
	}
	const lock = await readPlanOwnerLock(cwd);
	const expected = {
		planPath: path.resolve(input.planPath),
		sessionId: input.sessionId || '',
		pid: input.pid ?? process.pid,
		hostname: os.hostname(),
	};
	if (lock && sameOwner(lock, expected)) {
		return {ok: true, lock};
	}
	if (lock) {
		return {
			ok: false,
			message: `Plan owner changed before mutation. ${formatOwnerLockConflict({
				...isLockStale(lock),
				lock,
			})}`,
		};
	}
	return {
		ok: false,
		message: `Plan owner lock is missing for ${expected.planPath}. Adopt or resume the plan, then retry.`,
	};
}
export function formatOwnerLockConflict(
	conflict: PlanOwnerLockConflict,
): string {
	const {lock, stale, pidAlive} = conflict;
	return (
		`Plan owner lock held by session=${lock.sessionId || '(none)'} ` +
		`pid=${lock.pid} (alive=${String(pidAlive)}, stale=${String(stale)}) ` +
		`plan=${lock.planPath}. ` +
		`Adopt that plan, wait for it to finish, or force takeover with reason.`
	);
}

/**
 * Refresh heartbeatAt for the same owner only.
 * Never creates a lock and never takes over a foreign lock.
 */
export async function refreshPlanOwnerHeartbeat(
	cwd: string,
	input: {planPath: string; sessionId: string; pid?: number},
): Promise<
	{ok: true; lock: PlanOwnerLock} | {ok: false; reason: 'missing' | 'foreign'}
> {
	const expected = {
		planPath: path.resolve(input.planPath),
		sessionId: input.sessionId || '',
		pid: input.pid ?? process.pid,
		hostname: os.hostname(),
	};

	if (!PLAN_OWNER_LOCK_ENABLED) {
		const now = new Date().toISOString();
		return {
			ok: true,
			lock: {
				version: 1,
				...expected,
				acquiredAt: now,
				heartbeatAt: now,
			},
		};
	}

	for (let attempt = 0; attempt < 3; attempt++) {
		const existing = await readPlanOwnerLock(cwd);
		if (!existing) {
			return {ok: false, reason: 'missing'};
		}
		if (!sameOwner(existing, expected)) {
			return {ok: false, reason: 'foreign'};
		}

		const now = new Date().toISOString();
		const lock: PlanOwnerLock = {
			...existing,
			heartbeatAt: now,
		};

		const lockPath = getPlanOwnerLockPath(cwd);
		const movedPath = movedLockPath(lockPath, 'heartbeat');
		try {
			await fs.rename(lockPath, movedPath);
		} catch (error: any) {
			if (error?.code === 'ENOENT') {
				continue;
			}
			throw error;
		}

		const moved = await readPlanOwnerLockAtPath(movedPath);
		if (!moved || !sameLock(moved, existing)) {
			await restoreMovedLock(lockPath, movedPath);
			continue;
		}

		if (await createLockFile(cwd, lock)) {
			await fs.unlink(movedPath).catch(() => {});
			return {ok: true, lock};
		}
		await restoreMovedLock(lockPath, movedPath);
	}

	const existing = await readPlanOwnerLock(cwd);
	if (!existing) {
		return {ok: false, reason: 'missing'};
	}
	if (!sameOwner(existing, expected)) {
		return {ok: false, reason: 'foreign'};
	}
	return {ok: false, reason: 'foreign'};
}
