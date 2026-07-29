import anyTest, {type TestFn} from 'ava';
import type {ChatMessage} from '../api/types.js';
import {
	compressSubAgentContext,
	hasUnresolvedToolCalls,
} from '../utils/core/subAgentContextCompressor.js';

/* eslint-disable @typescript-eslint/naming-convention -- OpenAI wire fields */

const test = anyTest as unknown as TestFn;

function toolCall(id: string) {
	return {
		id,
		type: 'function' as const,
		function: {name: 'test_tool', arguments: '{}'},
	};
}

test('detects a tool call whose result has not been recorded', t => {
	const messages: ChatMessage[] = [
		{role: 'user', content: 'run the tool'},
		{role: 'assistant', content: '', tool_calls: [toolCall('fc_pending')]},
	];

	t.true(hasUnresolvedToolCalls(messages));
});

test('requires every parallel tool call to have a result', t => {
	const messages: ChatMessage[] = [
		{
			role: 'assistant',
			content: '',
			tool_calls: [toolCall('fc_one'), toolCall('fc_two')],
		},
		{role: 'tool', tool_call_id: 'fc_one', content: 'done'},
	];

	t.true(hasUnresolvedToolCalls(messages));
	messages.push({role: 'tool', tool_call_id: 'fc_two', content: 'done'});
	t.false(hasUnresolvedToolCalls(messages));
});

test('compression refuses to split an active tool-call round', async t => {
	const messages: ChatMessage[] = [
		{role: 'user', content: 'run the tool'},
		{role: 'assistant', content: '', tool_calls: [toolCall('fc_active')]},
	];

	const result = await compressSubAgentContext(messages, 90, 100, {
		model: 'unused',
		requestMethod: 'responses',
	});

	t.false(result.compressed);
	t.is(result.messages, messages);
});

/* eslint-enable @typescript-eslint/naming-convention */
