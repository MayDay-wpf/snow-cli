import {executeMCPTool} from './mcpToolsManager.js';
import {unifiedHooksExecutor} from './unifiedHooksExecutor.js';
import {interpretHookResult} from './hookResultInterpreter.js';
import {checkYoloPermission} from './yoloPermissionChecker.js';
import {emitSubAgentMessage} from './subAgentTypes.js';
import type {SubAgentExecutionContext, ChatMessage, SubAgentResult} from './subAgentTypes.js';

export interface ApprovalResult {
	approvedToolCalls: any[];
	/** true = caller should `continue` the main loop (all handled, no MCP execution needed) */
	shouldContinue: boolean;
	/** true = sub-agent was aborted during tool execution */
	aborted: boolean;
	abortResult?: SubAgentResult;
}

export async function checkAndApproveTools(
	ctx: SubAgentExecutionContext,
	toolCalls: any[],
): Promise<ApprovalResult> {
	const approvedToolCalls: any[] = [];
	const rejectedToolCalls: any[] = [];
	const rejectionReasons = new Map<string, string>();
	let shouldStopAfterRejection = false;
	let stopRejectedToolName: string | undefined;
	let stopRejectionReason: string | undefined;

	for (const toolCall of toolCalls) {
		const toolName = toolCall.function.name;
		let args: any;
		try {
			args = JSON.parse(toolCall.function.arguments);
		} catch {
			args = {};
		}

		const permissionResult = await checkYoloPermission(
			toolName,
			args,
			ctx.yoloMode,
		);
		let needsConfirmation = permissionResult.needsConfirmation;

		if (
			ctx.sessionApprovedTools.has(toolName) ||
			(ctx.isToolAutoApproved && ctx.isToolAutoApproved(toolName))
		) {
			needsConfirmation = false;
		}

		if (needsConfirmation && ctx.requestToolConfirmation) {
			const confirmation = await ctx.requestToolConfirmation(toolName, args);

			if (
				confirmation === 'reject' ||
				(typeof confirmation === 'object' &&
					confirmation.type === 'reject_with_reply')
			) {
				rejectedToolCalls.push(toolCall);
				if (typeof confirmation === 'object' && confirmation.reason) {
					rejectionReasons.set(toolCall.id, confirmation.reason);
				}
				if (confirmation === 'reject') {
					shouldStopAfterRejection = true;
					stopRejectedToolName = toolName;
					stopRejectionReason = rejectionReasons.get(toolCall.id);
					break;
				}
				continue;
			}
			if (confirmation === 'approve_always') {
				ctx.sessionApprovedTools.add(toolName);
				if (ctx.addToAlwaysApproved) {
					ctx.addToAlwaysApproved(toolName);
				}
			}
		}

		approvedToolCalls.push(toolCall);
	}

	// Handle rejections
	if (rejectedToolCalls.length > 0) {
		const rejectionResults: ChatMessage[] = [];
		const handledToolIds = new Set<string>([
			...approvedToolCalls.map((tc: any) => tc.id),
			...rejectedToolCalls.map((tc: any) => tc.id),
		]);
		const cancelledToolCalls = shouldStopAfterRejection
			? toolCalls.filter((tc: any) => !handledToolIds.has(tc.id))
			: [];
		const abortedApprovedToolCalls = shouldStopAfterRejection
			? [...approvedToolCalls]
			: [];

		for (const toolCall of rejectedToolCalls) {
			const rejectionReason = rejectionReasons.get(toolCall.id);
			const rejectMessage = rejectionReason
				? `Tool execution rejected by user: ${rejectionReason}`
				: 'Tool execution rejected by user';

			rejectionResults.push({
				role: 'tool' as const,
				tool_call_id: toolCall.id,
				content: `Error: ${rejectMessage}`,
			});

			emitSubAgentMessage(ctx, {
				type: 'tool_result',
				tool_call_id: toolCall.id,
				tool_name: toolCall.function.name,
				content: `Error: ${rejectMessage}`,
				rejection_reason: rejectionReason,
			});
		}

		if (shouldStopAfterRejection) {
			const cancelledMessage = stopRejectedToolName
				? `Tool execution cancelled because the user rejected tool "${stopRejectedToolName}" and requested the sub-agent to stop`
				: 'Tool execution cancelled because the user requested the sub-agent to stop';

			for (const toolCall of [
				...abortedApprovedToolCalls,
				...cancelledToolCalls,
			]) {
				rejectionResults.push({
					role: 'tool' as const,
					tool_call_id: toolCall.id,
					content: `Error: ${cancelledMessage}`,
				});

				emitSubAgentMessage(ctx, {
					type: 'tool_result',
					tool_call_id: toolCall.id,
					tool_name: toolCall.function.name,
					content: `Error: ${cancelledMessage}`,
				});
			}
		}

		ctx.messages.push(...rejectionResults);

		if (shouldStopAfterRejection) {
			const stopInstructionLines = [
				`[System] The user rejected your request to run tool "${
					stopRejectedToolName || 'unknown tool'
				}" and asked you to stop.`,
				stopRejectionReason
					? `[System] Rejection reason: ${stopRejectionReason}`
					: undefined,
				'[System] Do not call any more tools.',
				'[System] Based only on the information already available in this conversation, provide a final summary of what you know, clearly state any missing information caused by the rejected tool, and then end your work.',
			].filter(Boolean);
			const stopInstruction = stopInstructionLines.join('\n');
			ctx.collectedTerminationInstructions.push(stopInstruction);
			ctx.messages.push({
				role: 'user',
				content: stopInstruction,
			});
			return {approvedToolCalls: [], shouldContinue: true, aborted: false};
		}

		if (approvedToolCalls.length === 0) {
			return {approvedToolCalls: [], shouldContinue: true, aborted: false};
		}
	}

	return {approvedToolCalls, shouldContinue: false, aborted: false};
}

