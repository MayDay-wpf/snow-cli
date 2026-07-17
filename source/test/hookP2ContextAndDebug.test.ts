import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {UnifiedHookExecutionResult} from '../utils/execution/unifiedHooksExecutor.js';
import {
	extractAdditionalContext,
	extractPromptOverride,
} from '../utils/execution/hookResultInterpreter.js';
import {
	clearLastHookInjectSummary,
	getLastHookInjectSummary,
	isHookInjectDebugEnabled,
	recordHookInjectDebug,
} from '../utils/execution/hookInjectDebug.js';
import {isActionTypeAllowed} from '../utils/config/hooksConfig.js';

const test = anyTest as unknown as TestFn;

function successContext(output: string): UnifiedHookExecutionResult {
	return {
		success: true,
		results: [
			{
				type: 'context',
				success: true,
				output,
			},
		],
		executedActions: 1,
		skippedActions: 0,
	};
}

test('extractAdditionalContext accepts context action results', t => {
	const extracted = extractAdditionalContext(
		successContext(JSON.stringify({additionalContext: 'FROM_CONTEXT'})),
	);
	t.is(extracted.context, 'FROM_CONTEXT');
});

test('extractPromptOverride accepts context action results', t => {
	const extracted = extractPromptOverride(
		successContext(JSON.stringify({prompt: 'FULL', additionalContext: 'PRE'})),
	);
	t.is(extracted.promptOverride, 'FULL');
	t.is(extracted.additionalContext, 'PRE');
});

test('isActionTypeAllowed restricts context to inject hooks', t => {
	t.true(isActionTypeAllowed('onSessionStart', 'context'));
	t.true(isActionTypeAllowed('onUserMessage', 'context'));
	t.true(isActionTypeAllowed('beforeSubAgentStart', 'context'));
	t.false(isActionTypeAllowed('beforeToolCall', 'context'));
	t.false(isActionTypeAllowed('onStop', 'context'));
});

test('recordHookInjectDebug writes summary when SNOW_DEBUG_HOOKS=1', t => {
	const prev = process.env['SNOW_DEBUG_HOOKS'];
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-hooks-debug-'));

	try {
		process.env['SNOW_DEBUG_HOOKS'] = '1';
		clearLastHookInjectSummary();

		t.true(isHookInjectDebugEnabled());
		recordHookInjectDebug({
			hookType: 'onUserMessage',
			additionalContext: 'HELLO_DEBUG',
			source: 'test',
			projectRoot: dir,
		});

		const summary = getLastHookInjectSummary();
		t.truthy(summary);
		t.is(summary!.hookType, 'onUserMessage');
		t.is(summary!.length, 'HELLO_DEBUG'.length);
		t.true(summary!.hash.length >= 8);

		const logPath = path.join(dir, '.snow', 'log', 'hooks-inject.txt');
		t.true(fs.existsSync(logPath));
		const body = fs.readFileSync(logPath, 'utf8');
		t.true(body.includes('HELLO_DEBUG'.length.toString()));
		t.true(body.includes('onUserMessage'));
	} finally {
		if (prev === undefined) {
			delete process.env['SNOW_DEBUG_HOOKS'];
		} else {
			process.env['SNOW_DEBUG_HOOKS'] = prev;
		}
		fs.rmSync(dir, {recursive: true, force: true});
		clearLastHookInjectSummary();
	}
});
