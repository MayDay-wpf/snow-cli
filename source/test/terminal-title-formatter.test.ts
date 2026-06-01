import anyTest, {type TestFn} from 'ava';

import {formatTerminalTitle} from '../utils/ui/terminal-title-formatter.js';

const test = anyTest as unknown as TestFn;

test('formatTerminalTitle preserves Snow CLI header title prefix', t => {
	t.is(
		formatTerminalTitle({
			appTitle: 'Programming efficiency x10!',
			projectName: 'my-project',
		}),
		'Snow CLI - Programming efficiency x10! - my-project',
	);
});

test('formatTerminalTitle falls back for empty project names', t => {
	t.is(
		formatTerminalTitle({
			appTitle: 'Programming efficiency x10!',
			projectName: '',
		}),
		'Snow CLI - Programming efficiency x10! - Unknown Project',
	);
});

test('formatTerminalTitle removes control characters', t => {
	t.is(
		formatTerminalTitle({
			appTitle: 'Snow\u001B',
			projectName: 'my\u0007project',
		}),
		'Snow CLI - Snow - my project',
	);
});

test('formatTerminalTitle limits long project names', t => {
	const title = formatTerminalTitle({
		appTitle: 'Programming efficiency x10!',
		projectName: 'P'.repeat(100),
	});

	t.true(title.endsWith(`${'P'.repeat(21)}...`));
});

test('formatTerminalTitle prefers summary during activity state', t => {
	t.is(
		formatTerminalTitle({
			appTitle: 'Programming efficiency x10!',
			projectName: 'my-project',
			summary: '调整终端标题摘要',
			activity: true,
			animationFrame: 1,
		}),
		'Snow CLI - 调整终端标题摘要 - my-project',
	);
});

test('formatTerminalTitle shows blinking action-required state', t => {
	t.is(
		formatTerminalTitle({
			appTitle: 'Programming efficiency x10!',
			projectName: 'my-project',
			actionRequired: true,
			animationFrame: 0,
		}),
		'[ ! ] Action Required - Snow CLI - Programming efficiency x10! - my-project',
	);
	t.is(
		formatTerminalTitle({
			appTitle: 'Programming efficiency x10!',
			projectName: 'my-project',
			actionRequired: true,
			animationFrame: 1,
		}),
		'[ . ] Action Required - Snow CLI - Programming efficiency x10! - my-project',
	);
});
