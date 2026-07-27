import anyTest, {type TestFn} from 'ava';
import os from 'node:os';
import path from 'node:path';
import {
	PLAN_OWNER_LOCK_SOFT_STALE_MS,
	PLAN_OWNER_LOCK_STALE_MS,
	type PlanOwnerLock,
} from '../utils/execution/planOwnerLock.js';
import {classifyPlanOwnership} from '../utils/execution/planOwnership.js';

const test = anyTest as unknown as TestFn;

function lock(overrides: Partial<PlanOwnerLock> = {}): PlanOwnerLock {
	const now = new Date().toISOString();
	return {
		version: 1,
		planPath: path.resolve('demo.md'),
		sessionId: 'session-a',
		pid: process.pid,
		hostname: os.hostname(),
		acquiredAt: now,
		heartbeatAt: now,
		...overrides,
	};
}

function plan(
	status: string,
	session?: string,
	filePath = path.resolve('demo.md'),
) {
	return {
		filePath,
		frontmatter: {
			status,
			...(session !== undefined ? {session} : {}),
		},
	};
}

test('no plan classifies as none', t => {
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-a',
		plan: null,
	});
	t.is(result.kind, 'none');
	t.false(result.canAdoptWithoutForce);
	t.false(result.canMutate);
});

test('mine_active when same session lock is live for this pid', t => {
	const planPath = path.resolve('demo.md');
	const ownerLock = lock({
		planPath,
		sessionId: 'session-a',
		pid: process.pid,
	});
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-a',
		plan: plan('executing', 'session-a', planPath),
		lock: ownerLock,
	});
	t.is(result.kind, 'mine_active');
	t.true(result.canMutate);
	t.false(result.canAdoptWithoutForce);
	t.false(result.stale);
});

test('mine_recoverable when same session lock is missing', t => {
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-a',
		plan: plan('approved', 'session-a'),
		lock: null,
	});
	t.is(result.kind, 'mine_recoverable');
	t.true(result.canAdoptWithoutForce);
	t.false(result.canMutate);
});

test('mine_recoverable when same session lock pid is dead', t => {
	const planPath = path.resolve('demo.md');
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-a',
		plan: plan('executing', 'session-a', planPath),
		lock: lock({
			planPath,
			sessionId: 'session-a',
			pid: 2_147_483_647,
		}),
	});
	t.is(result.kind, 'mine_recoverable');
	t.true(result.canAdoptWithoutForce);
	t.false(result.canMutate);
	t.true(result.stale);
	t.is(result.pidAlive, false);
});

test('untagged executing plan is untagged_recoverable', t => {
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-a',
		plan: plan('executing'),
		lock: null,
	});
	t.is(result.kind, 'untagged_recoverable');
	t.true(result.canAdoptWithoutForce);
	t.false(result.canMutate);
});

test('foreign live lock requires force', t => {
	const planPath = path.resolve('demo.md');
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-b',
		plan: plan('executing', 'session-a', planPath),
		lock: lock({
			planPath,
			sessionId: 'session-a',
			pid: process.pid,
		}),
	});
	t.is(result.kind, 'foreign_live');
	t.false(result.canAdoptWithoutForce);
	t.false(result.canMutate);
	t.false(result.stale);
	t.false(result.softStale);
});

test('foreign soft-stale never allows silent adopt', t => {
	const now = Date.now();
	const planPath = path.resolve('demo.md');
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-b',
		plan: plan('executing', 'session-a', planPath),
		lock: lock({
			planPath,
			sessionId: 'session-a',
			pid: process.pid,
			heartbeatAt: new Date(
				now - PLAN_OWNER_LOCK_SOFT_STALE_MS - 1,
			).toISOString(),
		}),
		nowMs: now,
	});
	t.is(result.kind, 'foreign_soft_stale');
	t.false(result.canAdoptWithoutForce);
	t.false(result.canMutate);
	t.false(result.stale);
	t.true(result.softStale);
	t.is(result.pidAlive, true);
});

test('foreign hard-stale dead pid can adopt without force', t => {
	const planPath = path.resolve('demo.md');
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-b',
		plan: plan('executing', 'session-a', planPath),
		lock: lock({
			planPath,
			sessionId: 'session-a',
			pid: 2_147_483_647,
		}),
	});
	t.is(result.kind, 'foreign_hard_stale');
	t.true(result.canAdoptWithoutForce);
	t.false(result.canMutate);
	t.true(result.stale);
	t.is(result.pidAlive, false);
});

test('foreign hard-stale remote unknown age can adopt without force', t => {
	const now = Date.now();
	const planPath = path.resolve('demo.md');
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-b',
		plan: plan('executing', 'session-a', planPath),
		lock: lock({
			planPath,
			sessionId: 'session-a',
			hostname: `${os.hostname()}-remote`,
			heartbeatAt: new Date(now - PLAN_OWNER_LOCK_STALE_MS - 1).toISOString(),
		}),
		nowMs: now,
	});
	t.is(result.kind, 'foreign_hard_stale');
	t.true(result.canAdoptWithoutForce);
	t.true(result.stale);
	t.is(result.pidAlive, 'unknown');
	t.false(result.softStale);
});

test('foreign plan with no lock is hard-stale recoverable', t => {
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-b',
		plan: plan('executing', 'session-a'),
		lock: null,
	});
	t.is(result.kind, 'foreign_hard_stale');
	t.true(result.canAdoptWithoutForce);
	t.false(result.canMutate);
});

test('non-active plan status is none', t => {
	const result = classifyPlanOwnership({
		cwd: process.cwd(),
		sessionId: 'session-a',
		plan: plan('draft', 'session-a'),
		lock: null,
	});
	t.is(result.kind, 'none');
	t.false(result.canAdoptWithoutForce);
	t.false(result.canMutate);
});
