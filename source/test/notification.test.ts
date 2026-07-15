import anyTest, {type TestFn} from 'ava';

import {
	buildToastScript,
	escapeXml,
	formatAgentTurnCompletionNotification,
} from '../utils/platform/notification.js';

const test = anyTest as unknown as TestFn;

test('buildToastScript registers Snow CLI AppUserModelID for WinRT toast', t => {
	const script = buildToastScript('Snow agent waiting for input', 'snow-cli');

	t.true(script.includes("$appUserModelId = 'Snow.CLI'"));
	t.true(script.includes("$displayName = 'Snow CLI'"));
	t.true(script.includes('AppUserModelId\\$appUserModelId'));
	t.true(script.includes("DisplayName' -Value $displayName"));
	t.true(script.includes('CreateToastNotifier($appUserModelId)'));
	t.true(script.includes('<text>Snow agent waiting for input</text>'));
	t.true(script.includes('<text>snow-cli</text>'));
	t.true(script.includes('Show-SnowCliBalloonFallback'));
});

test('buildToastScript escapes XML special characters in toast content', t => {
	const script = buildToastScript('A & B <C>', 'path "quoted"');

	t.true(script.includes(escapeXml('A & B <C>')));
	t.true(script.includes(escapeXml('path "quoted"')));
	t.false(script.includes('<text>A & B <C></text>'));
});

test('formatAgentTurnCompletionNotification uses project name as body', t => {
	const payload = formatAgentTurnCompletionNotification({
		projectName: 'snow-cli',
	});

	t.is(payload.body, 'snow-cli');
	t.true(payload.title.length > 0);
});
