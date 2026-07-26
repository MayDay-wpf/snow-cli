/**
 * Multi-process plan ownership classifier.
 *
 * Pure decision layer for list/resume/adopt strategies. Does not mutate
 * plan or lock files; callers pass current plan frontmatter + lock state.
 */

import path from 'node:path';
import {getLockLiveness, type PlanOwnerLock} from './planOwnerLock.js';

export type PlanOwnershipKind =
	| 'mine_active'
	| 'mine_recoverable'
	| 'foreign_live'
	| 'foreign_soft_stale'
	| 'foreign_hard_stale'
	| 'untagged_recoverable'
	| 'none';

export type PlanOwnershipClassification = {
	kind: PlanOwnershipKind;
	planPath?: string;
	sessionId?: string;
	lock?: PlanOwnerLock | null;
	pidAlive?: boolean | 'unknown';
	/** hard stale */
	stale?: boolean;
	softStale?: boolean;
	canAdoptWithoutForce: boolean;
	/** check_step / complete etc. */
	canMutate: boolean;
	/** human readable */
	summary: string;
};

const ACTIVE_PLAN_STATUSES = new Set(['executing', 'approved']);

function normalizeSession(session?: string | null): string {
	return (session || '').trim();
}

function samePlanPath(left?: string | null, right?: string | null): boolean {
	if (!left || !right) {
		return false;
	}
	return (
		path.normalize(left).toLowerCase() === path.normalize(right).toLowerCase()
	);
}

function baseResult(input: {
	planPath?: string;
	sessionId?: string;
	lock?: PlanOwnerLock | null;
	pidAlive?: boolean | 'unknown';
	stale?: boolean;
	softStale?: boolean;
}): Pick<
	PlanOwnershipClassification,
	'planPath' | 'sessionId' | 'lock' | 'pidAlive' | 'stale' | 'softStale'
> {
	return {
		...(input.planPath ? {planPath: input.planPath} : {}),
		...(input.sessionId !== undefined ? {sessionId: input.sessionId} : {}),
		lock: input.lock ?? null,
		...(input.pidAlive !== undefined ? {pidAlive: input.pidAlive} : {}),
		...(input.stale !== undefined ? {stale: input.stale} : {}),
		...(input.softStale !== undefined ? {softStale: input.softStale} : {}),
	};
}

/**
 * Classify ownership of the given plan relative to the current session.
 *
 * Soft-stale never sets canAdoptWithoutForce=true.
 */
export function classifyPlanOwnership(input: {
	cwd: string;
	sessionId?: string | null;
	plan?: {
		filePath: string;
		frontmatter: {status: string; session?: string};
	} | null;
	lock?: PlanOwnerLock | null;
	nowMs?: number;
}): PlanOwnershipClassification {
	const nowMs = input.nowMs ?? Date.now();
	const currentSession = normalizeSession(input.sessionId);
	const plan = input.plan ?? null;
	const lock = input.lock ?? null;

	if (!plan) {
		return {
			kind: 'none',
			...baseResult({lock}),
			canAdoptWithoutForce: false,
			canMutate: false,
			summary: 'No plan is available to classify.',
		};
	}

	const planPath = plan.filePath;
	const planSession = normalizeSession(plan.frontmatter.session);
	const status = (plan.frontmatter.status || '').toLowerCase();
	const isActiveStatus = ACTIVE_PLAN_STATUSES.has(status);
	const liveness = lock ? getLockLiveness(lock, nowMs) : null;
	const pidAlive = liveness?.pidAlive;
	const hardStale = liveness?.hardStale ?? false;
	const softStale = liveness?.softStale ?? false;
	const lockPointsAtPlan = !!lock && samePlanPath(lock.planPath, planPath);
	const lockSameSession =
		!!lock && normalizeSession(lock.sessionId) === currentSession;
	const lockIsLiveMine =
		lockPointsAtPlan &&
		lockSameSession &&
		!!lock &&
		lock.pid === process.pid &&
		!hardStale &&
		pidAlive !== false;

	const common = baseResult({
		planPath,
		sessionId: planSession || currentSession || undefined,
		lock,
		pidAlive,
		stale: hardStale,
		softStale,
	});

	// Non-active plan statuses are not ownership-contested in this phase.
	if (!isActiveStatus) {
		return {
			kind: 'none',
			...common,
			canAdoptWithoutForce: false,
			canMutate: false,
			summary: `Plan status=${
				status || '(empty)'
			} is not active; no ownership contention.`,
		};
	}

	// Mine: plan session matches current session.
	if (planSession && currentSession && planSession === currentSession) {
		if (lockIsLiveMine) {
			return {
				kind: 'mine_active',
				...common,
				canAdoptWithoutForce: false,
				canMutate: true,
				summary: `This session owns the plan and the owner lock is live (pid=${
					lock!.pid
				}).`,
			};
		}

		// Missing lock, hard-stale lock, or dead pid → recoverable for this session.
		return {
			kind: 'mine_recoverable',
			...common,
			canAdoptWithoutForce: true,
			canMutate: false,
			summary: lock
				? `Plan belongs to this session but the owner lock is not live (pidAlive=${String(
						pidAlive,
				  )}, hardStale=${String(hardStale)}). Adopt to resume mutations.`
				: 'Plan belongs to this session but no owner lock is held. Adopt to resume mutations.',
		};
	}

	// Untagged / empty session plan while executing/approved.
	if (!planSession) {
		return {
			kind: 'untagged_recoverable',
			...common,
			canAdoptWithoutForce: true,
			canMutate: false,
			summary:
				'Plan has no session tag while active; it can be adopted without force.',
		};
	}

	// Foreign session ownership.
	const foreignLiveLock =
		lockPointsAtPlan &&
		!!lock &&
		normalizeSession(lock.sessionId) !== currentSession &&
		!hardStale &&
		!softStale;
	const foreignSoftStaleLock =
		lockPointsAtPlan &&
		!!lock &&
		normalizeSession(lock.sessionId) !== currentSession &&
		!hardStale &&
		softStale;
	const foreignHardStale =
		!lock || !lockPointsAtPlan || hardStale || pidAlive === false;

	if (foreignLiveLock) {
		return {
			kind: 'foreign_live',
			...common,
			canAdoptWithoutForce: false,
			canMutate: false,
			summary: `Plan is owned by foreign session=${
				lock!.sessionId
			} with a live lock (pid=${lock!.pid}). Force is required to take over.`,
		};
	}

	if (foreignSoftStaleLock) {
		return {
			kind: 'foreign_soft_stale',
			...common,
			// Soft-stale NEVER auto-adopts without force.
			canAdoptWithoutForce: false,
			canMutate: false,
			summary: `Plan is owned by foreign session=${
				lock!.sessionId
			}; pid is alive but heartbeat is soft-stale. Force is required (no silent adopt).`,
		};
	}

	if (foreignHardStale) {
		return {
			kind: 'foreign_hard_stale',
			...common,
			canAdoptWithoutForce: true,
			canMutate: false,
			summary: lock
				? `Foreign plan session=${planSession} has a hard-stale or dead owner lock (pidAlive=${String(
						pidAlive,
				  )}). Can adopt without force.`
				: `Foreign plan session=${planSession} has no owner lock. Can adopt without force.`,
		};
	}

	// Fallback: treat as live foreign when lock is present but ambiguous.
	return {
		kind: 'foreign_live',
		...common,
		canAdoptWithoutForce: false,
		canMutate: false,
		summary: `Plan is owned by foreign session=${planSession}; force is required to take over.`,
	};
}
