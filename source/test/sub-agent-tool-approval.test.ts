import anyTest, {type TestFn} from 'ava';

import {checkAndApproveTools} from '../utils/execution/subAgentToolApproval.js';
import type {SubAgentExecutionContext} from '../utils/execution/subAgentTypes.js';

const test = anyTest as unknown as TestFn;

function createContext(
	overrides: Partial<SubAgentExecutionContext> = {},
): SubAgentExecutionContext {
	return {
		agent: {id: 'agent_general', name: 'General Purpose Agent'},
		messages: [],
		yoloMode: false,
		spawnDepth: 0,
		sessionApprovedTools: new Set<string>(),
		spawnedChildInstanceIds: new Set<string>(),
		collectedInjectedMessages: [],
		collectedTerminationInstructions: [],
		latestTotalTokens: 0,
		finalResponse: '',
		...overrides,
	};
}

const terminalToolCall = {
	id: 'call-terminal-1',
	type: 'function' as const,
	function: {
		name: 'terminal-execute',
		arguments: JSON.stringify({
			command: 'touch /tmp/snow_acp_marker',
			explanation: 'proof',
			workingDirectory: '/tmp',
		}),
	},
};

test('sub-agent terminal-execute requests permission through the confirmation callback', async t => {
	let receivedToolName: string | undefined;
	let receivedArgs: any;
	const ctx = createContext({
		requestToolConfirmation: async (toolName, toolArgs) => {
			receivedToolName = toolName;
			receivedArgs = toolArgs;
			return 'approve';
		},
	});

	const result = await checkAndApproveTools(ctx, [terminalToolCall]);

	t.is(receivedToolName, 'terminal-execute');
	t.is(receivedArgs.command, 'touch /tmp/snow_acp_marker');
	t.deepEqual(result.approvedToolCalls, [terminalToolCall]);
	t.false(result.shouldContinue);
});

test('sub-agent fails closed when confirmation is required but no callback exists', async t => {
	const ctx = createContext();

	const result = await checkAndApproveTools(ctx, [terminalToolCall]);

	t.deepEqual(result.approvedToolCalls, []);
	t.true(result.shouldContinue);
	t.true(
		ctx.messages.some(
			message =>
				message.role === 'tool' &&
				String(message.content).includes(
					'no confirmation channel is available',
				),
		),
	);
});

test('auto-approved sub-agent tools skip the confirmation callback', async t => {
	let callbackCalled = false;
	const ctx = createContext({
		isToolAutoApproved: () => true,
		requestToolConfirmation: async () => {
			callbackCalled = true;
			return 'approve';
		},
	});

	const result = await checkAndApproveTools(ctx, [terminalToolCall]);

	t.false(callbackCalled);
	t.deepEqual(result.approvedToolCalls, [terminalToolCall]);
	t.false(result.shouldContinue);
});
