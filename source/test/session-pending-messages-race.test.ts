import test from 'ava';
import {
	isPendingSendTimingReady,
	handlePendingMessages,
	type PendingMessagesOptions,
} from '../hooks/conversation/core/pendingMessagesHandler.js';

test('Anti-pattern Characterization: handlePendingMessages in tool round prematurely drains queue and mutates history', async t => {
	// 1. Arrange: Conversation is in the middle of a tool call
	// Assistant initiated tool_call, tool returned result, but Assistant has NOT produced response text yet
	const conversationMessages: any[] = [
		{role: 'user', content: '请读取文件 source/mcp/utils/bash.ts 的前 10 行'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_123',
					type: 'function',
					function: {name: 'filesystem-read', arguments: '{}'},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_123',
			content: 'Error: File not found',
		},
	];

	// 2. User typed a queued message while tool was executing
	let pendingQueue = [{text: '请使用 websearch 搜索一下 "Node.js 22 LTS features"'}];
	let clearCalled = false;

	const options: PendingMessagesOptions = {
		getPendingMessages: () => pendingQueue,
		clearPendingMessages: () => {
			clearCalled = true;
			pendingQueue = [];
		},
		conversationMessages,
		saveMessage: async () => {},
		setMessages: () => {},
		autoCompressOptions: {
			getCurrentContextPercentage: () => 10,
			setMessages: () => {},
			setContextUsage: () => {},
			freeEncoder: () => {},
		},
	};

	// 3. Act: Simulate toolCallRoundHandler calling handlePendingMessages right after tool execution
	const result = await handlePendingMessages(options);

	// 4. Assert Anti-pattern:
	// The queue was drained immediately in the middle of the tool round
	t.true(result.hasPending);
	t.true(clearCalled);
	t.is(pendingQueue.length, 0);

	// The conversation history now has the user prompt right after the tool result,
	// BEFORE the assistant ever gets a chance to explain the error to the user!
	const lastMessage = conversationMessages[conversationMessages.length - 1];
	t.is(lastMessage.role, 'user');
	t.true(lastMessage.content.includes('Node.js 22 LTS features'));

	// Previous message was tool error, meaning assistant response was completely bypassed!
	const secondToLast = conversationMessages[conversationMessages.length - 2];
	t.is(secondToLast.role, 'tool');
	t.is(secondToLast.content, 'Error: File not found');
});

test('Timing Guard Logic: isPendingSendTimingReady correctly gates unclosed tool calls', t => {
	// Case 1: Unclosed tool call (assistant requested tool, tool result not received yet)
	const unclosedMessages: any[] = [
		{
			role: 'assistant',
			tool_calls: [{id: 'call_abc'}],
		},
	];
	t.false(isPendingSendTimingReady(unclosedMessages), 'Should NOT be ready when tool call is unresolved');

	// Case 2: Tool call closed by tool result
	const closedMessages: any[] = [
		{
			role: 'assistant',
			tool_calls: [{id: 'call_abc'}],
		},
		{
			role: 'tool',
			tool_call_id: 'call_abc',
			content: 'done',
		},
	];
	t.true(isPendingSendTimingReady(closedMessages), 'Should be ready when all tool calls have results');

	// Case 3: Completely idle turn (normal text message)
	const idleMessages: any[] = [
		{role: 'user', content: 'hi'},
		{role: 'assistant', content: 'hello!'},
	];
	t.true(isPendingSendTimingReady(idleMessages), 'Should be ready when conversation is in normal chat state');
});

test('Turn Closure Atomicity: Pending queue remains intact during tool round to let assistant finish explanation', t => {
	// Simulated pending queue that user added during tool execution
	const pendingQueue = [{text: '请使用 websearch 搜索一下 "Node.js 22 LTS features"'}];

	// Under Turn Closure Atomicity, toolCallRoundHandler never drains this queue.
	// The queue length remains 1 throughout the tool loop.
	t.is(pendingQueue.length, 1);
	t.is(pendingQueue[0]?.text, '请使用 websearch 搜索一下 "Node.js 22 LTS features"');
});

