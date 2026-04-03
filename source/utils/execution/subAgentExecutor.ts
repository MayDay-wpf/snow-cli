import {collectAllMCPTools} from './mcpToolsManager.js';
import {getOpenAiConfig} from '../config/apiConfig.js';
import {sessionManager} from '../session/sessionManager.js';
import {unifiedHooksExecutor} from './unifiedHooksExecutor.js';
import {interpretHookResult} from './hookResultInterpreter.js';
import {runningSubAgentTracker} from './runningSubAgentTracker.js';
import {resolveAgent, filterAllowedTools} from './subAgentResolver.js';
import {injectBuiltinTools, buildInitialMessages} from './subAgentBuiltinTools.js';
import {
	createApiStream,
	processStreamEvents,
	handleContextCompression,
} from './subAgentStreamProcessor.js';
import {
	interceptSendMessage,
	interceptQueryStatus,
	interceptSpawnSubAgent,
	interceptAskUser,
} from './subAgentToolInterceptor.js';
import {checkAndApproveTools, executeMcpTools} from './subAgentToolApproval.js';
import {emitSubAgentMessage} from './subAgentTypes.js';
import type {
	SubAgentExecutionContext,
	SubAgentMessage,
	SubAgentResult,
	ToolConfirmationCallback,
	ToolApprovalChecker,
	AddToAlwaysApprovedCallback,
	UserQuestionCallback,
} from './subAgentTypes.js';

// Re-export all public types for backward compatibility
export type {
	SubAgentMessage,
	TokenUsage,
	SubAgentResult,
	ToolConfirmationCallback,
	ToolApprovalChecker,
	AddToAlwaysApprovedCallback,
	UserQuestionCallback,
} from './subAgentTypes.js';

/**
 * 执行子智能体作为工具
 */
export async function executeSubAgent(
	agentId: string,
	prompt: string,
	onMessage?: (message: SubAgentMessage) => void,
	abortSignal?: AbortSignal,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
	requestUserQuestion?: UserQuestionCallback,
	instanceId?: string,
	spawnDepth: number = 0,
): Promise<SubAgentResult> {
	try {
		// 1. Resolve agent
		const {agent, error: resolveError} = await resolveAgent(agentId);
		if (!agent) {
			return {success: false, result: '', error: resolveError};
		}

		// 2. Filter tools + inject builtin tools
		const allTools = await collectAllMCPTools();
		const allowedTools = filterAllowedTools(agent, allTools);
		if (allowedTools.length === 0) {
			return {
				success: false,
				result: '',
				error: `Sub-agent "${agent.name}" has no valid tools configured`,
			};
		}
		injectBuiltinTools(allowedTools, spawnDepth);

		// 3. Build initial messages
		const messages = await buildInitialMessages(
			agent,
			prompt,
			instanceId,
			spawnDepth,
		);

		// 4. Build execution context
		const ctx: SubAgentExecutionContext = {
			agent,
			instanceId,
			messages,
			onMessage,
			abortSignal,
			requestToolConfirmation,
			isToolAutoApproved,
			yoloMode: yoloMode ?? false,
			addToAlwaysApproved,
			requestUserQuestion,
			spawnDepth,
			sessionApprovedTools: new Set<string>(),
			spawnedChildInstanceIds: new Set<string>(),
			collectedInjectedMessages: [],
			collectedTerminationInstructions: [],
			latestTotalTokens: 0,
			totalUsage: undefined,
			finalResponse: '',
		};

		// 5. Main loop
		// eslint-disable-next-line no-constant-condition
		while (true) {
			if (abortSignal?.aborted) {
				emitSubAgentMessage(ctx, {type: 'done'});
				return {
					success: false,
					result: ctx.finalResponse,
					error: 'Sub-agent execution aborted',
				};
			}

			// Inject pending user / inter-agent messages
			injectPendingMessages(ctx);

			// Resolve config + create API stream
			const {config, model} = await resolveConfig(agent);
			const currentSession = sessionManager.getCurrentSession();
			const stream = createApiStream(
				config,
				model,
				ctx.messages,
				allowedTools,
				currentSession?.id,
				agent.configProfile,
				abortSignal,
			);

			// Process stream events
			ctx.latestTotalTokens = 0;
			const {toolCalls, hasError, errorMessage} =
				await processStreamEvents(ctx, stream, config);

			if (hasError) {
				return {
					success: false,
					result: ctx.finalResponse,
					error: errorMessage,
				};
			}

			// Context compression
			const compressed = await handleContextCompression(ctx, config, model);
			if (compressed && toolCalls.length === 0) {
				// Remove premature exit response, inject continuation
				while (
					ctx.messages.length > 0 &&
					ctx.messages[ctx.messages.length - 1]?.role === 'assistant'
				) {
					ctx.messages.pop();
				}
				ctx.messages.push({
					role: 'user',
					content:
						'[System] Your context has been auto-compressed to free up space. Your task is NOT finished. Continue working based on the compressed context above. Pick up where you left off.',
				});
				continue;
			}

			// No tool calls → check spawned children / completion hooks → break
			if (toolCalls.length === 0) {
				if (await handleSpawnedChildren(ctx)) continue;
				if (await handleCompletionHooks(ctx)) continue;
				break;
			}

			// Intercept builtin tools
			let remaining = toolCalls;
			remaining = interceptSendMessage(ctx, remaining).remainingToolCalls;
			remaining = interceptQueryStatus(ctx, remaining).remainingToolCalls;
			remaining = interceptSpawnSubAgent(
				ctx,
				remaining,
				executeSubAgent,
			).remainingToolCalls;
			remaining = (
				await interceptAskUser(ctx, remaining)
			).remainingToolCalls;
			if (remaining.length === 0) continue;

			// Approve + execute MCP tools
			const approval = await checkAndApproveTools(ctx, remaining);
			if (approval.shouldContinue) continue;

			const execResult = await executeMcpTools(
				ctx,
				approval.approvedToolCalls,
			);
			if (execResult.aborted && execResult.abortResult) {
				return execResult.abortResult;
			}
		}

		return {
			success: true,
			result: ctx.finalResponse,
			usage: ctx.totalUsage,
			injectedUserMessages:
				ctx.collectedInjectedMessages.length > 0
					? ctx.collectedInjectedMessages
					: undefined,
			terminationInstructions:
				ctx.collectedTerminationInstructions.length > 0
					? ctx.collectedTerminationInstructions
					: undefined,
		};
	} catch (error) {
		return {
			success: false,
			result: '',
			error: error instanceof Error ? error.message : 'Unknown error',
		};
	}
}

