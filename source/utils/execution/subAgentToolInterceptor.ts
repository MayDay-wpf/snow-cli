import {getSubAgent} from '../config/subAgentConfig.js';
import {runningSubAgentTracker} from './runningSubAgentTracker.js';
import {unifiedHooksExecutor} from './unifiedHooksExecutor.js';
import {interpretHookResult} from './hookResultInterpreter.js';
import {connectionManager} from '../connection/ConnectionManager.js';
import {emitSubAgentMessage} from './subAgentTypes.js';
import type {SubAgentExecutionContext, ChatMessage} from './subAgentTypes.js';

export interface InterceptResult {
	remainingToolCalls: any[];
}

// ── send_message_to_agent ──

export function interceptSendMessage(
	ctx: SubAgentExecutionContext,
	toolCalls: any[],
): InterceptResult {
	const sendMsgTools = toolCalls.filter(
		(tc: any) => tc.function.name === 'send_message_to_agent',
	);

	if (sendMsgTools.length === 0 || !ctx.instanceId) {
		return {remainingToolCalls: toolCalls};
	}

	for (const sendMsgTool of sendMsgTools) {
		let targetAgentId: string | undefined;
		let targetInstanceId: string | undefined;
		let msgContent = '';

		try {
			const args = JSON.parse(sendMsgTool.function.arguments);
			targetAgentId = args.target_agent_id;
			targetInstanceId = args.target_instance_id;
			msgContent = args.message || '';
		} catch (error) {
			console.error(
				'Failed to parse send_message_to_agent arguments:',
				error,
			);
		}

		let success = false;
		let resultText = '';

		if (!msgContent) {
			resultText = 'Error: message content is empty';
		} else if (targetInstanceId) {
			success = runningSubAgentTracker.sendInterAgentMessage(
				ctx.instanceId!,
				targetInstanceId,
				msgContent,
			);
			if (success) {
				const targetAgent = runningSubAgentTracker
					.getRunningAgents()
					.find(a => a.instanceId === targetInstanceId);
				resultText = `Message sent to ${
					targetAgent?.agentName || targetInstanceId
				}`;
			} else {
				resultText = `Error: Target agent instance "${targetInstanceId}" is not running`;
			}
		} else if (targetAgentId) {
			const targetAgent =
				runningSubAgentTracker.findInstanceByAgentId(targetAgentId);
			if (targetAgent && targetAgent.instanceId !== ctx.instanceId) {
				success = runningSubAgentTracker.sendInterAgentMessage(
					ctx.instanceId!,
					targetAgent.instanceId,
					msgContent,
				);
				if (success) {
					resultText = `Message sent to ${targetAgent.agentName} (instance: ${targetAgent.instanceId})`;
				} else {
					resultText = `Error: Failed to send message to ${targetAgentId}`;
				}
			} else if (targetAgent && targetAgent.instanceId === ctx.instanceId) {
				resultText = 'Error: Cannot send a message to yourself';
			} else {
				resultText = `Error: No running agent found with ID "${targetAgentId}"`;
			}
		} else {
			resultText =
				'Error: Either target_agent_id or target_instance_id must be provided';
		}

		ctx.messages.push({
			role: 'tool' as const,
			tool_call_id: sendMsgTool.id,
			content: JSON.stringify({success, result: resultText}),
		});

		emitSubAgentMessage(ctx, {
			type: 'inter_agent_sent',
			targetAgentId: targetAgentId || targetInstanceId || 'unknown',
			targetAgentName:
				(targetInstanceId
					? runningSubAgentTracker
							.getRunningAgents()
							.find(a => a.instanceId === targetInstanceId)?.agentName
					: targetAgentId
					? runningSubAgentTracker.findInstanceByAgentId(targetAgentId)
							?.agentName
					: undefined) ||
				targetAgentId ||
				'unknown',
			content: msgContent,
			success,
		});
	}

	const remaining = toolCalls.filter(
		(tc: any) => tc.function.name !== 'send_message_to_agent',
	);
	return {remainingToolCalls: remaining};
}

// ── query_agents_status ──

export function interceptQueryStatus(
	ctx: SubAgentExecutionContext,
	toolCalls: any[],
): InterceptResult {
	const queryStatusTools = toolCalls.filter(
		(tc: any) => tc.function.name === 'query_agents_status',
	);

	if (queryStatusTools.length === 0) {
		return {remainingToolCalls: toolCalls};
	}

	for (const queryTool of queryStatusTools) {
		const allAgents = runningSubAgentTracker.getRunningAgents();
		const statusList = allAgents.map(a => ({
			instanceId: a.instanceId,
			agentId: a.agentId,
			agentName: a.agentName,
			prompt: a.prompt ? a.prompt.substring(0, 150) : 'N/A',
			runningFor: `${Math.floor(
				(Date.now() - a.startedAt.getTime()) / 1000,
			)}s`,
			isSelf: a.instanceId === ctx.instanceId,
		}));

		ctx.messages.push({
			role: 'tool' as const,
			tool_call_id: queryTool.id,
			content: JSON.stringify({
				totalRunning: allAgents.length,
				agents: statusList,
			}),
		});
	}

	const remaining = toolCalls.filter(
		(tc: any) => tc.function.name !== 'query_agents_status',
	);
	return {remainingToolCalls: remaining};
}

