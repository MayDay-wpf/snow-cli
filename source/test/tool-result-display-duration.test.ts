import anyTest, {type TestFn} from 'ava';

import {buildToolResultMessages} from '../hooks/conversation/core/toolResultDisplay.js';
import type {ToolCall, ToolResult} from '../utils/execution/toolExecutor.js';

const test = anyTest as unknown as TestFn;

function makeToolCall(id: string, name = 'terminal-execute'): ToolCall {
	return {
		id,
		type: 'function',
		function: {
			name,
			arguments: JSON.stringify({command: `echo ${id}`}),
		},
	};
}

function makeResult(
	id: string,
	overrides: Partial<ToolResult> = {},
): ToolResult {
	return {
		tool_call_id: id,
		role: 'tool',
		content: 'ok',
		...overrides,
	};
}

test('buildToolResultMessages uses per-tool startedAt/completedAt for parallel terminal tools', t => {
	const batchStart = 1_000_000;
	const toolCalls = [
		makeToolCall('t1'),
		makeToolCall('t2'),
		makeToolCall('t3'),
	];
	const results = [
		makeResult('t1', {
			startedAt: batchStart,
			completedAt: batchStart + 3_000,
		}),
		makeResult('t2', {
			startedAt: batchStart,
			completedAt: batchStart + 8_000,
		}),
		makeResult('t3', {
			startedAt: batchStart,
			completedAt: batchStart + 1_000,
		}),
	];

	// Even if pending UI stamps a shared batch start for all tools, result.startedAt wins.
	const pendingStartTimes = new Map<
		string,
		number
	>([
		['t1', batchStart],
		['t2', batchStart],
		['t3', batchStart],
	]);

	const messages = buildToolResultMessages(
		results,
		toolCalls,
		'parallel-group-1',
		pendingStartTimes,
	);

	t.is(messages.length, 3);
	t.deepEqual(
		messages.map(m => m.toolDurationMs),
		[3_000, 8_000, 1_000],
	);
	// Group wall-clock = last end - earliest start = 8s, not serial sum 12s.
	for (const message of messages) {
		t.is(message.parallelGroupElapsedMs, 8_000);
		t.true(message.content.includes('(3s)') || message.content.includes('(8s)') || message.content.includes('(1s)'));
	}
	t.true(messages[0]!.content.includes('(3s)'));
	t.true(messages[1]!.content.includes('(8s)'));
	t.true(messages[2]!.content.includes('(1s)'));
});

test('buildToolResultMessages prefers result.startedAt over shared pending batch start for sequential tools', t => {
	const batchStart = 2_000_000;
	const toolCalls = [
		makeToolCall('a', 'todo-manage'),
		makeToolCall('b', 'todo-manage'),
	];
	// Sequential siblings: second tool starts after first ends.
	const results = [
		makeResult('a', {
			startedAt: batchStart,
			completedAt: batchStart + 2_000,
		}),
		makeResult('b', {
			startedAt: batchStart + 2_000,
			completedAt: batchStart + 5_000,
		}),
	];
	// Pending UI still has a shared batch start for both.
	const pendingStartTimes = new Map<
		string,
		number
	>([
		['a', batchStart],
		['b', batchStart],
	]);

	const messages = buildToolResultMessages(
		results,
		toolCalls,
		'parallel-group-seq',
		pendingStartTimes,
	);

	t.is(messages.length, 2);
	// Self durations: 2s and 3s (not 2s and 5s from batch start).
	t.deepEqual(
		messages.map(m => m.toolDurationMs),
		[2_000, 3_000],
	);
	// Group wall-clock still covers the whole sequential window.
	t.is(messages[0]!.parallelGroupElapsedMs, 5_000);
	t.is(messages[1]!.parallelGroupElapsedMs, 5_000);
});
