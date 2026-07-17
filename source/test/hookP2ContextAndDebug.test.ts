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

test('recordHookInjectDebug includes session identity debug fields', t => {
	const prevDebug = process.env['SNOW_DEBUG_HOOKS'];
	const prevSession = process.env['SNOW_SESSION_ID'];
	const prevTrellis = process.env['TRELLIS_CONTEXT_ID'];
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snow-hooks-sid-'));

	try {
		process.env['SNOW_DEBUG_HOOKS'] = '1';
		process.env['SNOW_SESSION_ID'] = 'env-session-id';
		process.env['TRELLIS_CONTEXT_ID'] = 'snow-env-session-id';
		clearLastHookInjectSummary();

		recordHookInjectDebug({
			hookType: 'onSessionStart',
			additionalContext: 'SID_DEBUG',
			sessionId: 'explicit-session-id',
			projectRoot: dir,
			source: 'session-identity-test',
		});

		const summary = getLastHookInjectSummary();
		t.truthy(summary);
		t.is(summary!.sessionId, 'explicit-session-id');
		t.true(summary!.envHasSnowSessionId);
		t.true(summary!.envHasTrellisContextId);
		t.is(summary!.source, 'session-identity-test');

		const logPath = path.join(dir, '.snow', 'log', 'hooks-inject.txt');
		const body = fs.readFileSync(logPath, 'utf8');
		t.true(body.includes('explicit-session-id'));
		t.true(body.includes('"envHasSnowSessionId":true'));
		t.true(body.includes('"envHasTrellisContextId":true'));
	} finally {
		if (prevDebug === undefined) {
			delete process.env['SNOW_DEBUG_HOOKS'];
		} else {
			process.env['SNOW_DEBUG_HOOKS'] = prevDebug;
		}
		if (prevSession === undefined) {
			delete process.env['SNOW_SESSION_ID'];
		} else {
			process.env['SNOW_SESSION_ID'] = prevSession;
		}
		if (prevTrellis === undefined) {
			delete process.env['TRELLIS_CONTEXT_ID'];
		} else {
			process.env['TRELLIS_CONTEXT_ID'] = prevTrellis;
		}
		fs.rmSync(dir, {recursive: true, force: true});
		clearLastHookInjectSummary();
	}
});

test('recordHookInjectDebug falls back to SNOW_SESSION_ID env when entry omits sessionId', t => {
	const prevSession = process.env['SNOW_SESSION_ID'];
	const prevTrellis = process.env['TRELLIS_CONTEXT_ID'];

	try {
		process.env['SNOW_SESSION_ID'] = 'fallback-from-env';
		delete process.env['TRELLIS_CONTEXT_ID'];
		clearLastHookInjectSummary();

		// Debug file write is optional; in-memory summary is always recorded.
		recordHookInjectDebug({
			hookType: 'onUserMessage',
			additionalContext: 'FALLBACK',
		});

		const summary = getLastHookInjectSummary();
		t.truthy(summary);
		t.is(summary!.sessionId, 'fallback-from-env');
		t.true(summary!.envHasSnowSessionId);
		t.false(summary!.envHasTrellisContextId);
	} finally {
		if (prevSession === undefined) {
			delete process.env['SNOW_SESSION_ID'];
		} else {
			process.env['SNOW_SESSION_ID'] = prevSession;
		}
		if (prevTrellis === undefined) {
			delete process.env['TRELLIS_CONTEXT_ID'];
		} else {
			process.env['TRELLIS_CONTEXT_ID'] = prevTrellis;
		}
		clearLastHookInjectSummary();
	}
});
