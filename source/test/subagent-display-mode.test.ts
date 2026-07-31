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
import {getTimelineWindow} from '../utils/ui/subAgentTimeline.js';

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

test('detail timeline window is capped at five rows and reports scroll counts', t => {
	const timeline = Array.from({length: 9}, (_, index) => `tool-${index + 1}`);
	const first = getTimelineWindow(timeline, 0, 8);
	t.deepEqual(first.visibleLines, timeline.slice(0, 5));
	t.is(first.moreAbove, 0);
	t.is(first.moreBelow, 4);

	const middle = getTimelineWindow(timeline, 2, 5);
	t.deepEqual(middle.visibleLines, timeline.slice(2, 7));
	t.is(middle.moreAbove, 2);
	t.is(middle.moreBelow, 2);

	const end = getTimelineWindow(timeline, 99, 5);
	t.deepEqual(end.visibleLines, timeline.slice(4));
	t.is(end.offset, 4);
	t.is(end.moreAbove, 4);
	t.is(end.moreBelow, 0);
});

test('detail timeline keeps a four-row minimum for compact callers', t => {
	const timeline = ['one', 'two', 'three', 'four', 'five'];
	const window = getTimelineWindow(timeline, 0, 1);
	t.deepEqual(window.visibleLines, timeline.slice(0, 4));
	t.is(window.moreBelow, 1);
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
