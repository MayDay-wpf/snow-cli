import anyTest, {type TestFn} from 'ava';
import {
	clampSubAgentLine,
	getSubAgentPanelLayout,
	getTimelineWindow,
} from '../utils/ui/subAgentTimeline.js';

const test = anyTest as unknown as TestFn;

test('detail timeline keeps its entire tool block within five rows', t => {
	const timeline = Array.from({length: 8}, (_, index) => `tool-${index + 1}`);
	const window = getTimelineWindow(timeline, 0, 8);

	t.deepEqual(window.visibleLines, timeline.slice(0, 5));
	t.is(window.visibleLines.length, 5);
	t.is(window.moreAbove, 0);
	t.is(window.moreBelow, 3);
});

test('detail timeline clamps offsets and reports remaining rows', t => {
	const timeline = Array.from({length: 8}, (_, index) => `tool-${index + 1}`);
	const window = getTimelineWindow(timeline, 99, 5);

	t.deepEqual(window.visibleLines, timeline.slice(3));
	t.is(window.offset, 3);
	t.is(window.moreAbove, 3);
	t.is(window.moreBelow, 0);
});

test('detail panel width stays inside physical terminal padding', t => {
	for (const width of [20, 39, 40, 80]) {
		const layout = getSubAgentPanelLayout(width);
		t.is(layout.panelWidth, width - 2);
		t.true(layout.maxLineCols >= 1);
		t.true(layout.maxLineCols <= layout.panelWidth);
	}
});

test('detail lines clamp by terminal columns for Chinese and emoji', t => {
	t.is(clampSubAgentLine('中文测试', 5), '中...');
	t.is(clampSubAgentLine('🙂🙂🙂', 5), '🙂...');
	t.is(clampSubAgentLine('中文', 4), '中文');
});

test('detail timeline normalizes non-finite and fractional inputs', t => {
	const timeline = Array.from({length: 8}, (_, index) => `tool-${index + 1}`);

	t.is(getTimelineWindow(timeline, Number.NaN, Number.NaN).offset, 0);
	t.is(getTimelineWindow(timeline, Number.POSITIVE_INFINITY, 5).offset, 0);
	t.is(getTimelineWindow(timeline, 2.9, 4.9).offset, 2);
	t.is(getTimelineWindow(timeline, 2.9, 4.9).visibleLines.length, 4);
	t.is(
		getTimelineWindow(timeline, 2, Number.POSITIVE_INFINITY).visibleLines
			.length,
		5,
	);
});
