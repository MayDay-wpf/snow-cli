import anyTest, {type TestFn} from 'ava';
import {
	clearAllSubAgentLiveSlots,
	clearSubAgentLiveSlotsNotInSession,
	getAllSubAgentLiveSlots,
	getSubAgentLiveSnapshot,
	liveOnToolStart,
	_flushSubAgentLiveNotifyForTests,
} from '../hooks/conversation/core/subAgentLiveStore.js';
import {
	clearSubAgentRuns,
	getAllSubAgentRuns,
	getSubAgentRunSnapshot,
	hydrateSubAgentRunsFromSession,
	startSubAgentRun,
	subscribeSubAgentRuns,
} from '../hooks/conversation/core/subAgentRunStore.js';
import {runningSubAgentTracker} from '../utils/execution/runningSubAgentTracker.js';
import {sessionManager, type Session} from '../utils/session/sessionManager.js';

const test = anyTest as unknown as TestFn;

function makeSession(
	id: string,
	projectId = 'proj-isolation',
	overrides: Partial<Session> = {},
): Session {
	const now = Date.now();
	return {
		id,
		title: `session-${id}`,
		summary: '',
		createdAt: now,
		updatedAt: now,
		messages: [],
		messageCount: 0,
		projectId,
		projectPath: process.cwd(),
		isTemporary: true,
		...overrides,
	} as Session;
}

function setSession(session: Session): void {
	sessionManager.setCurrentSession(session);
}

/** Set current session without hydrate/clear side effects (test fixture only). */
function setSessionSilently(session: Session): void {
	(
		sessionManager as unknown as {currentSession: Session | null}
	).currentSession = session;
}
function registerAgent(input: {
	instanceId: string;
	agentId?: string;
	agentName?: string;
	sessionId?: string;
	projectId?: string;
}): void {
	runningSubAgentTracker.register({
		instanceId: input.instanceId,
		agentId: input.agentId ?? 'agent_explore',
		agentName: input.agentName ?? 'Explore Agent',
		prompt: `prompt-${input.instanceId}`,
		startedAt: new Date(),
		sessionId: input.sessionId,
		projectId: input.projectId,
	});
}

function toolStart(agentId: string, toolCallId: string): void {
	liveOnToolStart({
		agentId,
		agentName: 'Explore Agent',
		toolCallId,
		toolName: 'filesystem-read',
		title: 'filesystem-read',
		startedAt: Date.now(),
	});
}

test.beforeEach(() => {
	runningSubAgentTracker.clear();
	clearAllSubAgentLiveSlots();
	clearSubAgentRuns();
	_flushSubAgentLiveNotifyForTests();
	sessionManager.clearCurrentSession();
});

test.afterEach.always(() => {
	runningSubAgentTracker.clear();
	clearAllSubAgentLiveSlots();
	clearSubAgentRuns();
	_flushSubAgentLiveNotifyForTests();
	sessionManager.clearCurrentSession();
});

test.serial(
	'same process different sessions: live + running agent isolation',
	t => {
		const sessionA = makeSession('sess-a');
		const sessionB = makeSession('sess-b');

		setSession(sessionA);
		registerAgent({
			instanceId: 'run-a',
			sessionId: sessionA.id,
			projectId: sessionA.projectId,
		});
		toolStart('live-a', 'tc-a1');

		t.true(
			runningSubAgentTracker
				.getRunningAgents()
				.some(a => a.instanceId === 'run-a'),
		);
		t.true(getSubAgentLiveSnapshot().some(s => s.agentId === 'live-a'));
		t.is(
			getSubAgentLiveSnapshot().find(s => s.agentId === 'live-a')?.sessionId,
			sessionA.id,
		);

		// Switch to B: tracker keeps background agent; live foreign slots cleared.
		setSession(sessionB);

		t.false(
			runningSubAgentTracker
				.getRunningAgents()
				.some(a => a.instanceId === 'run-a'),
		);
		t.false(getSubAgentLiveSnapshot().some(s => s.agentId === 'live-a'));
		t.true(
			runningSubAgentTracker
				.getAllRunningAgents()
				.some(a => a.instanceId === 'run-a'),
		);
		t.true(
			runningSubAgentTracker
				.getRunningAgents({all: true})
				.some(a => a.instanceId === 'run-a'),
		);
	},
);

test.serial('history isolation across session switch + hydrate', t => {
	const sessionA = makeSession('sess-a-hist');
	const sessionB = makeSession('sess-b-hist');

	setSession(sessionA);
	startSubAgentRun({
		instanceId: 'hist-a',
		agentId: 'agent_explore',
		agentName: 'Explore Agent',
		prompt: 'from A',
	});

	t.true(getSubAgentRunSnapshot().some(r => r.instanceId === 'hist-a'));
	t.is(
		getSubAgentRunSnapshot().find(r => r.instanceId === 'hist-a')?.sessionId,
		sessionA.id,
	);

	// Persist path wrote A runs onto the session object.
	t.true((sessionA.subAgentRuns ?? []).some(r => r.instanceId === 'hist-a'));

	setSession(sessionB);
	// Default view is session-scoped: A's run is hidden on B.
	t.false(getSubAgentRunSnapshot().some(r => r.instanceId === 'hist-a'));

	// Hydrate A while still on B: memory has A, default snapshot still filters by B.
	hydrateSubAgentRunsFromSession(sessionA);
	t.true(getAllSubAgentRuns().some(r => r.instanceId === 'hist-a'));
	t.false(getSubAgentRunSnapshot().some(r => r.instanceId === 'hist-a'));
	t.true(
		getSubAgentRunSnapshot({sessionId: sessionA.id}).some(
			r => r.instanceId === 'hist-a',
		),
	);

	// Switch back to A: hydrate + default snapshot show A again.
	setSession(sessionA);
	t.true(getSubAgentRunSnapshot().some(r => r.instanceId === 'hist-a'));
});

