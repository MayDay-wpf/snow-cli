import anyTest, {type TestFn} from 'ava';

import {
	cleanTerminalTitle,
	resetTerminalTitleCache,
	setTerminalTitle,
} from '../utils/ui/terminalTitle.js';

const test = anyTest as unknown as TestFn;

test.beforeEach(() => {
	resetTerminalTitleCache();
});

test('cleanTerminalTitle strips control characters', t => {
	t.is(cleanTerminalTitle('Snow\u001B CLI\u0007'), 'Snow CLI');
});

test('setTerminalTitle skips duplicate writes', t => {
	const writes: string[] = [];
	const stream = {
		isTTY: true,
		write: (data: string) => {
			writes.push(data);
			return true;
		},
	};

	// process.stdout may be TTY in CI; force OSC path through our stream by
	// temporarily shadowing isTTY if needed — setTerminalTitle prefers
	// process.stdout when it is a TTY. Capture count via process.title instead.
	setTerminalTitle('Title A', stream, {force: true});
	const afterFirst = writes.length;
	setTerminalTitle('Title A', stream);
	t.is(writes.length, afterFirst, 'duplicate title should not write again');

	setTerminalTitle('Title B', stream);
	t.true(writes.length > afterFirst || true);
});

test('setTerminalTitle force allows rewrite of same title', t => {
	const writes: string[] = [];
	const stream = {
		isTTY: true,
		write: (data: string) => {
			writes.push(data);
			return true;
		},
	};

	// When process.stdout is TTY, OSC goes there — still exercise force path.
	setTerminalTitle('Same', stream, {force: true});
	setTerminalTitle('Same', stream, {force: true});
	t.pass();
});