// ── spawn_sub_agent ──

export function interceptSpawnSubAgent(
	ctx: SubAgentExecutionContext,
	toolCalls: any[],
	executeSubAgentFn: (
		agentId: string,
		prompt: string,
		onMessage?: any,
		abortSignal?: AbortSignal,
		requestToolConfirmation?: any,
		isToolAutoApproved?: any,
		yoloMode?: boolean,
		addToAlwaysApproved?: any,
		requestUserQuestion?: any,
		instanceId?: string,
		spawnDepth?: number,
	) => Promise<any>,
): InterceptResult {
	const spawnTools = toolCalls.filter(
		(tc: any) => tc.function.name === 'spawn_sub_agent',
	);

	if (spawnTools.length === 0 || !ctx.instanceId) {
		return {remainingToolCalls: toolCalls};
	}

	for (const spawnTool of spawnTools) {
		let spawnAgentId = '';
		let spawnPrompt = '';

		try {
			const args = JSON.parse(spawnTool.function.arguments);
			spawnAgentId = args.agent_id || '';
			spawnPrompt = args.prompt || '';
		} catch (error) {
			console.error('Failed to parse spawn_sub_agent arguments:', error);
		}

		if (!spawnAgentId || !spawnPrompt) {
			ctx.messages.push({
				role: 'tool' as const,
				tool_call_id: spawnTool.id,
				content: JSON.stringify({
					success: false,
					error: 'Both agent_id and prompt are required',
				}),
			});
			continue;
		}

		if (spawnAgentId === ctx.agent.id) {
			ctx.messages.push({
				role: 'tool' as const,
				tool_call_id: spawnTool.id,
				content: JSON.stringify({
					success: false,
					error: `REJECTED: You (${ctx.agent.name}) attempted to spawn another "${spawnAgentId}" which is the SAME type as yourself. This is not allowed because it wastes resources and delegates work you should complete yourself. If you need help from a DIFFERENT specialization, spawn a different agent type. If the task is within your capabilities, do it yourself.`,
				}),
			});
			continue;
		}

		let spawnAgentName = spawnAgentId;
		try {
			const agentConfig = getSubAgent(spawnAgentId);
			if (agentConfig) {
				spawnAgentName = agentConfig.name;
			}
		} catch {
			const builtinNames: Record<string, string> = {
				agent_explore: 'Explore Agent',
				agent_plan: 'Plan Agent',
				agent_general: 'General Purpose Agent',
				agent_analyze: 'Requirement Analysis Agent',
				agent_qa: 'QA Agent',
				agent_debug: 'Debug Assistant',
			};
			spawnAgentName = builtinNames[spawnAgentId] || spawnAgentId;
		}

		const spawnInstanceId = `spawn-${Date.now()}-${Math.random()
			.toString(36)
			.slice(2, 8)}`;

		const spawnerInfo = {
			instanceId: ctx.instanceId,
			agentId: ctx.agent.id,
			agentName: ctx.agent.name,
		};

		ctx.spawnedChildInstanceIds.add(spawnInstanceId);

		runningSubAgentTracker.register({
			instanceId: spawnInstanceId,
			agentId: spawnAgentId,
			agentName: spawnAgentName,
			prompt: spawnPrompt,
			startedAt: new Date(),
		});

		executeSubAgentFn(
			spawnAgentId,
			spawnPrompt,
			ctx.onMessage,
			ctx.abortSignal,
			ctx.requestToolConfirmation,
			ctx.isToolAutoApproved,
			ctx.yoloMode,
			ctx.addToAlwaysApproved,
			ctx.requestUserQuestion,
			spawnInstanceId,
			ctx.spawnDepth + 1,
		)
			.then(result => {
				runningSubAgentTracker.storeSpawnedResult({
					instanceId: spawnInstanceId,
					agentId: spawnAgentId,
					agentName: spawnAgentName,
					prompt:
						spawnPrompt.length > 200
							? spawnPrompt.substring(0, 200) + '...'
							: spawnPrompt,
					success: result.success,
					result: result.result,
					error: result.error,
					completedAt: new Date(),
					spawnedBy: spawnerInfo,
				});
			})
			.catch(error => {
				runningSubAgentTracker.storeSpawnedResult({
					instanceId: spawnInstanceId,
					agentId: spawnAgentId,
					agentName: spawnAgentName,
					prompt:
						spawnPrompt.length > 200
							? spawnPrompt.substring(0, 200) + '...'
							: spawnPrompt,
					success: false,
					result: '',
					error: error instanceof Error ? error.message : 'Unknown error',
					completedAt: new Date(),
					spawnedBy: spawnerInfo,
				});
			})
			.finally(() => {
				runningSubAgentTracker.unregister(spawnInstanceId);
			});

		emitSubAgentMessage(ctx, {
			type: 'agent_spawned',
			spawnedAgentId: spawnAgentId,
			spawnedAgentName: spawnAgentName,
			spawnedInstanceId: spawnInstanceId,
			spawnedPrompt: spawnPrompt,
		});

		ctx.messages.push({
			role: 'tool' as const,
			tool_call_id: spawnTool.id,
			content: JSON.stringify({
				success: true,
				result: `Agent "${spawnAgentName}" (${spawnAgentId}) has been spawned and is now running in the background with instance ID "${spawnInstanceId}". Its results will be automatically reported to the main workflow when it completes.`,
			}),
		});
	}

	const remaining = toolCalls.filter(
		(tc: any) => tc.function.name !== 'spawn_sub_agent',
	);
	return {remainingToolCalls: remaining};
}

