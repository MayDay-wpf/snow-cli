import anyTest, {type TestFn} from 'ava';

import {
	buildTerminalNotificationSequences,
	buildToastScript,
	cleanNotificationText,
	escapeXml,
	formatAgentTurnCompletionNotification,
	formatTaskNotification,
	shouldNotifyAgentTurnCompletion,
	truncate,
} from './windows-notification.js';

const test = anyTest as unknown as TestFn;

test('cleanNotificationText strips terminal control characters', t => {
	t.is(
		cleanNotificationText('hello\u001B]9;bad\u0007 world'),
		'hello ]9;bad world',
	);
});

test('escapeXml escapes toast text characters', t => {
	t.is(escapeXml('&<>"\''), '&amp;&lt;&gt;&quot;&apos;');
});

test('truncate returns short text unchanged', t => {
	t.is(truncate('short', 10), 'short');
});

test('truncate keeps shortened text within the requested length', t => {
	t.is(truncate('abcdefghij', 7), 'abcd...');
	t.is(truncate('abcdefghij', 3), '...');
});

test('formatTaskNotification formats completed task payload', t => {
	t.deepEqual(
		formatTaskNotification({
			taskTitle: 'Build',
			status: 'completed',
		}),
		{
			title: 'Snow task completed',
			body: 'Build',
		},
	);
});

test('formatTaskNotification formats failed task payload', t => {
	t.deepEqual(
		formatTaskNotification({
			taskTitle: 'Build',
			status: 'failed',
			errorMessage: 'boom',
		}),
		{
			title: 'Snow task failed',
			body: 'Build: boom',
		},
	);
});

test('formatAgentTurnCompletionNotification formats waiting payload', t => {
	t.deepEqual(
		formatAgentTurnCompletionNotification({projectName: 'my-project'}),
		{
			title: 'Snow agent waiting for input',
			body: 'my-project',
		},
	);
});

test('shouldNotifyAgentTurnCompletion allows completed unfocused turns waiting for input', t => {
	t.true(
		shouldNotifyAgentTurnCompletion({
			terminalFocused: false,
			wasUserInterrupted: false,
			willAutoContinue: false,
			pendingMessageCount: 0,
		}),
	);
});

test('shouldNotifyAgentTurnCompletion defaults to focused when focus is unknown', t => {
	t.false(shouldNotifyAgentTurnCompletion({}));
});

test('shouldNotifyAgentTurnCompletion skips focused turns', t => {
	t.false(shouldNotifyAgentTurnCompletion({terminalFocused: true}));
});

test('shouldNotifyAgentTurnCompletion skips user-interrupted turns', t => {
	t.false(
		shouldNotifyAgentTurnCompletion({
			terminalFocused: false,
			wasUserInterrupted: true,
		}),
	);
});

test('shouldNotifyAgentTurnCompletion skips auto-continuing turns', t => {
	t.false(
		shouldNotifyAgentTurnCompletion({
			terminalFocused: false,
			willAutoContinue: true,
		}),
	);
});

test('shouldNotifyAgentTurnCompletion skips turns with queued messages', t => {
	t.false(
		shouldNotifyAgentTurnCompletion({
			terminalFocused: false,
			pendingMessageCount: 1,
		}),
	);
});

test('buildTerminalNotificationSequences emits OSC 9 and BEL fallback', t => {
	t.deepEqual(buildTerminalNotificationSequences('Done', 'Task'), [
		'\u001B]9;Done: Task\u0007',
		'\u0007',
	]);
});

test('buildTerminalNotificationSequences removes OSC injection characters', t => {
	t.deepEqual(buildTerminalNotificationSequences('A\u001B]0;bad', 'B\u0007C'), [
		'\u001B]9;A ]0;bad: B C\u0007',
		'\u0007',
	]);
});

test('buildToastScript embeds escaped title and body', t => {
	const script = buildToastScript('A&B', '<body>');

	t.true(script.includes('<text>A&amp;B</text>'));
	t.true(script.includes('<text>&lt;body&gt;</text>'));
	t.false(script.includes('<text><body></text>'));
});

test('buildToastScript keeps notification failures best-effort', t => {
	const script = buildToastScript('title', 'body');

	t.true(script.includes('catch'));
	t.true(script.includes('exit 0'));
});

test('buildToastScript uses hidden non-interactive powershell policy path', t => {
	const script = buildToastScript('title', 'body');

	t.true(script.includes('ToastNotificationManager'));
});
