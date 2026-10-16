import test from 'ava';
import {
	isPendingSendTimingReady,
	handlePendingMessages,
	type PendingMessagesOptions,
} from '../../../hooks/conversation/core/pendingMessagesHandler.js';

test('In-Flight Steering: handlePendingMessages in tool round successfully injects user correction into context', async t => {
	// 1. Arrange: Conversation is in the middle of a multi-step tool call round
	// Assistant invoked tool, tool returned result
	const conversationMessages: any[] = [
		{role: 'user', content: '请读取并分析全部代码'},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_123',
					type: 'function',
					function: {name: 'filesystem-read', arguments: '{"path":"dist/app.js"}'},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_123',
			content: 'console.log("compiled output");',
		},
	];

	// 2. User typed a mid-flight steering message while tool was executing
	let pendingQueue = [{text: '不要看 dist，请改读 source/ 目录下的源码！'}];
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

	// 3. Act: Tool round completes safe boundary, invokes handlePendingMessages for in-flight steering
	const result = await handlePendingMessages(options);

	// 4. Assert: In-flight steering absorbed successfully
	t.true(result.hasPending);
	t.true(clearCalled);
	t.is(pendingQueue.length, 0);

	// The conversation history now has the steering user prompt appended right after tool result
	// so the model immediately pivots its next tool call to source/
	const lastMessage = conversationMessages[conversationMessages.length - 1];
	t.is(lastMessage.role, 'user');
	t.true(lastMessage.content.includes('不要看 dist，请改读 source/ 目录下的源码！'));
});

test('Timing Guard Logic: isPendingSendTimingReady gates unclosed tool calls', t => {
	// Case 1: Unclosed tool call (assistant requested tool, tool result not received yet)
	const unclosedMessages: any[] = [
		{
			role: 'assistant',
			tool_calls: [{id: 'call_abc'}],
		},
	];
	t.false(
		isPendingSendTimingReady(unclosedMessages),
		'Should NOT be ready when tool call is unresolved',
	);

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
	t.true(
		isPendingSendTimingReady(closedMessages),
		'Should be ready when all tool calls have results',
	);

	// Case 3: Completely idle turn (normal text message)
	const idleMessages: any[] = [
		{role: 'user', content: 'hi'},
		{role: 'assistant', content: 'hello!'},
	];
	t.true(
		isPendingSendTimingReady(idleMessages),
		'Should be ready when conversation is in normal chat state',
	);
});
