import anyTest, {type TestFn} from 'ava';
import type {Message} from '../ui/components/chat/MessageList.js';
import {
	clearAllSubAgentLiveSlots,
	getSubAgentLiveSlot,
	_flushSubAgentLiveNotifyForTests,
} from '../hooks/conversation/core/subAgentLiveStore.js';
import {
	clearAllSubAgentStreamEntries,
	SubAgentUIHandler,
} from '../hooks/conversation/core/subAgentMessageHandler.js';

const test = anyTest as unknown as TestFn;

function makeHandler(streamingEnabled = true) {
	const saved: any[] = [];
	const encoder = {
		encode: (text: string) => Array.from({length: text.length}, () => 1),
	};
	const handler = new SubAgentUIHandler(
		encoder,
		async (msg: any) => {
			saved.push(msg);
		},
		undefined,
		streamingEnabled,
	);
	return {handler, saved};
}

function toolCall(
	id: string,
	name: string,
	args: Record<string, unknown> = {},
) {
	return {
		id,
		type: 'function',
		function: {
			name,
			arguments: JSON.stringify(args),
		},
	};
}

function asSubAgentMsg(partial: {
	agentId?: string;
	agentName?: string;
	message: any;
}): any {
	return {
		agentId: partial.agentId ?? 'inst-1',
		agentName: partial.agentName ?? 'General Purpose Agent',
		message: partial.message,
	};
}

test.beforeEach(() => {
	clearAllSubAgentLiveSlots();
	clearAllSubAgentStreamEntries();
	_flushSubAgentLiveNotifyForTests();
});

test.afterEach.always(() => {
	clearAllSubAgentLiveSlots();
	clearAllSubAgentStreamEntries();
	_flushSubAgentLiveNotifyForTests();
});

test('two-step tool_calls updates live slot without toolPending messages', t => {
	const {handler, saved} = makeHandler();
	let messages: Message[] = [];

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			message: {
				type: 'tool_calls',
				tool_calls: [
					toolCall('tc-1', 'filesystem-edit', {
						filePath: 'a.ts',
						searchContent: 'x',
						replaceContent: 'y',
					}),
				],
			},
		}),
	);

	const slot = getSubAgentLiveSlot('inst-1');
	t.truthy(slot);
	t.is(slot!.status, 'tool_focus');
	t.is(slot!.focus?.toolCallId, 'tc-1');
	t.is(slot!.otherPendingCount, 0);
	t.false(messages.some(m => m.toolPending === true));
	t.true(
		saved.some(m => m.role === 'assistant' && Array.isArray(m.tool_calls)),
	);
});

test('tool_result success does not append history row and clears live pending', t => {
	const {handler, saved} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-success-no-history';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [
					toolCall('tc-1', 'filesystem-edit', {
						filePath: 'a.ts',
						searchContent: 'x',
						replaceContent: 'y',
					}),
				],
			},
		}),
	);

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_result',
				tool_call_id: 'tc-1',
				tool_name: 'filesystem-edit',
				content: JSON.stringify({success: true}),
			},
		}),
	);

	const slot = getSubAgentLiveSlot(agentId);
	t.truthy(slot);
	t.is(slot!.otherPendingCount, 0);
	t.falsy(slot!.focus);
	t.false(messages.some(m => m.toolPending === true));
	const successRows = messages.filter(
		m => m.role === 'subagent' && m.messageStatus === 'success',
	);
	t.is(successRows.length, 0);
	t.false(messages.some(m => m.toolCallId === 'tc-1'));
	t.true(saved.some(m => m.role === 'tool' && m.tool_call_id === 'tc-1'));
});

test('tool_result error still appends history row', t => {
	const {handler, saved} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-error-history';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [
					toolCall('tc-err', 'filesystem-edit', {
						filePath: 'a.ts',
						searchContent: 'x',
						replaceContent: 'y',
					}),
				],
			},
		}),
	);

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_result',
				tool_call_id: 'tc-err',
				tool_name: 'filesystem-edit',
				content: 'Error: edit failed',
			},
		}),
	);

	const errorRows = messages.filter(
		m => m.role === 'subagent' && m.messageStatus === 'error',
	);
	t.is(errorRows.length, 1);
	t.is(errorRows[0]!.toolCallId, 'tc-err');
	t.true(saved.some(m => m.role === 'tool' && m.tool_call_id === 'tc-err'));
});