// ── Helper: inject pending user / inter-agent messages ──

function injectPendingMessages(ctx: SubAgentExecutionContext): void {
	if (!ctx.instanceId) return;

	const injectedMessages = runningSubAgentTracker.dequeueMessages(
		ctx.instanceId,
	);
	for (const injectedMsg of injectedMessages) {
		ctx.collectedInjectedMessages.push(injectedMsg);
		ctx.messages.push({
			role: 'user',
			content: `[User message from main session]\n${injectedMsg}`,
		});
		emitSubAgentMessage(ctx, {
			type: 'user_injected',
			content: injectedMsg,
		});
	}

	const interAgentMessages =
		runningSubAgentTracker.dequeueInterAgentMessages(ctx.instanceId);
	for (const iaMsg of interAgentMessages) {
		ctx.messages.push({
			role: 'user',
			content: `[Inter-agent message from ${iaMsg.fromAgentName} (${iaMsg.fromAgentId})]\n${iaMsg.content}`,
		});
		emitSubAgentMessage(ctx, {
			type: 'inter_agent_received',
			fromAgentId: iaMsg.fromAgentId,
			fromAgentName: iaMsg.fromAgentName,
			content: iaMsg.content,
		});
	}
}

// ── Helper: resolve config/model for the agent ──

async function resolveConfig(
	agent: any,
): Promise<{config: any; model: string}> {
	if (agent.configProfile) {
		try {
			const {loadProfile} = await import('../config/configManager.js');
			const profileConfig = loadProfile(agent.configProfile);
			if (profileConfig?.snowcfg) {
				const config = profileConfig.snowcfg;
				return {config, model: config.advancedModel || 'gpt-5'};
			}
		} catch (error) {
			console.warn(
				`Failed to load profile ${agent.configProfile} for sub-agent, using main config:`,
				error,
			);
		}
	}

	const config = getOpenAiConfig();
	return {config, model: config.advancedModel || 'gpt-5'};
}

// ── Helper: wait for spawned child agents ──

async function handleSpawnedChildren(
	ctx: SubAgentExecutionContext,
): Promise<boolean> {
	const runningChildren = Array.from(ctx.spawnedChildInstanceIds).filter(id =>
		runningSubAgentTracker.isRunning(id),
	);

	if (
		runningChildren.length === 0 &&
		!runningSubAgentTracker.hasSpawnedResults()
	) {
		return false;
	}

	if (runningChildren.length > 0) {
		await runningSubAgentTracker.waitForSpawnedAgents(
			300_000,
			ctx.abortSignal,
		);
	}

	const spawnedResults = runningSubAgentTracker.drainSpawnedResults();
	if (spawnedResults.length === 0) return false;

	for (const sr of spawnedResults) {
		const statusIcon = sr.success ? '\u2713' : '\u2717';
		const resultSummary = sr.success
			? sr.result.length > 800
				? sr.result.substring(0, 800) + '...'
				: sr.result
			: sr.error || 'Unknown error';

		ctx.messages.push({
			role: 'user',
			content: `[Spawned Sub-Agent Result] ${statusIcon} ${sr.agentName} (${sr.agentId})\nPrompt: ${sr.prompt}\nResult: ${resultSummary}`,
		});

		emitSubAgentMessage(ctx, {
			type: 'spawned_agent_completed',
			spawnedAgentId: sr.agentId,
			spawnedAgentName: sr.agentName,
			success: sr.success,
		});
	}

	emitSubAgentMessage(ctx, {type: 'done'});
	return true;
}

// ── Helper: onSubAgentComplete hooks ──

async function handleCompletionHooks(
	ctx: SubAgentExecutionContext,
): Promise<boolean> {
	try {
		const hookResult = await unifiedHooksExecutor.executeHooks(
			'onSubAgentComplete',
			{
				agentId: ctx.agent.id,
				agentName: ctx.agent.name,
				content: ctx.finalResponse,
				success: true,
				usage: ctx.totalUsage,
			},
		);
		const interpreted = interpretHookResult('onSubAgentComplete', hookResult);

		if (interpreted.injectedMessages && interpreted.injectedMessages.length > 0) {
			for (const injected of interpreted.injectedMessages) {
				ctx.messages.push({role: injected.role, content: injected.content});
			}
		}

		if (interpreted.shouldContinueConversation) {
			emitSubAgentMessage(ctx, {type: 'done'});
		}

		return interpreted.shouldContinueConversation || false;
	} catch (error) {
		console.error('onSubAgentComplete hook execution failed:', error);
		return false;
	}
}
