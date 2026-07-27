import anyTest, {type TestFn} from 'ava';
import {
	clearAllSubAgentLiveSlots,
	clearCompletedSubAgentLiveSlots,
	getSubAgentLiveSlot,
	getSubAgentLiveSnapshot,
	liveOnAgentDone,
	liveOnAgentStatus,
	liveOnToolEnd,
	liveOnToolStart,
	_flushSubAgentLiveNotifyForTests,
} from '../hooks/conversation/core/subAgentLiveStore.js';

const test = anyTest as unknown as TestFn;

test.beforeEach(() => {
	clearAllSubAgentLiveSlots();
	_flushSubAgentLiveNotifyForTests();
});

test.afterEach.always(() => {
	clearAllSubAgentLiveSlots();
	_flushSubAgentLiveNotifyForTests();
});

test('single tool start focuses tool with otherPendingCount 0', t => {
	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-1',
		toolName: 'filesystem-read',
		title: 'filesystem-read',
		startedAt: 1000,
	});

	const slot = getSubAgentLiveSlot('inst-1');
	t.truthy(slot);
	t.is(slot!.status, 'tool_focus');
	t.is(slot!.focus?.kind, 'tool');
	t.is(slot!.focus?.toolCallId, 'tc-1');
	t.is(slot!.focus?.startedAt, 1000);
	t.is(slot!.otherPendingCount, 0);
	t.is(slot!.startedAt, slot!.updatedAt > 0 ? slot!.startedAt : 0);
	t.true(slot!.startedAt > 0);
});

test('second tool start same agent focuses second and otherPendingCount 1', t => {
	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-1',
		toolName: 'filesystem-read',
		title: 'filesystem-read',
		startedAt: 1000,
	});
	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-2',
		toolName: 'filesystem-edit',
		title: 'filesystem-edit',
		startedAt: 2000,
	});

	const slot = getSubAgentLiveSlot('inst-1');
	t.truthy(slot);
	t.is(slot!.status, 'multi_pending');
	t.is(slot!.focus?.toolCallId, 'tc-2');
	t.is(slot!.focus?.startedAt, 2000);
	t.is(slot!.otherPendingCount, 1);
});

test('end focus tool switches focus to remaining pending', t => {
	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-1',
		toolName: 'filesystem-read',
		title: 'filesystem-read',
		startedAt: 1000,
	});
	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-2',
		toolName: 'filesystem-edit',
		title: 'filesystem-edit',
		startedAt: 2000,
	});

	// End the current focus (tc-2); remaining oldest is tc-1.
	liveOnToolEnd({agentId: 'inst-1', toolCallId: 'tc-2', ok: true});

	const slot = getSubAgentLiveSlot('inst-1');
	t.truthy(slot);
	t.is(slot!.focus?.toolCallId, 'tc-1');
	t.is(slot!.focus?.startedAt, 1000);
	t.is(slot!.status, 'tool_focus');
	t.is(slot!.otherPendingCount, 0);
});

test('end all tools clears focus but keeps slot until done', t => {
	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-1',
		toolName: 'filesystem-read',
		title: 'filesystem-read',
		startedAt: 1000,
	});
	liveOnToolEnd({agentId: 'inst-1', toolCallId: 'tc-1', ok: true});

	const slot = getSubAgentLiveSlot('inst-1');
	t.truthy(slot);
	t.is(slot!.focus, undefined);
	t.is(slot!.otherPendingCount, 0);
	t.not(slot!.status, 'completed');
	t.is(getSubAgentLiveSnapshot().length, 1);
});

test('liveOnAgentDone marks slot completed and freezes duration', t => {
	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-1',
		toolName: 'filesystem-read',
		title: 'filesystem-read',
	});
	liveOnAgentDone('inst-1');

	const slot = getSubAgentLiveSlot('inst-1');
	t.truthy(slot);
	t.is(slot!.status, 'completed');
	t.true(typeof slot!.durationMs === 'number');
	t.is(slot!.focus, undefined);
	t.is(slot!.otherPendingCount, 0);
	t.is(getSubAgentLiveSnapshot().length, 1);
});

