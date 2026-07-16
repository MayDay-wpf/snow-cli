import anyTest, {type TestFn} from 'ava';

import {
	buildWindowsNotificationArguments,
	buildToastScript,
	escapeXml,
	formatAgentTurnCompletionNotification,
	shouldNotifyAgentTurnCompletion,
} from '../utils/platform/notification.js';

const test = anyTest as unknown as TestFn;

test('buildToastScript registers Snow CLI AppUserModelID for WinRT toast', t => {
	const script = buildToastScript('Snow agent waiting for input', 'snow-cli');

	t.true(script.includes("$appUserModelId = 'Snow.CLI'"));
	t.true(script.includes("$displayName = 'Snow CLI'"));
	t.true(script.includes('AppUserModelId\\$appUserModelId'));
	t.true(script.includes("DisplayName' -Value $displayName"));
	t.false(script.includes("Name 'Enabled'"));
	t.false(script.includes("Name 'ShowInActionCenter'"));
	t.true(script.includes('CreateToastNotifier($appUserModelId)'));
	t.true(script.includes('<text>Snow agent waiting for input</text>'));
	t.true(script.includes('<text>snow-cli</text>'));
	t.true(script.includes('Show-SnowCliBalloonFallback'));
	// Prefer a plain string XML payload so PowerShell here-string column rules cannot break parsing.
	t.false(script.includes("@'"));
	t.false(script.includes("'@"));
	t.true(script.includes("$xml = '<toast>"));
});

test('buildToastScript escapes XML special characters in toast content', t => {
	const script = buildToastScript('A & B <C>', 'path "quoted"');

	t.true(script.includes(escapeXml('A & B <C>')));
	t.true(script.includes(escapeXml('path "quoted"')));
	t.false(script.includes('<text>A & B <C></text>'));
});

test('Windows toast launcher relies on windowsHide instead of PowerShell hidden mode', t => {
	const args = buildWindowsNotificationArguments('Snow test', 'Notification');
	const encodedIndex = args.indexOf('-EncodedCommand');

	t.deepEqual(args.slice(0, encodedIndex), [
		'-NoProfile',
		'-ExecutionPolicy',
		'Bypass',
	]);
	t.false(args.includes('-WindowStyle'));
	t.true(encodedIndex >= 0);
	const decoded = Buffer.from(args[encodedIndex + 1]!, 'base64').toString(
		'utf16le',
	);
	t.true(decoded.includes("$appUserModelId = 'Snow.CLI'"));
	t.true(decoded.includes('<text>Snow test</text>'));
});

test('formatAgentTurnCompletionNotification uses project name as body', t => {
	const payload = formatAgentTurnCompletionNotification({
		projectName: 'snow-cli',
	});

	t.is(payload.body, 'snow-cli');
	t.true(payload.title.length > 0);
});

test('completed turns notify when unfocused and no continuation is pending', t => {
	t.true(
		shouldNotifyAgentTurnCompletion({
			terminalFocused: false,
			wasUserInterrupted: false,
			willAutoContinue: false,
			pendingMessageCount: 0,
		}),
	);
	t.false(
		shouldNotifyAgentTurnCompletion({
			terminalFocused: false,
			willAutoContinue: true,
		}),
	);
});