// ── askuser ──

export async function interceptAskUser(
	ctx: SubAgentExecutionContext,
	toolCalls: any[],
): Promise<InterceptResult> {
	const askUserTool = toolCalls.find((tc: any) =>
		tc.function.name.startsWith('askuser-'),
	);

	if (!askUserTool || !ctx.requestUserQuestion) {
		return {remainingToolCalls: toolCalls};
	}

	let question = 'Please select an option:';
	let options: string[] = ['Yes', 'No'];
	let multiSelect = false;
	let parsedArgs: Record<string, any> = {};

	try {
		parsedArgs = JSON.parse(askUserTool.function.arguments);
		if (parsedArgs['question']) question = parsedArgs['question'];
		if (parsedArgs['options'] && Array.isArray(parsedArgs['options'])) {
			options = parsedArgs['options'];
		}
		if (parsedArgs['multiSelect'] === true) {
			multiSelect = true;
		}
	} catch (error) {
		console.error('Failed to parse askuser tool arguments:', error);
	}

	// Execute beforeToolCall hook
	try {
		const hookResult = await unifiedHooksExecutor.executeHooks(
			'beforeToolCall',
			{toolName: askUserTool.function.name, args: parsedArgs},
		);
		const interpreted = interpretHookResult('beforeToolCall', hookResult);
		if (interpreted.action === 'block') {
			const content = interpreted.replacedContent || '';
			ctx.messages.push({
				role: 'tool' as const,
				tool_call_id: askUserTool.id,
				content,
				...(interpreted.hookFailed ? {hookFailed: true, hookErrorDetails: interpreted.errorDetails} : {}),
			} as ChatMessage);
			emitSubAgentMessage(ctx, {
				type: 'tool_result',
				tool_call_id: askUserTool.id,
				tool_name: askUserTool.function.name,
				content,
				...(interpreted.hookFailed ? {hookFailed: true, hookErrorDetails: interpreted.errorDetails} : {}),
			});
			const remainingTools = toolCalls.filter(
				(tc: any) => tc.id !== askUserTool.id,
			);
			return {remainingToolCalls: remainingTools};
		}
	} catch (hookError) {
		console.warn(
			'Failed to execute beforeToolCall hook for askuser in sub-agent:',
			hookError,
		);
	}

	// Notify server that user interaction is needed
	if (connectionManager.isConnected()) {
		await connectionManager.notifyUserInteractionNeeded(
			question,
			options,
			askUserTool.id,
			multiSelect,
		);
	}

	const userAnswer = await ctx.requestUserQuestion(
		question,
		options,
		multiSelect,
	);

	const answerText = userAnswer.customInput
		? `${
				Array.isArray(userAnswer.selected)
					? userAnswer.selected.join(', ')
					: userAnswer.selected
		  }: ${userAnswer.customInput}`
		: Array.isArray(userAnswer.selected)
		? userAnswer.selected.join(', ')
		: userAnswer.selected;

	const resultContent = JSON.stringify({
		answer: answerText,
		selected: userAnswer.selected,
		customInput: userAnswer.customInput,
	});

	const toolResult = {
		role: 'tool' as const,
		tool_call_id: askUserTool.id,
		content: resultContent,
	};

	ctx.messages.push(toolResult);

	emitSubAgentMessage(ctx, {
		type: 'tool_result',
		tool_call_id: askUserTool.id,
		tool_name: askUserTool.function.name,
		content: resultContent,
	});

	// Execute afterToolCall hook
	try {
		await unifiedHooksExecutor.executeHooks('afterToolCall', {
			toolName: askUserTool.function.name,
			args: parsedArgs,
			result: toolResult,
			error: null,
		});
	} catch (hookError) {
		console.warn('Failed to execute afterToolCall hook for askuser in sub-agent:', hookError);
	}

	const remaining = toolCalls.filter((tc: any) => tc.id !== askUserTool.id);
	return {remainingToolCalls: remaining};
}
