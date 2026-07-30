import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	PLAN_OWNER_LOCK_SOFT_STALE_MS,
	PLAN_OWNER_LOCK_STALE_MS,
	acquirePlanOwnerLock,
	getLockLiveness,
	getPlanOwnerLockPath,
	isLockStale,
	readPlanOwnerLock,
	refreshPlanOwnerHeartbeat,
	releasePlanOwnerLock,
	verifyPlanOwnerLock,
	type PlanOwnerLock,
} from '../utils/execution/planOwnerLock.js';

const test = anyTest as unknown as TestFn;

async function makeWorkspace(): Promise<{cwd: string; planPath: string}> {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-owner-lock-'));
	const planPath = path.join(cwd, '.snow', 'plan', 'demo.md');
	await fs.mkdir(path.dirname(planPath), {recursive: true});
	await fs.writeFile(planPath, '# plan\n', 'utf8');
	return {cwd, planPath};
}

function owner(overrides: Partial<PlanOwnerLock> = {}): PlanOwnerLock {
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

async function writeLock(cwd: string, lock: PlanOwnerLock): Promise<void> {
	const lockPath = getPlanOwnerLockPath(cwd);
	await fs.mkdir(path.dirname(lockPath), {recursive: true});
	await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
}

test('first acquisition is exclusive and same owner refreshes heartbeat', async t => {
	const {cwd, planPath} = await makeWorkspace();
	const results = await Promise.all([
		acquirePlanOwnerLock(cwd, {planPath, sessionId: 'session-a'}),
		acquirePlanOwnerLock(cwd, {planPath, sessionId: 'session-a'}),
	]);

	t.true(results.every(result => result.ok));
	const initial = await readPlanOwnerLock(cwd);
	t.truthy(initial);
	const refreshed = await acquirePlanOwnerLock(cwd, {
		planPath,
		sessionId: 'session-a',
	});
	t.true(refreshed.ok);
	if (refreshed.ok) {
		t.false(refreshed.tookOver);
		t.is(refreshed.lock.acquiredAt, initial!.acquiredAt);
	}
});

test('empty session can refresh only the exact same process owner', async t => {
	const {cwd, planPath} = await makeWorkspace();
	const first = await acquirePlanOwnerLock(cwd, {planPath, sessionId: ''});
	t.true(first.ok);
	const refreshed = await acquirePlanOwnerLock(cwd, {planPath, sessionId: ''});
	t.true(refreshed.ok);
	if (refreshed.ok) {
		t.false(refreshed.tookOver);
	}

	const foreignPid = await acquirePlanOwnerLock(cwd, {
		planPath,
		sessionId: '',
		pid: process.pid + 100_000,
	});
	t.false(foreignPid.ok);
});

test('live foreign owner conflicts unless takeover is explicit', async t => {
	const {cwd, planPath} = await makeWorkspace();
	await acquirePlanOwnerLock(cwd, {planPath, sessionId: 'session-a'});

	const blocked = await acquirePlanOwnerLock(cwd, {
		planPath,
		sessionId: 'session-b',
	});
	t.false(blocked.ok);
	if (!blocked.ok) {
		t.false(blocked.conflict.stale);
		t.is(blocked.conflict.pidAlive, true);
	}

	const forced = await acquirePlanOwnerLock(cwd, {
		planPath,
		sessionId: 'session-b',
		force: true,
	});
	t.true(forced.ok);
	if (forced.ok) {
		t.true(forced.tookOver);
		t.is(forced.previousLock?.sessionId, 'session-a');
		t.is(forced.lock.sessionId, 'session-b');
	}
});

test('dead local pid and old remote owner are stale', async t => {
	const now = Date.now();
	const dead = owner({pid: 2_147_483_647});
	const deadState = isLockStale(dead, now);
	t.true(deadState.stale);
	t.is(deadState.pidAlive, false);

	const remoteFresh = owner({
		hostname: `${os.hostname()}-remote`,
		heartbeatAt: new Date(now - 1_000).toISOString(),
	});
	t.deepEqual(isLockStale(remoteFresh, now), {
		stale: false,
		pidAlive: 'unknown',
	});
	const remoteOld = {
		...remoteFresh,
		heartbeatAt: new Date(now - PLAN_OWNER_LOCK_STALE_MS - 1).toISOString(),
	};
	t.deepEqual(isLockStale(remoteOld, now), {
		stale: true,
		pidAlive: 'unknown',
	});
});

test('confirmed-live local owner never expires only because of age', t => {
	const now = Date.now();
	const live = owner({
		heartbeatAt: new Date(now - PLAN_OWNER_LOCK_STALE_MS * 10).toISOString(),
	});
	t.deepEqual(isLockStale(live, now), {stale: false, pidAlive: true});
});

test('soft-stale is live pid with old heartbeat and is not hard-stale', t => {
	const now = Date.now();
	const soft = owner({
		heartbeatAt: new Date(
			now - PLAN_OWNER_LOCK_SOFT_STALE_MS - 1,
		).toISOString(),
	});
	t.deepEqual(getLockLiveness(soft, now), {
		pidAlive: true,
		hardStale: false,
		softStale: true,
	});
	// isLockStale remains hard-stale only for backward compatibility.
	t.deepEqual(isLockStale(soft, now), {stale: false, pidAlive: true});

	const fresh = owner({
		heartbeatAt: new Date(now - 1_000).toISOString(),
	});
	t.deepEqual(getLockLiveness(fresh, now), {
		pidAlive: true,
		hardStale: false,
		softStale: false,
	});

	// Cross-host never soft-stales; only hard rules apply.
	const remoteSoftAge = owner({
		hostname: `${os.hostname()}-remote`,
		heartbeatAt: new Date(
			now - PLAN_OWNER_LOCK_SOFT_STALE_MS - 1,
		).toISOString(),
	});
	t.deepEqual(getLockLiveness(remoteSoftAge, now), {
		pidAlive: 'unknown',
		hardStale: false,
		softStale: false,
	});
});

test('dead owner is recovered without force', async t => {
	const {cwd, planPath} = await makeWorkspace();
	await writeLock(
		cwd,
		owner({
			planPath,
			sessionId: 'dead-session',
			pid: 2_147_483_647,
		}),
	);

	const recovered = await acquirePlanOwnerLock(cwd, {
		planPath,
		sessionId: 'session-b',
	});
	t.true(recovered.ok);
	if (recovered.ok) {
		t.true(recovered.tookOver);
		t.is(recovered.previousLock?.sessionId, 'dead-session');
	}
});

test('heartbeat refresh updates only same owner and never steals', async t => {
	const {cwd, planPath} = await makeWorkspace();
	const acquired = await acquirePlanOwnerLock(cwd, {
		planPath,
		sessionId: 'session-a',
	});
	t.true(acquired.ok);
	if (!acquired.ok) {
		return;
	}

	const before = acquired.lock.heartbeatAt;
	await new Promise(resolve => setTimeout(resolve, 5));
	const refreshed = await refreshPlanOwnerHeartbeat(cwd, {
		planPath,
		sessionId: 'session-a',
	});
	t.true(refreshed.ok);
	if (refreshed.ok) {
		t.is(refreshed.lock.acquiredAt, acquired.lock.acquiredAt);
		t.true(refreshed.lock.heartbeatAt >= before);
		t.not(refreshed.lock.heartbeatAt, before);
	}

	const foreign = await refreshPlanOwnerHeartbeat(cwd, {
		planPath,
		sessionId: 'session-b',
	});
	t.false(foreign.ok);
	if (!foreign.ok) {
		t.is(foreign.reason, 'foreign');
	}
	// Foreign refresh must not rewrite the lock owner.
	const still = await readPlanOwnerLock(cwd);
	t.is(still?.sessionId, 'session-a');
	t.is(still?.pid, process.pid);
});

test('heartbeat refresh reports missing when no lock exists', async t => {
	const {cwd, planPath} = await makeWorkspace();
	const missing = await refreshPlanOwnerHeartbeat(cwd, {
		planPath,
		sessionId: 'session-a',
	});
	t.false(missing.ok);
	if (!missing.ok) {
		t.is(missing.reason, 'missing');
	}
});

test('release and verification require the matching owner identity', async t => {
	const {cwd, planPath} = await makeWorkspace();
	await acquirePlanOwnerLock(cwd, {planPath, sessionId: 'session-a'});

	const foreignVerification = await verifyPlanOwnerLock(cwd, {
		planPath,
		sessionId: 'session-b',
	});
	t.false(foreignVerification.ok);
	if (!foreignVerification.ok) {
		t.true(foreignVerification.message.startsWith('Plan owner changed'));
	}

	t.false(
		await releasePlanOwnerLock(cwd, {
			planPath,
			sessionId: 'session-b',
		}),
	);
	t.truthy(await readPlanOwnerLock(cwd));
	t.true(
		await releasePlanOwnerLock(cwd, {
			planPath,
			sessionId: 'session-a',
		}),
	);
	t.is(await readPlanOwnerLock(cwd), null);
});

test('malformed lock is ignored and replaced through exclusive create retries', async t => {
	const {cwd, planPath} = await makeWorkspace();
	const lockPath = getPlanOwnerLockPath(cwd);
	await fs.mkdir(path.dirname(lockPath), {recursive: true});
	await fs.writeFile(lockPath, '{not json', 'utf8');

	await t.throwsAsync(
		() => acquirePlanOwnerLock(cwd, {planPath, sessionId: 'session-a'}),
		{message: /Failed to acquire plan owner lock/},
	);
	const raw = await fs.readFile(lockPath, 'utf8');
	t.is(raw, '{not json');
});
