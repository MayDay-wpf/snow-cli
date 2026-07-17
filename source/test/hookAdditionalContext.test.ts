import anyTest, {type TestFn} from 'ava';

import type {UnifiedHookExecutionResult} from '../utils/execution/unifiedHooksExecutor.js';
import {
	DEFAULT_ADDITIONAL_CONTEXT_MAX_BYTES,
	extractAdditionalContext,
	extractPromptOverride,
	parseAdditionalContextOutput,
	truncateAdditionalContext,
} from '../utils/execution/hookResultInterpreter.js';
import {hookStrategies} from '../utils/execution/hookStrategies.js';
import {
	applyOnUserMessageHookResult,
	mergeInjectedContexts,
	prependAdditionalContext,
} from '../utils/execution/hookContextInject.js';
import {sessionManager} from '../utils/session/sessionManager.js';

const test = anyTest as unknown as TestFn;

function successCommand(output: string): UnifiedHookExecutionResult {
	return {
		success: true,
		results: [
			{
				type: 'command',
				success: true,
				command: 'echo',
				exitCode: 0,
				output,
			},
		],
		executedActions: 1,
		skippedActions: 0,
	};
}

test('parseAdditionalContextOutput reads additionalContext', t => {
	const parsed = parseAdditionalContextOutput(
		JSON.stringify({additionalContext: 'HELLO', display: 'ui-only'}),
	);
	t.is(parsed?.context, 'HELLO');
	t.is(parsed?.display, 'ui-only');
});

test('parseAdditionalContextOutput supports hookSpecificOutput', t => {
	const parsed = parseAdditionalContextOutput(
		JSON.stringify({
			hookSpecificOutput: {additionalContext: 'NESTED'},
		}),
	);
	t.is(parsed?.context, 'NESTED');
});

test('parseAdditionalContextOutput ignores non-JSON', t => {
	t.is(parseAdditionalContextOutput('hello world'), null);
	t.is(parseAdditionalContextOutput('{not json'), null);
});

test('extractAdditionalContext joins multiple success commands', t => {
	const result: UnifiedHookExecutionResult = {
		success: true,
		results: [
			{
				type: 'command',
				success: true,
				command: 'a',
				exitCode: 0,
				output: JSON.stringify({additionalContext: 'A'}),
			},
			{
				type: 'command',
				success: true,
				command: 'b',
				exitCode: 0,
				output: JSON.stringify({additionalContext: 'B'}),
			},
		],
		executedActions: 2,
		skippedActions: 0,
	};
	const extracted = extractAdditionalContext(result);
	t.is(extracted.context, 'A\n\nB');
	t.false(extracted.truncated);
});

test('truncateAdditionalContext truncates over max', t => {
	const long = 'x'.repeat(DEFAULT_ADDITIONAL_CONTEXT_MAX_BYTES + 50);
	const trunc = truncateAdditionalContext(long);
	t.true(trunc.truncated);
	t.is(trunc.text.length, DEFAULT_ADDITIONAL_CONTEXT_MAX_BYTES);
});

test('extractAdditionalContext truncates joined context', t => {
	const long = 'y'.repeat(100);
	const result = successCommand(JSON.stringify({additionalContext: long}));
	const extracted = extractAdditionalContext(result, 20);
	t.is(extracted.context?.length, 20);
	t.true(extracted.truncated);
});

test('onUserMessage strategy attaches context on success', t => {
	const interpreted = hookStrategies.onUserMessage.interpret(
		successCommand(JSON.stringify({additionalContext: 'CTX'})),
	);
	t.is(interpreted.action, 'continue');
	t.is(interpreted.additionalContext, 'CTX');
});

test('onUserMessage strategy exit1 remains replace without context', t => {
	const interpreted = hookStrategies.onUserMessage.interpret({
		success: true,
		results: [
			{
				type: 'command',
				success: false,
				command: 'x',
				exitCode: 1,
				error: 'rewritten',
			},
		],
		executedActions: 1,
		skippedActions: 0,
	});
	t.is(interpreted.action, 'replace');
	t.is(interpreted.replacedContent, 'rewritten');
	t.is(interpreted.additionalContext, undefined);
});

test('onSessionStart strategy attaches context on success', t => {
	const interpreted = hookStrategies.onSessionStart.interpret(
		successCommand(JSON.stringify({additionalContext: 'SESSION'})),
	);
	t.is(interpreted.action, 'continue');
	t.is(interpreted.additionalContext, 'SESSION');
});

test('beforeSubAgentStart prefers prompt override', t => {
	const interpreted = hookStrategies.beforeSubAgentStart.interpret(
		successCommand(
			JSON.stringify({
				prompt: 'FULL',
				additionalContext: 'PRE',
			}),
		),
	);
	t.is(interpreted.promptOverride, 'FULL');
	t.is(interpreted.additionalContext, 'PRE');
});

test('extractPromptOverride returns override and context', t => {
	const extracted = extractPromptOverride(
		successCommand(JSON.stringify({prompt: 'P', additionalContext: 'C'})),
	);
	t.is(extracted.promptOverride, 'P');
	t.is(extracted.additionalContext, 'C');
});

test('prepend/merge helpers', t => {
	t.is(prependAdditionalContext('hi', 'CTX'), 'CTX\n\nhi');
	t.is(prependAdditionalContext('hi', '  '), 'hi');
	t.is(mergeInjectedContexts('hi', ['A', undefined, 'B']), 'A\n\nB\n\nhi');
});

test.serial(
	'exit1 replacement consumes and discards pending session context',
	t => {
		sessionManager.clearCurrentSession();
		sessionManager.setPendingAdditionalContext('SESSION_CONTEXT');

		const pending = sessionManager.consumePendingAdditionalContext();
		const output = applyOnUserMessageHookResult(
			'original',
			{action: 'replace', replacedContent: 'rewritten'},
			pending.context,
		);

		t.is(output, 'rewritten');
		t.is(sessionManager.peekPendingAdditionalContext(), undefined);
	},
);

test('continue result merges pending and message hook contexts', t => {
	const output = applyOnUserMessageHookResult(
		'original',
		{action: 'continue', additionalContext: 'MESSAGE_CONTEXT'},
		'SESSION_CONTEXT',
	);

	t.is(output, 'SESSION_CONTEXT\n\nMESSAGE_CONTEXT\n\noriginal');
});
