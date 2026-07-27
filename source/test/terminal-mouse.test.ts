import anyTest, {type TestFn} from 'ava';
import {
	acquireTerminalMouseTracking,
	parseSgrMouseWheel,
	parseTerminalMouseWheel,
	parseX10MouseWheel,
	resetTerminalMouseTrackingForTests,
	TERMINAL_MOUSE_DISABLE,
	TERMINAL_MOUSE_ENABLE,
} from '../utils/ui/terminalMouse.js';

const test = anyTest as unknown as TestFn;

test.beforeEach(() => {
	resetTerminalMouseTrackingForTests();
});

test('parseSgrMouseWheel detects wheel up/down with coordinates', t => {
	const up = parseSgrMouseWheel('\u001b[<64;12;8M');
	t.deepEqual(up, {
		direction: 'up',
		deltaLines: 1,
		column: 12,
		row: 8,
	});

	const down = parseSgrMouseWheel('\u001b[<65;3;20M');
	t.deepEqual(down, {
		direction: 'down',
		deltaLines: 1,
		column: 3,
		row: 20,
	});
});

test('parseSgrMouseWheel ignores releases, clicks, and incomplete sequences', t => {
	t.is(parseSgrMouseWheel('\u001b[<64;12;8m'), null); // release
	t.is(parseSgrMouseWheel('\u001b[<0;12;8M'), null); // left click
	t.is(parseSgrMouseWheel('\u001b[<64;12;8'), null); // incomplete
	t.is(parseSgrMouseWheel(''), null);
});

test('parseSgrMouseWheel tolerates modifier bits on wheel buttons', t => {
	// Shift (+4) wheel down
	const shifted = parseSgrMouseWheel('\u001b[<69;1;1M');
	t.is(shifted?.direction, 'down');
});

test('parseX10MouseWheel detects wheel ticks', t => {
	// button 64 + 32 = 96 ('`'), col 10+32, row 5+32
	const up = parseX10MouseWheel(
		`\u001b[M${String.fromCharCode(96)}${String.fromCharCode(
			42,
		)}${String.fromCharCode(37)}`,
	);
	t.is(up?.direction, 'up');
	t.is(up?.column, 10);
	t.is(up?.row, 5);

	const down = parseX10MouseWheel(
		`\u001b[M${String.fromCharCode(97)}${String.fromCharCode(
			33,
		)}${String.fromCharCode(33)}`,
	);
	t.is(down?.direction, 'down');
});

test('parseTerminalMouseWheel prefers SGR over X10', t => {
	const event = parseTerminalMouseWheel('\u001b[<64;2;3M');
	t.is(event?.direction, 'up');
	t.is(event?.column, 2);
});

test('acquireTerminalMouseTracking ref-counts enable/disable', t => {
	const writes: string[] = [];
	const write = (data: string) => {
		writes.push(data);
	};

	const releaseA = acquireTerminalMouseTracking(write);
	t.deepEqual(writes, [TERMINAL_MOUSE_ENABLE]);

	const releaseB = acquireTerminalMouseTracking(write);
	t.deepEqual(writes, [TERMINAL_MOUSE_ENABLE]);

	releaseA();
	t.deepEqual(writes, [TERMINAL_MOUSE_ENABLE]);

	releaseB();
	t.deepEqual(writes, [TERMINAL_MOUSE_ENABLE, TERMINAL_MOUSE_DISABLE]);

	// Double-release is a no-op
	releaseB();
	t.deepEqual(writes, [TERMINAL_MOUSE_ENABLE, TERMINAL_MOUSE_DISABLE]);
});