test('quick tools with live slots set focus without compact tree history', t => {
	const {handler, saved} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-quick-live';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-q1', 'ace-search', {action: 'text_search'})],
			},
		}),
	);

	const slot = getSubAgentLiveSlot(agentId);
	t.truthy(slot);
	t.is(slot!.status, 'tool_focus');
	t.is(slot!.focus?.toolCallId, 'tc-q1');
	t.false(messages.some(m => (m.content || '').includes('└─')));
	t.false(messages.some(m => m.pendingToolIds?.includes('tc-q1')));
	t.true(
		saved.some(m => m.role === 'assistant' && Array.isArray(m.tool_calls)),
	);
});

test('parallel two tools: otherPendingCount 1 while both pending', t => {
	const {handler} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-parallel-two';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [
					toolCall('tc-1', 'filesystem-edit', {
						filePath: 'a.ts',
						searchContent: 'x',
						replaceContent: 'y',
					}),
					toolCall('tc-2', 'terminal-execute', {command: 'echo hi'}),
				],
			},
		}),
	);

	const slot = getSubAgentLiveSlot(agentId);
	t.truthy(slot);
	t.is(slot!.status, 'multi_pending');
	t.is(slot!.otherPendingCount, 1);
	t.is(slot!.focus?.toolCallId, 'tc-2');
	t.false(messages.some(m => m.toolPending === true));
});

test('done marks live slot completed without completed history summary', t => {
	const {handler} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-done-summary';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-1', 'websearch-search', {query: 'x'})],
			},
		}),
	);
	t.truthy(getSubAgentLiveSlot(agentId));

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {type: 'done', final: true},
		}),
	);

	const slot = getSubAgentLiveSlot(agentId);
	t.truthy(slot);
	t.is(slot!.status, 'completed');
	// Live-slot agents rely on the main tool result row only.
	t.false(
		messages.some(
			m =>
				m.role === 'subagent' &&
				m.subAgent?.agentId === agentId &&
				(m.content || '').includes('completed'),
		),
	);
});

test('multiple final done messages stay idempotent without completed history', t => {
	const {handler} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-multi-done';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-1', 'websearch-search', {query: 'x'})],
			},
		}),
	);
	t.truthy(getSubAgentLiveSlot(agentId));

	// Duplicate final dones (e.g. historical abort+finally) stay idempotent.
	for (let i = 0; i < 3; i++) {
		messages = handler.handleMessage(
			messages,
			asSubAgentMsg({
				agentId,
				message: {type: 'done', final: true},
			}),
		);
	}

	const slot = getSubAgentLiveSlot(agentId);
	t.truthy(slot);
	t.is(slot!.status, 'completed');
	const doneRows = messages.filter(
		m =>
			m.role === 'subagent' &&
			m.subAgent?.agentId === agentId &&
			(m.content || '').includes('completed'),
	);
	t.is(doneRows.length, 0);
});

test('non-final done does not summarize and keeps live slot', t => {
	const {handler} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-nonfinal-done';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-1', 'websearch-search', {query: 'x'})],
			},
		}),
	);
	t.truthy(getSubAgentLiveSlot(agentId));

	// Stream API done is intermediate — agent is still running.
	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {type: 'done'},
		}),
	);

	t.truthy(getSubAgentLiveSlot(agentId));
	t.false(
		messages.some(
			m =>
				m.role === 'subagent' &&
				m.subAgent?.agentId === agentId &&
				m.subAgent?.isComplete === true &&
				(m.content || '').includes('completed'),
		),
	);

	// Later tools still work while slot remains live.
	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-2', 'ace-search', {action: 'text_search'})],
			},
		}),
	);
	t.truthy(getSubAgentLiveSlot(agentId));
	t.is(getSubAgentLiveSlot(agentId)!.focus?.toolCallId, 'tc-2');
});

test('multiple non-final dones then one final clears live without history summary', t => {
	const {handler} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-nonfinal-then-final';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-1', 'websearch-search', {query: 'x'})],
			},
		}),
	);

	for (let i = 0; i < 3; i++) {
		messages = handler.handleMessage(
			messages,
			asSubAgentMsg({
				agentId,
				message: {type: 'done'},
			}),
		);
	}
	t.truthy(getSubAgentLiveSlot(agentId));
	t.is(
		messages.filter(
			m =>
				m.role === 'subagent' &&
				m.subAgent?.agentId === agentId &&
				(m.content || '').includes('completed'),
		).length,
		0,
	);

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {type: 'done', final: true},
		}),
	);

	const doneRows = messages.filter(
		m =>
			m.role === 'subagent' &&
			m.subAgent?.agentId === agentId &&
			(m.content || '').includes('completed'),
	);
	t.is(doneRows.length, 0);
	const slot = getSubAgentLiveSlot(agentId);
	t.truthy(slot);
	t.is(slot!.status, 'completed');
});