test('clearCompletedSubAgentLiveSlots removes only terminal slots', t => {
	liveOnToolStart({
		agentId: 'inst-done',
		agentName: 'Explore Agent',
		toolCallId: 'tc-1',
		toolName: 'filesystem-read',
		title: 'filesystem-read',
	});
	liveOnAgentDone('inst-done');

	liveOnToolStart({
		agentId: 'inst-active',
		agentName: 'General Purpose Agent',
		toolCallId: 'tc-2',
		toolName: 'terminal-execute',
		title: 'terminal-execute',
	});

	clearCompletedSubAgentLiveSlots();
	t.is(getSubAgentLiveSlot('inst-done'), undefined);
	t.truthy(getSubAgentLiveSlot('inst-active'));
	t.is(getSubAgentLiveSnapshot().length, 1);
});

test('two agents are independent', t => {
	liveOnToolStart({
		agentId: 'inst-a',
		agentName: 'Explore Agent',
		toolCallId: 'tc-a1',
		toolName: 'filesystem-read',
		title: 'filesystem-read',
		startedAt: 1000,
	});
	liveOnToolStart({
		agentId: 'inst-b',
		agentName: 'Explore Agent',
		toolCallId: 'tc-b1',
		toolName: 'terminal-execute',
		title: 'terminal-execute',
		startedAt: 1500,
	});
	liveOnToolStart({
		agentId: 'inst-a',
		agentName: 'Explore Agent',
		toolCallId: 'tc-a2',
		toolName: 'filesystem-edit',
		title: 'filesystem-edit',
		startedAt: 2000,
	});

	const a = getSubAgentLiveSlot('inst-a');
	const b = getSubAgentLiveSlot('inst-b');
	t.truthy(a);
	t.truthy(b);
	t.is(a!.focus?.toolCallId, 'tc-a2');
	t.is(a!.otherPendingCount, 1);
	t.is(b!.focus?.toolCallId, 'tc-b1');
	t.is(b!.otherPendingCount, 0);
	// Do not assert global snapshot length — parallel AVA workers share process state.
	t.truthy(getSubAgentLiveSnapshot().some(s => s.agentId === 'inst-a'));
	t.truthy(getSubAgentLiveSnapshot().some(s => s.agentId === 'inst-b'));
});

test('clearAll empties all slots', t => {
	liveOnToolStart({
		agentId: 'inst-a',
		agentName: 'A',
		toolCallId: 'tc-1',
		toolName: 'x',
		title: 'x',
	});
	liveOnToolStart({
		agentId: 'inst-b',
		agentName: 'B',
		toolCallId: 'tc-2',
		toolName: 'y',
		title: 'y',
	});
	clearAllSubAgentLiveSlots();
	t.is(getSubAgentLiveSnapshot().length, 0);
	t.is(getSubAgentLiveSlot('inst-a'), undefined);
	t.is(getSubAgentLiveSlot('inst-b'), undefined);
});

test('startedAt preserved across status updates', t => {
	liveOnAgentStatus({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		status: 'thinking',
		isReasoning: true,
	});
	const first = getSubAgentLiveSlot('inst-1');
	t.truthy(first);
	const startedAt = first!.startedAt;
	t.true(startedAt > 0);

	liveOnAgentStatus({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		status: 'writing',
		tokenCount: 42,
		isReasoning: false,
		preview: 'hello',
	});
	const second = getSubAgentLiveSlot('inst-1');
	t.truthy(second);
	t.is(second!.startedAt, startedAt);
	t.is(second!.tokenCount, 42);
	t.is(second!.preview, 'hello');
	t.is(second!.isReasoning, false);
});

test('snapshot array identity is stable when data is unchanged', t => {
	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-1',
		toolName: 'filesystem-read',
		title: 'filesystem-read',
	});
	const snap1 = getSubAgentLiveSnapshot();
	const snap2 = getSubAgentLiveSnapshot();
	t.is(snap1, snap2);

	liveOnToolStart({
		agentId: 'inst-1',
		agentName: 'Explore Agent',
		toolCallId: 'tc-2',
		toolName: 'filesystem-edit',
		title: 'filesystem-edit',
	});
	const snap3 = getSubAgentLiveSnapshot();
	t.not(snap1, snap3);
});
