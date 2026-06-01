import anyTest, {type TestFn} from 'ava';

import {formatTerminalTitle} from './terminal-title-formatter.js';

const test = anyTest as unknown as TestFn;

test('formatTerminalTitle defaults to project only', t => {
	t.is(formatTerminalTitle({projectName: 'my-project'}), 'my-project');
});

test('formatTerminalTitle falls back for empty project names', t => {
	t.is(formatTerminalTitle({projectName: ''}), 'Unknown Project');
});

test('formatTerminalTitle removes control characters', t => {
	t.is(
		formatTerminalTitle({projectName: 'my\u001B\u0007project'}),
		'my project',
	);
});

test('formatTerminalTitle limits long project names', t => {
	const title = formatTerminalTitle({projectName: 'P'.repeat(100)});

	t.true(title.length <= 24);
	t.true(title.endsWith('...'));
});

test('formatTerminalTitle shows activity spinner before project', t => {
	t.is(
		formatTerminalTitle({
			projectName: 'my-project',
			activity: true,
			animationFrame: 1,
		}),
		'⠙ my-project',
	);
});

test('formatTerminalTitle shows blinking action-required state', t => {
	t.is(
		formatTerminalTitle({
			projectName: 'my-project',
			actionRequired: true,
			animationFrame: 0,
		}),
		'[ ! ] Action Required - my-project',
	);
	t.is(
		formatTerminalTitle({
			projectName: 'my-project',
			actionRequired: true,
			animationFrame: 1,
		}),
		'[ . ] Action Required - my-project',
	);
});