test('tool_calls between two final dones stays without completed history', t => {
	const {handler} = makeHandler();
	let messages: Message[] = [];
	const agentId = 'inst-done-resume';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-1', 'websearch-search', {query: 'x'})],
			},
		}),
	);

	// First final done keeps residual completed card; no completed history row.
	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {type: 'done', final: true},
		}),
	);
	t.is(getSubAgentLiveSlot(agentId)?.status, 'completed');
	t.is(
		messages.filter(
			m =>
				m.role === 'subagent' &&
				m.subAgent?.agentId === agentId &&
				(m.content || '').includes('completed'),
		).length,
		0,
	);

	// Multi-turn activity after done reopens live slot without history spam.
	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-2', 'ace-search', {action: 'text_search'})],
			},
		}),
	);
	t.truthy(getSubAgentLiveSlot(agentId));

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId,
			message: {type: 'done', final: true},
		}),
	);

	const doneRows = messages.filter(
		m =>
			m.role === 'subagent' &&
			m.subAgent?.agentId === agentId &&
			(m.content || '').includes('completed'),
	);
	t.is(doneRows.length, 0);
	t.is(getSubAgentLiveSlot(agentId)?.status, 'completed');
});

test('instance-style agentIds clear live slots independently without history summary', t => {
	const {handler} = makeHandler();
	let messages: Message[] = [];
	const callA = 'call_abc123';
	const callB = 'call_def456';

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId: callA,
			agentName: 'General Purpose Agent',
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-a', 'websearch-search', {query: 'a'})],
			},
		}),
	);
	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId: callB,
			agentName: 'General Purpose Agent',
			message: {
				type: 'tool_calls',
				tool_calls: [toolCall('tc-b', 'websearch-search', {query: 'b'})],
			},
		}),
	);

	t.truthy(getSubAgentLiveSlot(callA));
	t.truthy(getSubAgentLiveSlot(callB));

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId: callA,
			agentName: 'General Purpose Agent',
			message: {type: 'done', final: true},
		}),
	);
	// A completed residual, B still live
	t.is(getSubAgentLiveSlot(callA)?.status, 'completed');
	t.truthy(getSubAgentLiveSlot(callB));
	t.not(getSubAgentLiveSlot(callB)!.status, 'completed');

	messages = handler.handleMessage(
		messages,
		asSubAgentMsg({
			agentId: callB,
			agentName: 'General Purpose Agent',
			message: {type: 'done', final: true},
		}),
	);

	const doneA = messages.filter(
		m =>
			m.role === 'subagent' &&
			m.subAgent?.agentId === callA &&
			(m.content || '').includes('completed'),
	);
	const doneB = messages.filter(
		m =>
			m.role === 'subagent' &&
			m.subAgent?.agentId === callB &&
			(m.content || '').includes('completed'),
	);
	t.is(doneA.length, 0);
	t.is(doneB.length, 0);
	t.is(getSubAgentLiveSlot(callA)?.status, 'completed');
	t.is(getSubAgentLiveSlot(callB)?.status, 'completed');
});

test('clearAllSubAgentStreamEntries also clears live slots', t => {
	const {handler} = makeHandler();
	handler.handleMessage(
		[],
		asSubAgentMsg({
			message: {
				type: 'tool_calls',
				tool_calls: [
					toolCall('tc-1', 'filesystem-create', {
						filePath: 'new.ts',
						content: 'hi',
						overwrite: false,
					}),
				],
			},
		}),
	);
	t.truthy(getSubAgentLiveSlot('inst-1'));
	clearAllSubAgentStreamEntries();
	t.is(getSubAgentLiveSlot('inst-1'), undefined);
});

test('teammate agent ids do not create live slots', t => {
	const {handler} = makeHandler();
	const messages = handler.handleMessage(
		[],
		asSubAgentMsg({
			agentId: 'teammate-alice',
			agentName: 'Alice',
			message: {
				type: 'tool_calls',
				tool_calls: [
					toolCall('tc-t1', 'filesystem-edit', {
						filePath: 'a.ts',
						searchContent: 'x',
						replaceContent: 'y',
					}),
				],
			},
		}),
	);

	t.is(getSubAgentLiveSlot('teammate-alice'), undefined);
	t.true(messages.some(m => m.toolPending === true));
});

test('reasoning_started creates thinking live status', t => {
	const {handler} = makeHandler();
	handler.handleMessage(
		[],
		asSubAgentMsg({
			message: {type: 'reasoning_started'},
		}),
	);
	const slot = getSubAgentLiveSlot('inst-1');
	t.truthy(slot);
	t.is(slot!.status, 'thinking');
	t.true(slot!.isReasoning);
});

