import anyTest, {type TestFn} from 'ava';
import {runningSubAgentTracker} from '../utils/execution/runningSubAgentTracker.js';
import {teamTracker} from '../utils/execution/teamTracker.js';

const test = anyTest as unknown as TestFn;

function delay<T>(milliseconds: number, value: T): Promise<T> {
	return new Promise(resolve => {
		setTimeout(() => resolve(value), milliseconds);
	});
}

test.beforeEach(() => {
	runningSubAgentTracker.clear();
	teamTracker.clear();
});

test.afterEach.always(() => {
	runningSubAgentTracker.clear();
	teamTracker.clear();
});
test.serial(
	'waitForSpawnedAgents does not enforce timeout without notification',
	async t => {
		t.timeout(2000);
		runningSubAgentTracker.register({
			instanceId: 'spawn-timeout-contract',
			agentId: 'agent_explore',
			agentName: 'Explore Agent',
			prompt: 'timeout contract',
			startedAt: new Date(),
		});

		const waiting = runningSubAgentTracker.waitForSpawnedAgents(20);
		const outcome = await Promise.race([
			waiting.then(value => ({kind: 'settled' as const, value})),
			delay(150, {kind: 'watchdog' as const}),
		]);
		t.deepEqual(outcome, {kind: 'watchdog'});

		runningSubAgentTracker.unregister('spawn-timeout-contract');
		t.true(await waiting);
	},
);

test.serial(
	'waitForAllTeammates does not enforce timeout without notification',
	async t => {
		t.timeout(2000);
		teamTracker.register({
			instanceId: 'teammate-timeout-contract',
			memberId: 'member-timeout-contract',
			memberName: 'Timeout Contract',
			worktreePath: process.cwd(),
			teamName: 'contract-team',
			prompt: 'timeout contract',
			startedAt: new Date(),
		});

		const waiting = teamTracker.waitForAllTeammates(20);
		const outcome = await Promise.race([
			waiting.then(value => ({kind: 'settled' as const, value})),
			delay(150, {kind: 'watchdog' as const}),
		]);
		t.deepEqual(outcome, {kind: 'watchdog'});

		teamTracker.setStandby('teammate-timeout-contract');
		t.true(await waiting);
	},
);