test.serial('run history notifications are deferred and batched', async t => {
	// Flush cleanup notifications scheduled by the test hook before subscribing.
	await Promise.resolve();
	let notifications = 0;
	const unsubscribe = subscribeSubAgentRuns(() => {
		notifications++;
	});

	startSubAgentRun({
		instanceId: 'notify-batch',
		agentId: 'agent_explore',
		agentName: 'Explore Agent',
		prompt: 'verify deferred notifications',
	});
	startSubAgentRun({
		instanceId: 'notify-batch-2',
		agentId: 'agent_explore',
		agentName: 'Explore Agent',
		prompt: 'verify batching',
	});

	t.is(notifications, 0);
	await Promise.resolve();
	t.is(notifications, 1);
	unsubscribe();
});

test.serial('peer agents and inter-agent messages respect session scope', t => {
	const sessionA = makeSession('sess-peer-a', 'proj-1');
	const sessionB = makeSession('sess-peer-b', 'proj-1');

	registerAgent({
		instanceId: 'peer-a1',
		agentId: 'agent_explore',
		sessionId: sessionA.id,
		projectId: sessionA.projectId,
	});
	registerAgent({
		instanceId: 'peer-a2',
		agentId: 'agent_general',
		agentName: 'General Purpose Agent',
		sessionId: sessionA.id,
		projectId: sessionA.projectId,
	});
	registerAgent({
		instanceId: 'peer-b1',
		agentId: 'agent_explore',
		sessionId: sessionB.id,
		projectId: sessionB.projectId,
	});

	const peersFromA = runningSubAgentTracker.getPeerAgents('peer-a1');
	t.true(peersFromA.some(a => a.instanceId === 'peer-a2'));
	t.false(peersFromA.some(a => a.instanceId === 'peer-b1'));

	const peersFromB = runningSubAgentTracker.getPeerAgents('peer-b1');
	t.false(peersFromB.some(a => a.instanceId === 'peer-a1'));
	t.false(peersFromB.some(a => a.instanceId === 'peer-a2'));

	t.false(
		runningSubAgentTracker.sendInterAgentMessage(
			'peer-a1',
			'peer-b1',
			'cross session should fail',
		),
	);
	t.true(
		runningSubAgentTracker.sendInterAgentMessage(
			'peer-a1',
			'peer-a2',
			'same session should work',
		),
	);

	// findInstanceByAgentId defaults to current session scope.
	setSession(sessionA);
	t.is(
		runningSubAgentTracker.findInstanceByAgentId('agent_explore')?.instanceId,
		'peer-a1',
	);
	setSession(sessionB);
	t.is(
		runningSubAgentTracker.findInstanceByAgentId('agent_explore')?.instanceId,
		'peer-b1',
	);
});

test.serial('persistToCurrentSession does not pollute other sessions', t => {
	const sessionA = makeSession('sess-persist-a');
	const sessionB = makeSession('sess-persist-b');

	setSession(sessionA);
	startSubAgentRun({
		instanceId: 'persist-a',
		agentId: 'agent_explore',
		agentName: 'Explore Agent',
		prompt: 'A run',
	});
	t.true((sessionA.subAgentRuns ?? []).some(r => r.instanceId === 'persist-a'));

	setSession(sessionB);
	startSubAgentRun({
		instanceId: 'persist-b',
		agentId: 'agent_general',
		agentName: 'General Purpose Agent',
		prompt: 'B run',
	});

	const bRuns = sessionB.subAgentRuns ?? [];
	t.true(bRuns.some(r => r.instanceId === 'persist-b'));
	t.false(bRuns.some(r => r.instanceId === 'persist-a'));

	// A still only has its own runs from the earlier persist.
	const aRuns = sessionA.subAgentRuns ?? [];
	t.true(aRuns.some(r => r.instanceId === 'persist-a'));
	t.false(aRuns.some(r => r.instanceId === 'persist-b'));
});

test.serial(
	'clearSubAgentLiveSlotsNotInSession keeps only target session slots',
	t => {
		const sessionA = makeSession('sess-clear-a');
		const sessionB = makeSession('sess-clear-b');

		// Build dual-session live state without setCurrentSession side effects.
		setSessionSilently(sessionA);
		toolStart('slot-a', 'tc-a');
		setSessionSilently(sessionB);
		toolStart('slot-b', 'tc-b');

		const allBefore = getAllSubAgentLiveSlots();
		t.true(
			allBefore.some(
				s => s.agentId === 'slot-a' && s.sessionId === sessionA.id,
			),
		);
		t.true(
			allBefore.some(
				s => s.agentId === 'slot-b' && s.sessionId === sessionB.id,
			),
		);

		clearSubAgentLiveSlotsNotInSession(sessionB.id);

		const allAfter = getAllSubAgentLiveSlots();
		t.false(allAfter.some(s => s.agentId === 'slot-a'));
		t.true(allAfter.some(s => s.agentId === 'slot-b'));
		t.is(allAfter.length, 1);

		// Default snapshot follows current session (B).
		t.true(getSubAgentLiveSnapshot().some(s => s.agentId === 'slot-b'));
	},
);