test('content sets writing status with truncated single-line preview', t => {
	const {handler} = makeHandler();
	const longLine = 'x'.repeat(200);
	const content = ['first line', longLine].join('\n');
	const messages = handler.handleMessage(
		[],
		asSubAgentMsg({
			message: {
				type: 'content',
				content,
			},
		}),
	);

	const slot = getSubAgentLiveSlot('inst-1');
	t.truthy(slot);
	t.is(slot!.status, 'writing');
	t.false(slot!.isReasoning);
	t.truthy(slot!.preview);
	t.true((slot!.preview || '').length <= 120);
	t.true((slot!.preview || '').startsWith('…'));
	// Content must not be pushed into Static/history messages.
	t.false(
		messages.some(
			m => m.role === 'subagent' && m.content?.includes('first line'),
		),
	);
});

test('terminal-execute multiline command is single-line truncated in live title', t => {
	const {handler} = makeHandler();
	const agentId = 'inst-term-multiline-title';
	const multilineCommand = [
		'node -e "',
		"const fs = require('fs');",
		"const path = require('path');",
		"console.log(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));",
		"for (let i = 0; i < 20; i++) { console.log('line-' + i); }",
		'"',
	].join('\n');

	handler.handleMessage(
		[],
		asSubAgentMsg({
			agentId,
			message: {
				type: 'tool_calls',
				tool_calls: [
					toolCall('tc-term-ml', 'terminal-execute', {
						command: multilineCommand,
					}),
				],
			},
		}),
	);

	const slot = getSubAgentLiveSlot(agentId);
	t.truthy(slot);
	t.is(slot!.focus?.toolCallId, 'tc-term-ml');

	const title = slot!.focus?.title || '';
	const historyText = (slot!.historyLines || []).join('\n');
	const combined = `${title}\n${historyText}`;

	t.false(title.includes('\n'));
	t.false((slot!.focus?.paramsPreview || '').includes('\n'));
	t.true(title.length < multilineCommand.length);
	t.true(
		/terminal-execute|terminal/i.test(combined),
		'live title/history should still identify the tool',
	);
	// Full script body must not leak into live UI strings.
	t.false(combined.includes('for (let i = 0; i < 20; i++)'));
});

test('streamingEnabled=false still sets writing status without content preview', t => {
	const {handler} = makeHandler(false);
	handler.handleMessage(
		[],
		asSubAgentMsg({
			agentId: 'inst-stream-off',
			message: {type: 'content', content: 'hello world'},
		}),
	);

	const slot = getSubAgentLiveSlot('inst-stream-off');
	t.truthy(slot);
	t.is(slot!.status, 'writing');
	t.false(slot!.isReasoning);
	t.falsy(slot!.preview);
});

test('done after content marks live slot completed without completed history summary', t => {
	const {handler} = makeHandler();
	handler.handleMessage(
		[],
		asSubAgentMsg({
			agentId: 'inst-content-done',
			message: {type: 'content', content: 'draft'},
		}),
	);
	t.truthy(getSubAgentLiveSlot('inst-content-done'));

	const messages = handler.handleMessage(
		[],
		asSubAgentMsg({
			agentId: 'inst-content-done',
			message: {type: 'done', final: true},
		}),
	);
	// Assert only this agent: AVA may run other live-slot tests in parallel.
	t.is(getSubAgentLiveSlot('inst-content-done')?.status, 'completed');
	t.false(
		messages.some(
			m =>
				m.role === 'subagent' &&
				m.subAgent?.agentId === 'inst-content-done' &&
				(m.content || '').includes('completed'),
		),
	);
});

test('final done freezes cumulative provider usage on the live slot', t => {
	const {handler} = makeHandler();
	const agentId = 'inst-final-usage';
	handler.handleMessage(
		[],
		asSubAgentMsg({
			agentId,
			message: {type: 'content', content: 'final response'},
		}),
	);

	handler.handleMessage(
		[],
		asSubAgentMsg({
			agentId,
			message: {
				type: 'done',
				final: true,
				usage: {
					inputTokens: 1000,
					outputTokens: 200,
					cacheCreationInputTokens: 300,
					cacheReadInputTokens: 400,
				},
			},
		}),
	);

	const slot = getSubAgentLiveSlot(agentId);
	t.is(slot?.status, 'completed');
	t.deepEqual(slot?.finalUsage, {
		inputTokens: 1000,
		outputTokens: 200,
		cacheCreationInputTokens: 300,
		cacheReadInputTokens: 400,
	});
});
