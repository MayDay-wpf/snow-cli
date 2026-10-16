import test from 'ava';
import {convertSessionMessagesToUI} from '../../../utils/session/sessionConverter.js';
import {sessionManager, type Session} from '../../../utils/session/sessionManager.js';
import type {ChatMessage} from '../../../api/chat.js';

test('sessionConverter does not generate duplicate pending messages for completed tools', t => {
	const sessionMessages: ChatMessage[] = [
		{
			role: 'user',
			content: 'edit file please',
		},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_123',
					type: 'function',
					function: {
						name: 'filesystem-edit',
						arguments: JSON.stringify({
							filePath: 'test.ts',
							oldContent: 'const a = 1;',
							newContent: 'const a = 2;',
						}),
					},
				},
			],
		},
		{
			role: 'tool',
			tool_call_id: 'call_123',
			content: JSON.stringify({
				success: true,
				filePath: 'test.ts',
				oldContent: 'const a = 1;',
				newContent: 'const a = 2;',
			}),
		},
	];

	const uiMessages = convertSessionMessagesToUI(sessionMessages);

	// The completed tool should only have 1 status='success' UI message, NOT a preceding pending diff message
	const pendingMessages = uiMessages.filter(
		m => m.messageStatus === 'pending' || m.toolPending,
	);
	t.is(pendingMessages.length, 0, 'Completed tools must not generate duplicate pending diff messages on resume');

	const successMessages = uiMessages.filter(
		m => m.messageStatus === 'success',
	);
	t.is(successMessages.length, 1, 'Completed tool should have a success status message');
});

test('sessionConverter retains pending message when a tool call genuinely has no result', t => {
	const sessionMessages: ChatMessage[] = [
		{
			role: 'user',
			content: 'edit file please',
		},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_unfinished',
					type: 'function',
					function: {
						name: 'filesystem-edit',
						arguments: JSON.stringify({
							filePath: 'test.ts',
							oldContent: 'const a = 1;',
							newContent: 'const a = 2;',
						}),
					},
				},
			],
		},
	];

	const uiMessages = convertSessionMessagesToUI(sessionMessages);
	const pendingMessages = uiMessages.filter(
		m => m.messageStatus === 'pending' || m.toolPending,
	);
	t.is(pendingMessages.length, 1, 'Unfinished tool call must be preserved as pending');
});

test('sessionManager.getInitialUserPrompt retrieves current session prompt, not ancient root prompt', async t => {
	// Create simulated historical session chain:
	// Root session asked: "can I see current skills?"
	// Current session asked: "fix the memory bug in ace search"
	const rootSession: Session = {
		id: 'session-root-111',
		title: 'Root Session',
		summary: 'ancient root',
		createdAt: 1000,
		updatedAt: 1000,
		initialUserPrompt: '能看到当前有哪些skills嘛？',
		messages: [
			{
				role: 'user',
				content: '能看到当前有哪些skills嘛？',
				timestamp: 1000,
			},
		],
		messageCount: 1,
	};

	const currentSession: Session = {
		id: 'session-current-222',
		title: 'Current Session',
		summary: 'current task',
		createdAt: 2000,
		updatedAt: 2000,
		compressedFrom: 'session-root-111',
		initialUserPrompt: 'fix the memory bug in ace search',
		messages: [
			{
				role: 'user',
				content: '[Context Summary from Previous Conversation]\n\nsummary here...',
				timestamp: 2000,
			},
			{
				role: 'user',
				content: 'fix the memory bug in ace search',
				timestamp: 2001,
			},
		],
		messageCount: 2,
	};

	// Save or stub loadSessionFromDisk
	const originalLoad = (sessionManager as any).loadSessionFromDisk.bind(sessionManager);
	(sessionManager as any).loadSessionFromDisk = async (id: string) => {
		if (id === 'session-root-111') return rootSession;
		return originalLoad(id);
	};

	try {
		const prompt = await sessionManager.getInitialUserPrompt(currentSession);
		t.is(prompt, 'fix the memory bug in ace search', 'Must pick current session prompt instead of ancient root prompt');
	} finally {
		(sessionManager as any).loadSessionFromDisk = originalLoad;
	}
});
