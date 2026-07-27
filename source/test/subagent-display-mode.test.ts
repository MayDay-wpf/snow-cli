import anyTest, {type TestFn} from 'ava';
import {
	getSubAgentDisplayMode,
	setSubAgentDisplayMode,
} from '../utils/config/themeConfig.js';
import {
	clearAllSubAgentLiveSlots,
	getSubAgentLiveSlot,
	liveOnToolStart,
	liveOnToolEnd,
	_flushSubAgentLiveNotifyForTests,
} from '../hooks/conversation/core/subAgentLiveStore.js';

const test = anyTest as unknown as TestFn;

test.beforeEach(() => {
	setSubAgentDisplayMode('slots');
	clearAllSubAgentLiveSlots();
	_flushSubAgentLiveNotifyForTests();
});

test.afterEach.always(() => {
	setSubAgentDisplayMode('slots');
	clearAllSubAgentLiveSlots();
	_flushSubAgentLiveNotifyForTests();
});

test('themeConfig subAgentDisplayMode defaults to slots', t => {
	t.is(getSubAgentDisplayMode(), 'slots');
});

test('themeConfig subAgentDisplayMode persists modes', t => {
	for (const mode of ['slots', 'multi', 'compact', 'hidden'] as const) {
		setSubAgentDisplayMode(mode);
		t.is(getSubAgentDisplayMode(), mode);
	}
});

test('live store keeps recent history lines when multi tools run', t => {
	liveOnToolStart({
		agentId: 'disp-1',
		agentName: 'General Purpose Agent',
		toolCallId: 't1',
		toolName: 'filesystem-read',
		title: 'filesystem-read a',
	});
	liveOnToolEnd({agentId: 'disp-1', toolCallId: 't1', ok: true});
	liveOnToolStart({
		agentId: 'disp-1',
		agentName: 'General Purpose Agent',
		toolCallId: 't2',
		toolName: 'filesystem-edit',
		title: 'filesystem-edit b',
	});

	const slot = getSubAgentLiveSlot('disp-1');
	t.truthy(slot);
	t.true(Array.isArray(slot!.historyLines));
	t.true((slot!.historyLines?.length || 0) >= 1);
	t.true((slot!.historyLines || []).some(l => l.includes('filesystem')));
});