export async function executeMcpTools(
	ctx: SubAgentExecutionContext,
	approvedToolCalls: any[],
): Promise<{aborted: boolean; abortResult?: SubAgentResult}> {
	const toolResults: ChatMessage[] = [];

	for (const toolCall of approvedToolCalls) {
		if (ctx.abortSignal?.aborted) {
			emitSubAgentMessage(ctx, {type: 'done'});
			return {
				aborted: true,
				abortResult: {
					success: false,
					result: ctx.finalResponse,
					error: 'Sub-agent execution aborted during tool execution',
				},
			};
		}

		let args: any = {};
		try {
			args = JSON.parse(toolCall.function.arguments);

			// Execute beforeToolCall hook
			try {
				const hookResult = await unifiedHooksExecutor.executeHooks(
					'beforeToolCall',
					{toolName: toolCall.function.name, args},
				);
				const interpreted = interpretHookResult('beforeToolCall', hookResult);
				if (interpreted.action === 'block') {
					const content = interpreted.replacedContent || '';
					toolResults.push({
						role: 'tool' as const,
						tool_call_id: toolCall.id,
						content,
						...(interpreted.hookFailed ? {hookFailed: true, hookErrorDetails: interpreted.errorDetails} : {}),
					} as ChatMessage);
					emitSubAgentMessage(ctx, {
						type: 'tool_result',
						tool_call_id: toolCall.id,
						tool_name: toolCall.function.name,
						content,
						...(interpreted.hookFailed ? {hookFailed: true, hookErrorDetails: interpreted.errorDetails} : {}),
					});
					continue;
				}
			} catch (hookError) {
				console.warn('Failed to execute beforeToolCall hook in sub-agent:', hookError);
			}

			const result = await executeMCPTool(
				toolCall.function.name,
				args,
				ctx.abortSignal,
			);

			const resultContent = JSON.stringify(result);
			toolResults.push({
				role: 'tool' as const,
				tool_call_id: toolCall.id,
				content: resultContent,
			});
			emitSubAgentMessage(ctx, {
				type: 'tool_result',
				tool_call_id: toolCall.id,
				tool_name: toolCall.function.name,
				content: resultContent,
			});

			// Execute afterToolCall hook
			try {
				const afterHookResult = await unifiedHooksExecutor.executeHooks(
					'afterToolCall',
					{
						toolName: toolCall.function.name,
						args,
						result: {tool_call_id: toolCall.id, role: 'tool', content: resultContent},
						error: null,
					},
				);
				const afterInterpreted = interpretHookResult('afterToolCall', afterHookResult);
				if (afterInterpreted.action === 'replace') {
					const lastResult = toolResults[toolResults.length - 1];
					if (lastResult) {
						lastResult.content = afterInterpreted.replacedContent || lastResult.content;
					}
				}
			} catch (hookError) {
				console.warn('Failed to execute afterToolCall hook in sub-agent:', hookError);
			}
		} catch (error) {
			const errorContent = `Error: ${
				error instanceof Error ? error.message : 'Tool execution failed'
			}`;
			toolResults.push({
				role: 'tool' as const,
				tool_call_id: toolCall.id,
				content: errorContent,
			});
			emitSubAgentMessage(ctx, {
				type: 'tool_result',
				tool_call_id: toolCall.id,
				tool_name: toolCall.function.name,
				content: errorContent,
			});

			try {
				await unifiedHooksExecutor.executeHooks('afterToolCall', {
					toolName: toolCall.function.name,
					args,
					result: {tool_call_id: toolCall.id, role: 'tool', content: errorContent},
					error: error instanceof Error ? error : new Error(String(error)),
				});
			} catch (hookError) {
				console.warn('Failed to execute afterToolCall hook in sub-agent:', hookError);
			}
		}
	}

	ctx.messages.push(...toolResults);
	return {aborted: false};
}
