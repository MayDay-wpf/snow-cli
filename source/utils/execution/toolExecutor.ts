import {executeMCPTool} from './mcpToolsManager.js';
import {maskToolResultContentIfNeeded} from '../../api/privacyMask.js';
import {subAgentService} from '../../mcp/subagent.js';
import {teamService} from '../../mcp/team.js';
import {runningSubAgentTracker} from './runningSubAgentTracker.js';
import {
	endToolSpan,
	recordToolContent,
	startToolSpan,
	withActiveTelemetrySpan,
} from '../telemetry/otel.js';

import type {SubAgentMessage} from './subAgentExecutor.js';
import type {ConfirmationResult} from '../../ui/components/tools/ToolConfirmation.js';
import type {ImageContent} from '../../api/types.js';
import type {UnifiedHookExecutionResult} from './unifiedHooksExecutor.js';
import {extractMultimodalContent} from './toolResultNormalizer.js';
import {logger} from '../core/logger.js';

const log = logger.child('execution.toolExecutor');

//安全解析JSON，处理可能被拼接的多个JSON对象
function safeParseToolArguments(argsString: string): Record<string, any> {
	if (!argsString || argsString.trim() === '') {
		return {};
	}

	try {
		return JSON.parse(argsString);
	} catch (error) {
		log.debug(
			'Failed to parse full tool arguments JSON, attempting partial extraction',
			{error, argsString},
		);
		//尝试只解析第一个完整的JSON对象
		//这处理了多个工具调用参数被错误拼接的情况
		const firstBraceIndex = argsString.indexOf('{');
		if (firstBraceIndex === -1) {
			return {};
		}

		let braceCount = 0;
		let inString = false;
		let escapeNext = false;

		for (let i = firstBraceIndex; i < argsString.length; i++) {
			const char = argsString[i];

			if (escapeNext) {
				escapeNext = false;
				continue;
			}

			if (char === '\\') {
				escapeNext = true;
				continue;
			}

			if (char === '"') {
				inString = !inString;
				continue;
			}

			if (!inString) {
				if (char === '{') {
					braceCount++;
				} else if (char === '}') {
					braceCount--;
					if (braceCount === 0) {
						//找到第一个完整的JSON对象
						const firstJsonObject = argsString.substring(
							firstBraceIndex,
							i + 1,
						);
						try {
							return JSON.parse(firstJsonObject);
						} catch (firstObjError) {
							log.debug(
								'Failed to parse extracted JSON object from tool arguments',
								{error: firstObjError, firstJsonObject},
							);
							return {};
						}
					}
				}
			}
		}

		return {};
	}
}

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

export interface ToolResult {
	tool_call_id: string;
	role: 'tool';
	content: string;
	images?: ImageContent[]; // Support multimodal content with images
	editDiffData?: Record<string, any>; // Pre-extracted edit diff data for DiffViewer (survives token truncation)
	messageStatus?: 'pending' | 'success' | 'error'; // Message status for UI rendering
	hookFailed?: boolean; // Indicates if a hook failed and AI flow should be interrupted
	hookErrorDetails?: {
		type: 'warning' | 'error';
		exitCode: number;
		command: string;
		output?: string;
		error?: string;
	}; // Hook error details for UI rendering
}

export type SubAgentMessageCallback = (message: SubAgentMessage) => void;

export interface ToolConfirmationCallback {
	(
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	): Promise<ConfirmationResult>;
}

export interface ToolApprovalChecker {
	(toolName: string): boolean;
}

export interface AddToAlwaysApprovedCallback {
	(toolName: string): void;
}

export interface UserInteractionCallback {
	(question: string, options: string[], multiSelect?: boolean): Promise<{
		selected: string | string[];
		customInput?: string;
		cancelled?: boolean;
	}>;
}

/**
 * 将 askuser-ask_question 的选择结果格式化为 AI 可读的文本。
 *
 * @param selected - 用户选择的值（单个或多个）
 * @param customInput - 用户额外输入的自定义文本（可选）
 * @returns 格式化后的回答文本
 */
function formatAskUserAnswer(
	selected: string | string[],
	customInput?: string,
): string {
	const selectedText = Array.isArray(selected) ? selected.join(', ') : selected;
	return customInput ? `${selectedText}: ${customInput}` : selectedText;
}

/**
 * 从 beforeToolCall Hook 的执行结果中提取 askuser-ask_question 的选择结果。
 *
 * 当工具为 askuser-ask_question 且 Hook 命令以退出码 0 返回了 stdout 时，
 * 尝试将 stdout 解析为用户的选择结果，从而跳过实际的 UI 交互流程。
 *
 * 支持的 stdout 格式：
 * 1. 纯文本: 直接作为 selected 值
 *    示例: "选项A"
 * 2. JSON 对象: 包含 selected 和可选的 customInput 字段
 *    示例: {"selected": "选项A", "customInput": "补充说明"}
 *    示例: {"selected": ["选项A", "选项B"], "customInput": "补充说明"}
 * 3. JSON 数组: 直接作为多选结果
 *    示例: ["选项A", "选项B"]
 *
 * @param hookResult - Hook 执行结果
 * @returns 解析出的选择结果，如果无法解析则返回 null
 */
function extractHookProvidedAnswer(
	hookResult: UnifiedHookExecutionResult,
): {selected: string | string[]; customInput?: string} | null {
	// 遍历所有 Hook 执行结果，查找第一个成功的 command 输出
	for (const result of hookResult.results) {
		if (result.type !== 'command' || !result.success || !result.output) {
			continue;
		}

		const rawOutput = result.output.trim();
		if (!rawOutput) {
			continue;
		}

		// 尝试解析为 JSON
		try {
			const parsed = JSON.parse(rawOutput);

			// JSON 对象格式: {selected, customInput?}
			if (
				parsed &&
				typeof parsed === 'object' &&
				!Array.isArray(parsed) &&
				parsed.selected !== undefined
			) {
				const selected = parsed.selected;
				if (
					typeof selected === 'string' ||
					(Array.isArray(selected) &&
						selected.every((s: any) => typeof s === 'string'))
				) {
					return {
						selected,
						customInput:
							typeof parsed.customInput === 'string'
								? parsed.customInput
								: undefined,
					};
				}
			}

			// JSON 数组格式: ["选项A", "选项B"]
			if (
				Array.isArray(parsed) &&
				parsed.every((s: any) => typeof s === 'string')
			) {
				return {selected: parsed};
			}
		} catch (error) {
			log.debug(
				'Failed to parse selected option JSON, treating as raw string',
				{error, rawOutput},
			);
			// 不是有效的 JSON，按纯文本处理
			return {selected: rawOutput};
		}
	}

	return null;
}

/**
 * Collect plain text from an arbitrary tool result payload.
 * Mirrors the shapes produced by built-in services and external MCP servers.
 */
function collectToolResultText(raw: unknown, depth = 0): string {
	if (raw === null || raw === undefined || depth > 4) {
		return '';
	}
	if (typeof raw === 'string') {
		return raw;
	}
	if (Array.isArray(raw)) {
		return raw
			.map(item => collectToolResultText(item, depth + 1))
			.filter(Boolean)
			.join('\n');
	}
	if (typeof raw === 'object') {
		const object = raw as Record<string, unknown>;
		if (object['__toolResultContent'] !== undefined) {
			return collectToolResultText(object['__toolResultContent'], depth + 1);
		}
		if (Array.isArray(object['content'])) {
			return collectToolResultText(object['content'], depth + 1);
		}
		if (typeof object['text'] === 'string') {
			return object['text'];
		}
		if (typeof object['error'] === 'string') {
			return object['error'];
		}
		if (typeof object['message'] === 'string') {
			return object['message'];
		}
	}
	return '';
}

/**
 * Decide whether a tool result represents a failure worth repairing.
 * Explicit `isError` / `success: false` flags win; otherwise the
 * `Error:` convention used across built-in tools is checked.
 */
function detectToolResultFailure(raw: unknown): {
	failed: boolean;
	text: string;
} {
	let inner: unknown = raw;
	if (
		raw &&
		typeof raw === 'object' &&
		(raw as Record<string, unknown>)['__toolResultContent'] !== undefined
	) {
		inner = (raw as Record<string, unknown>)['__toolResultContent'];
	}

	if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
		const object = inner as Record<string, unknown>;
		if (object['isError'] === true || object['success'] === false) {
			return {failed: true, text: collectToolResultText(inner)};
		}
	}

	const text = collectToolResultText(raw).trim();
	if (/^error\s*[:：]/i.test(text)) {
		return {failed: true, text};
	}

	return {failed: false, text};
}

/**
 * Append a short correction note to a tool result without changing its shape.
 */
function appendToolResultNote(raw: unknown, note: string): unknown {
	if (typeof raw === 'string') {
		return `${raw}\n\n${note}`;
	}
	if (Array.isArray(raw)) {
		return [...raw, {type: 'text', text: note}];
	}
	if (raw && typeof raw === 'object') {
		const object = raw as Record<string, unknown>;
		if (object['__toolResultContent'] !== undefined) {
			return {
				...object,
				__toolResultContent: appendToolResultNote(
					object['__toolResultContent'],
					note,
				),
			};
		}
		if (Array.isArray(object['content'])) {
			return {
				...object,
				content: [...object['content'], {type: 'text', text: note}],
			};
		}
		if (typeof object['text'] === 'string') {
			return {...object, text: `${object['text']}\n\n${note}`};
		}
	}
	return raw;
}

/**
 * Execute a single tool call and return the result
 */
export async function executeToolCall(
	toolCall: ToolCall,
	abortSignal?: AbortSignal,
	onTokenUpdate?: (tokenCount: number) => void,
	onSubAgentMessage?: SubAgentMessageCallback,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
	onUserInteractionNeeded?: UserInteractionCallback,
	sessionId?: string,
	workingDirectory?: string,
): Promise<ToolResult> {
	let result: ToolResult | undefined;
	let executionError: Error | null = null;
	const telemetry = startToolSpan({
		toolName: toolCall.function.name,
		toolCallId: toolCall.id,
		sessionId,
		conversationId: sessionId,
	});

	return withActiveTelemetrySpan(telemetry.span, async () => {
		// Setup ESC key listener for terminal commands (allows user to interrupt long-running commands)
		let escKeyListener: ((data: Buffer) => void) | undefined;
		let abortController: AbortController | undefined;

		// Only enable ESC interruption for terminal-execute tool
		if (toolCall.function.name === 'terminal-execute' && !abortSignal) {
			abortController = new AbortController();
			abortSignal = abortController.signal;

			escKeyListener = (data: Buffer) => {
				const str = data.toString();
				// ESC key: \x1b
				if (str === '\x1b' && abortController && !abortSignal?.aborted) {
					console.log('\n[ESC] Interrupting command execution...');
					abortController.abort();
				}
			};

			// Enable raw mode to capture ESC key immediately
			if (process.stdin.isTTY && process.stdin.setRawMode) {
				process.stdin.setRawMode(true);
				process.stdin.on('data', escKeyListener);
			}
		}

		// Arguments actually executed. Tool-call correction may replace them
		// with a repaired object, and downstream hooks must see the truth.
		let executedArguments: Record<string, any> | null = null;
		try {
			const args = safeParseToolArguments(toolCall.function.arguments);
			executedArguments = args;
			recordToolContent(
				telemetry.span,
				'tool.input',
				args,
				telemetry.metricAttributes,
			);

			// Execute beforeToolCall hook
			let beforeHookResult: UnifiedHookExecutionResult | null = null;
			try {
				const {unifiedHooksExecutor} = await import(
					'../execution/unifiedHooksExecutor.js'
				);
				const {interpretHookResult} = await import(
					'./hookResultInterpreter.js'
				);
				beforeHookResult = await unifiedHooksExecutor.executeHooks(
					'beforeToolCall',
					{toolName: toolCall.function.name, args},
				);
				const interpreted = interpretHookResult(
					'beforeToolCall',
					beforeHookResult,
				);
				if (interpreted.action === 'block') {
					result = {
						tool_call_id: toolCall.id,
						role: 'tool',
						content: interpreted.replacedContent || '',
						hookFailed: interpreted.hookFailed,
						hookErrorDetails: interpreted.errorDetails,
					};
					return result;
				}
			} catch (error) {
				console.warn('Failed to execute beforeToolCall hook:', error);
			}

			// If the tool is askuser-ask_question, check whether the
			// beforeToolCall hook has already provided an answer on stdout.
			// When a hook returns a selection result, we skip the interactive
			// UI and feed the answer directly back to the AI, allowing the
			// workflow to continue without user intervention.
			if (
				toolCall.function.name === 'askuser-ask_question' &&
				beforeHookResult
			) {
				const hookAnswer = extractHookProvidedAnswer(beforeHookResult);
				if (hookAnswer) {
					const answerText = formatAskUserAnswer(
						hookAnswer.selected,
						hookAnswer.customInput,
					);

					result = {
						tool_call_id: toolCall.id,
						role: 'tool',
						content: JSON.stringify({
							answer: answerText,
							selected: hookAnswer.selected,
							customInput: hookAnswer.customInput,
						}),
					};
					return result;
				}
			}

			// Check if this is a team tool
			if (toolCall.function.name.startsWith('team-')) {
				const teamToolName = toolCall.function.name.substring('team-'.length);
				const teamArgs = args as Record<string, any>;

				try {
					const teamResult = await teamService.execute({
						toolName: teamToolName,
						args: teamArgs,
						onMessage: onSubAgentMessage,
						abortSignal,
						requestToolConfirmation: requestToolConfirmation
							? async (toolName: string, toolArgs: any) => {
									const fakeToolCall = {
										id: 'team-tool',
										type: 'function' as const,
										function: {
											name: toolName,
											arguments: JSON.stringify(toolArgs),
										},
									};
									return await requestToolConfirmation(fakeToolCall);
							  }
							: undefined,
						isToolAutoApproved,
						yoloMode,
						addToAlwaysApproved: addToAlwaysApproved
							? (name: string) => addToAlwaysApproved(name)
							: undefined,
						requestUserQuestion: onUserInteractionNeeded
							? async (q: string, opts: string[], multi?: boolean) => {
									const r = await onUserInteractionNeeded(q, opts, multi);
									return {selected: r.selected, customInput: r.customInput};
							  }
							: undefined,
					});

					result = {
						tool_call_id: toolCall.id,
						role: 'tool',
						content: JSON.stringify(teamResult),
					};
				} catch (error: any) {
					result = {
						tool_call_id: toolCall.id,
						role: 'tool',
						content: JSON.stringify({success: false, error: error.message}),
					};
				}
			}
			// Check if this is a sub-agent tool
			else if (toolCall.function.name.startsWith('subagent-')) {
				const agentId = toolCall.function.name.substring('subagent-'.length);
				const subAgentPrompt = (args['prompt'] as string) || '';

				// Look up agent name from config for tracking
				let agentName = agentId;
				try {
					const {getSubAgent} = await import('../config/subAgentConfig.js');
					const agentConfig = getSubAgent(agentId);
					if (agentConfig) {
						agentName = agentConfig.name;
					}
				} catch (error) {
					log.debug(
						'Failed to resolve sub-agent configuration',
						{error, agentId},
					);
					// Fallback to agentId if lookup fails
				}

				// Register this sub-agent as running
				runningSubAgentTracker.register({
					instanceId: toolCall.id,
					agentId,
					agentName,
					prompt: subAgentPrompt,
					startedAt: new Date(),
				});

				// Create a tool confirmation adapter for sub-agent
				const subAgentToolConfirmation = requestToolConfirmation
					? async (toolName: string, toolArgs: any) => {
							// Create a fake tool call for confirmation
							const fakeToolCall: ToolCall = {
								id: 'subagent-tool',
								type: 'function',
								function: {
									name: toolName,
									arguments: JSON.stringify(toolArgs),
								},
							};
							return await requestToolConfirmation(fakeToolCall);
					  }
					: undefined;

				try {
					// Create an abortable wrapper for sub-agent execution
					const subAgentPromise = subAgentService.execute({
						agentId,
						prompt: subAgentPrompt,
						// 透传原始工具参数（agent_session_query / agent_session_continue
						// 等内置会话管理工具需要 args.message / args.instance_id / args.agent_id）
						args,
						instanceId: toolCall.id,
						onMessage: onSubAgentMessage,
						abortSignal,
						requestToolConfirmation: subAgentToolConfirmation
							? async (toolCall: ToolCall) => {
									// Use the adapter to convert to the expected signature
									const args = safeParseToolArguments(
										toolCall.function.arguments,
									);
									return await subAgentToolConfirmation(
										toolCall.function.name,
										args,
									);
							  }
							: undefined,
						isToolAutoApproved,
						yoloMode,
						addToAlwaysApproved,
						requestUserQuestion: onUserInteractionNeeded,
					});

					// Race with abort signal. Keep a const reference so TypeScript
					// preserves narrowing inside the nested Promise callback.
					const activeAbortSignal = abortSignal;
					let subAgentResult: Awaited<typeof subAgentPromise>;
					if (activeAbortSignal) {
						subAgentResult = await Promise.race([
							subAgentPromise,
							new Promise<never>((_, reject) => {
								const onAbort = () =>
									reject(new Error('Sub-agent execution aborted'));
								if (activeAbortSignal.aborted) {
									onAbort();
								} else {
									activeAbortSignal.addEventListener('abort', onAbort, {
										once: true,
									});
								}
							}),
						]);
					} else {
						subAgentResult = await subAgentPromise;
					}

					// Build sub-agent result content.
					// If the user injected messages to this sub-agent during execution,
					// append a summary so the main-flow AI is aware of the user–sub-agent
					// communication and can avoid information gaps.
					let subAgentContent: string;
					if (
						subAgentResult.injectedUserMessages &&
						subAgentResult.injectedUserMessages.length > 0
					) {
						const injectedSummary = subAgentResult.injectedUserMessages
							.map((msg: string, i: number) => `  ${i + 1}. ${msg}`)
							.join('\n');
						subAgentContent = JSON.stringify({
							...subAgentResult,
							_userMessagesNote: `During execution, the user sent ${subAgentResult.injectedUserMessages.length} message(s) directly to this sub-agent:\n${injectedSummary}`,
						});
					} else {
						subAgentContent = JSON.stringify(subAgentResult);
					}

					result = {
						tool_call_id: toolCall.id,
						role: 'tool',
						content: subAgentContent,
					};
				} finally {
					// Always unregister the sub-agent when it completes (success or error)
					runningSubAgentTracker.unregister(toolCall.id);
				}
			} else {
				// Regular tool execution, with optional argument repair on failure.
				let correctionModule: typeof import('./toolCorrection.js') | null =
					null;
				let correctionAllowed = false;
				try {
					correctionModule = await import('./toolCorrection.js');
					correctionAllowed =
						correctionModule.isToolCorrectionEnabledForTool(
							toolCall.function.name,
						) && !abortSignal?.aborted;
				} catch (error) {
					console.warn('Failed to load tool correction module:', error);
				}

				const maxRepairs = correctionModule
					? correctionModule.MAX_TOOL_CORRECTION_ATTEMPTS
					: 0;
				const repairAttempts: Array<{
					argumentsJson: string;
					error: string;
				}> = [];
				let pendingRepairArguments: string | null = null;
				let corrected = false;
				let correctionNoticeActive = false;
				let lastRepairReasoning = '';
				let currentArguments: Record<string, any> = args;
				let toolResult: any = undefined;
				let lastThrownError: unknown = null;

				for (let executionIndex = 0; ; executionIndex += 1) {
					lastThrownError = null;
					try {
						toolResult = await executeMCPTool(
							toolCall.function.name,
							currentArguments,
							abortSignal,
							onTokenUpdate,
						);
					} catch (error) {
						lastThrownError = error;
						toolResult = undefined;
					}

					const failure = lastThrownError
						? {
								failed: true,
								text: `Error: ${
									lastThrownError instanceof Error
										? lastThrownError.message
										: String(lastThrownError)
								}`,
						  }
						: detectToolResultFailure(toolResult);

					if (!failure.failed) {
						break;
					}

					// Record the repaired arguments that just failed before asking
					// the repair model for the next candidate.
					if (pendingRepairArguments) {
						repairAttempts.push({
							argumentsJson: pendingRepairArguments,
							error: failure.text,
						});
						pendingRepairArguments = null;
					}

					if (
						!correctionAllowed ||
						!correctionModule ||
						executionIndex >= maxRepairs ||
						abortSignal?.aborted
					) {
						break;
					}

					const repairAttempt = executionIndex + 1;
					correctionNoticeActive = true;
					correctionModule.emitToolCorrectionStatus({
						phase: 'correcting',
						toolName: toolCall.function.name,
						attempt: repairAttempt,
						maxAttempts: maxRepairs,
					});

					const metadata = await correctionModule.resolveToolMetadata(
						toolCall.function.name,
					);
					const decision = await correctionModule.requestToolCorrection({
						toolName: toolCall.function.name,
						toolDescription: metadata.description,
						inputSchemaJson: metadata.inputSchemaJson,
						originalArgumentsJson: toolCall.function.arguments,
						failure: failure.text,
						attempts: repairAttempts,
						attempt: repairAttempt,
						abortSignal,
					});

					if (!decision || !decision.retry) {
						lastRepairReasoning = decision?.reasoning ?? '';
						if (abortSignal?.aborted) {
							// Per-turn interruption: clear the live notice instead of
							// leaving a spinner behind in the status line.
							correctionModule.emitToolCorrectionStatus(null);
						}
						break;
					}

					let repairedArguments: Record<string, any>;
					try {
						const parsedArguments = JSON.parse(decision.argumentsJson);
						if (
							!parsedArguments ||
							typeof parsedArguments !== 'object' ||
							Array.isArray(parsedArguments)
						) {
							break;
						}
						repairedArguments = parsedArguments;
					} catch {
						break;
					}

					pendingRepairArguments = decision.argumentsJson;
					lastRepairReasoning = decision.reasoning;
					currentArguments = repairedArguments;
					executedArguments = repairedArguments;
					corrected = true;

					correctionModule.emitToolCorrectionStatus({
						phase: 'retrying',
						toolName: toolCall.function.name,
						attempt: repairAttempt,
						maxAttempts: maxRepairs,
						reasoning: decision.reasoning,
					});
				}

				if (lastThrownError) {
					if (corrected && correctionModule) {
						correctionModule.emitToolCorrectionStatus({
							phase: 'exhausted',
							toolName: toolCall.function.name,
							attempt: Math.max(1, repairAttempts.length),
							maxAttempts: maxRepairs,
							reasoning: lastRepairReasoning,
						});
					} else if (correctionModule && correctionNoticeActive) {
						if (abortSignal?.aborted) {
							correctionModule.emitToolCorrectionStatus(null);
						} else {
							correctionModule.emitToolCorrectionStatus({
								phase: 'exhausted',
								toolName: toolCall.function.name,
								attempt: 1,
								maxAttempts: maxRepairs,
								reasoning: lastRepairReasoning,
							});
						}
					}
					throw lastThrownError;
				}

				if (corrected && correctionModule) {
					const finalFailure = detectToolResultFailure(toolResult);
					if (!finalFailure.failed) {
						correctionModule.emitToolCorrectionStatus({
							phase: 'success',
							toolName: toolCall.function.name,
							attempt: Math.max(1, repairAttempts.length + 1),
							maxAttempts: maxRepairs,
							reasoning: lastRepairReasoning,
						});
						toolResult = appendToolResultNote(
							toolResult,
							`[Tool Correction] This result was produced by a corrected retry after the original invocation failed. Correction note: ${
								lastRepairReasoning || 'arguments repaired'
							}\nContinue with this result and do not repeat the original failing call.`,
						);
					} else {
						correctionModule.emitToolCorrectionStatus({
							phase: 'exhausted',
							toolName: toolCall.function.name,
							attempt: Math.max(1, repairAttempts.length),
							maxAttempts: maxRepairs,
							reasoning: lastRepairReasoning,
						});
					}
				}

				if (correctionModule && correctionNoticeActive && !corrected) {
					// The repair request ran but no repaired execution was possible
					// (unrepairable failure, invalid arguments, blocked retry...).
					if (abortSignal?.aborted) {
						correctionModule.emitToolCorrectionStatus(null);
					} else {
						correctionModule.emitToolCorrectionStatus({
							phase: 'exhausted',
							toolName: toolCall.function.name,
							attempt: 1,
							maxAttempts: maxRepairs,
							reasoning: lastRepairReasoning,
						});
					}
				} else if (abortSignal?.aborted && correctionModule) {
					correctionModule.emitToolCorrectionStatus(null);
				}

				// Diff metadata is captured before token truncation inside executeMCPTool
				const {extractFilesystemEditDiffFromRawResult} = await import(
					'../config/toolDisplayConfig.js'
				);
				let editDiffData: Record<string, any> | undefined;
				let contentSource: unknown = toolResult;
				if (
					toolResult &&
					typeof toolResult === 'object' &&
					'editDiffData' in toolResult &&
					(toolResult as {editDiffData?: Record<string, any>}).editDiffData
				) {
					editDiffData = (toolResult as {editDiffData: Record<string, any>})
						.editDiffData;
					if ('__toolResultContent' in toolResult) {
						contentSource = (toolResult as {__toolResultContent: unknown})
							.__toolResultContent;
					}
				} else {
					editDiffData = extractFilesystemEditDiffFromRawResult(
						toolCall.function.name,
						toolResult,
					);
					if (
						editDiffData &&
						!editDiffData['filename'] &&
						typeof currentArguments['filePath'] === 'string'
					) {
						editDiffData['filename'] = currentArguments['filePath'];
					}
				}

				// Extract multimodal content (text + images)
				const {textContent, images} = extractMultimodalContent(contentSource);

				result = {
					tool_call_id: toolCall.id,
					role: 'tool',
					content: textContent,
					images,
					editDiffData,
				};
			}
		} catch (error) {
			executionError =
				error instanceof Error ? error : new Error(String(error));

			// Check if this is a user interaction needed error
			const {UserInteractionNeededError} = await import(
				'../ui/userInteractionError.js'
			);

			if (error instanceof UserInteractionNeededError) {
				// Call the user interaction callback if provided
				if (onUserInteractionNeeded) {
					// Check abort before calling user interaction
					if (abortSignal?.aborted) {
						result = {
							tool_call_id: toolCall.id,
							role: 'tool',
							content: 'Error: User question interaction aborted',
							messageStatus: 'error' as const,
						};
						return result;
					}

					const response = await onUserInteractionNeeded(
						error.question,
						error.options,
						error.multiSelect,
					);

					// Check abort after getting response
					if (abortSignal?.aborted) {
						result = {
							tool_call_id: toolCall.id,
							role: 'tool',
							content: 'Error: User question interaction aborted',
							messageStatus: 'error' as const,
						};
						return result;
					}

					// 检查用户是否取消
					if (response.cancelled) {
						// 用户取消时，返回拒绝结果而不是抛出错误
						// 这样工具记录会保留在 session 中
						result = {
							tool_call_id: toolCall.id,
							role: 'tool',
							content: 'Error: User cancelled the question interaction',
							messageStatus: 'error' as const,
						};
						return result;
					}

					//返回用户的响应作为工具结果
					const answerText = formatAskUserAnswer(
						response.selected,
						response.customInput,
					);

					result = {
						tool_call_id: toolCall.id,
						role: 'tool',
						content: JSON.stringify({
							answer: answerText,
							selected: response.selected,
							customInput: response.customInput,
						}),
					};
				} else {
					// No callback provided, return error
					result = {
						tool_call_id: toolCall.id,
						role: 'tool',
						content: 'Error: User interaction needed but no callback provided',
					};
				}
			} else {
				// Regular error handling
				result = {
					tool_call_id: toolCall.id,
					role: 'tool',
					content: `Error: ${
						error instanceof Error ? error.message : 'Tool execution failed'
					}`,
				};
			}
		} finally {
			// Execute afterToolCall hook
			try {
				const {unifiedHooksExecutor} = await import(
					'../execution/unifiedHooksExecutor.js'
				);
				const {interpretHookResult} = await import(
					'./hookResultInterpreter.js'
				);
				const hookResult = await unifiedHooksExecutor.executeHooks(
					'afterToolCall',
					{
						toolName: toolCall.function.name,
						args:
							executedArguments ??
							safeParseToolArguments(toolCall.function.arguments),
						result,
						error: executionError,
					},
				);
				const interpreted = interpretHookResult('afterToolCall', hookResult);
				if (result) {
					if (interpreted.action === 'replace') {
						result.content = interpreted.replacedContent || result.content;
					} else if (interpreted.action === 'block') {
						result.hookFailed = interpreted.hookFailed;
						result.hookErrorDetails = interpreted.errorDetails;
					}
				}
			} catch (error) {
				console.warn('Failed to execute afterToolCall hook:', error);
			}

			if (result && !executionError && !result.hookFailed) {
				result.content = await maskToolResultContentIfNeeded(
					toolCall.function.name,
					result.content,
					workingDirectory,
					abortSignal,
				);
			}

			const telemetryStatus =
				result?.messageStatus === 'error' || result?.hookFailed
					? 'error'
					: 'success';
			const telemetryAttributes = {
				...telemetry.metricAttributes,
				'snow.tool.status': telemetryStatus,
				...(result?.content
					? {'snow.tool.output.length': result.content.length}
					: {}),
			};
			if (result) {
				recordToolContent(
					telemetry.span,
					'tool.output',
					result.content,
					telemetryAttributes,
				);
			}
			endToolSpan(
				telemetry.span,
				telemetry.startTime,
				telemetryAttributes,
				executionError ??
					(telemetryStatus === 'error'
						? new Error(result?.content || 'Tool execution failed')
						: undefined),
			);
		}

		// Cleanup ESC key listener
		if (escKeyListener) {
			if (process.stdin.isTTY && process.stdin.setRawMode) {
				process.stdin.setRawMode(false);
				process.stdin.off('data', escKeyListener);
			}
		}

		return result!;
	});
}

/**
 * Categorize tools by their resource type for proper execution sequencing
 */
function getToolResourceType(toolName: string): string {
	// Notebook state is shared and should be coordinated
	if (toolName === 'notebook-manage') {
		return 'notebook-state';
	}

	// User interaction prompts must be serialized.
	// Rendering multiple question UIs concurrently can leave the flow waiting forever.
	if (toolName === 'askuser-ask_question') {
		return 'user-interaction';
	}

	// Terminal commands must be sequential to avoid race conditions
	// (e.g., npm install -> npm build, port conflicts, file locks)
	if (toolName === 'terminal-execute') {
		return 'terminal-execution';
	}

	// Each file is a separate resource
	if (
		toolName === 'filesystem-edit' ||
		toolName === 'filesystem-replaceedit' ||
		toolName === 'filesystem-create' ||
		toolName === 'filesystem-copy'
	) {
		return 'filesystem'; // Will be further refined by file path
	}

	// Other tools are independent
	return 'independent';
}

/**
 * Get resource identifier for a tool call
 * Tools modifying the same resource will have the same identifier
 */
function getResourceIdentifier(toolCall: ToolCall): string {
	const toolName = toolCall.function.name;

	// todo-manage / todo-ultra: only get can run in parallel with other work; mutating actions share todo-state
	if (toolName === 'todo-manage' || toolName === 'todo-ultra') {
		try {
			const args = safeParseToolArguments(toolCall.function.arguments);
			if (args?.['action'] === 'get') {
				return `independent:${toolCall.id}`;
			}
		} catch (error) {
			log.debug(
				'Failed to parse todo tool arguments for resource identifier',
				{error, toolCallId: toolCall.id},
			);
			// fall through to serialized todo-state
		}
		return 'todo-state';
	}

	// notebook-manage: read actions can be parallelized, mutating actions share notebook-state
	if (toolName === 'notebook-manage') {
		try {
			const args = safeParseToolArguments(toolCall.function.arguments);
			if (args?.['action'] === 'query' || args?.['action'] === 'list') {
				return `independent:${toolCall.id}`;
			}
		} catch (error) {
			log.debug(
				'Failed to parse notebook tool arguments for resource identifier',
				{error, toolCallId: toolCall.id},
			);
			// fall through to serialized notebook-state
		}
		return 'notebook-state';
	}

	const resourceType = getToolResourceType(toolName);

	if (resourceType === 'notebook-state') {
		return 'notebook-state'; // All Notebook operations share same resource
	}

	if (resourceType === 'user-interaction') {
		return 'user-interaction'; // All user question prompts share one UI interaction lane
	}

	if (resourceType === 'terminal-execution') {
		return 'terminal-execution'; // All terminal commands share same execution context
	}

	if (resourceType === 'filesystem') {
		try {
			const args = JSON.parse(toolCall.function.arguments);
			// Support both single file and array of files
			const filePath = args.filePath;
			if (typeof filePath === 'string') {
				return `filesystem:${filePath}`;
			} else if (Array.isArray(filePath)) {
				// For batch operations, treat as independent (already handling multiple files)
				return `filesystem-batch:${toolCall.id}`;
			}
		} catch (error) {
			log.debug(
				'Failed to parse filesystem tool arguments for resource identifier',
				{error, toolCallId: toolCall.id},
			);
			// Parsing error, treat as independent
		}
	}

	// Each independent tool gets its own unique identifier
	return `independent:${toolCall.id}`;
}

/**
 * Execute multiple tool calls with intelligent sequencing
 * - Tools modifying the same resource execute sequentially
 * - Independent tools execute in parallel
 */
export async function executeToolCalls(
	toolCalls: ToolCall[],
	abortSignal?: AbortSignal,
	onTokenUpdate?: (tokenCount: number) => void,
	onSubAgentMessage?: SubAgentMessageCallback,
	requestToolConfirmation?: ToolConfirmationCallback,
	isToolAutoApproved?: ToolApprovalChecker,
	yoloMode?: boolean,
	addToAlwaysApproved?: AddToAlwaysApprovedCallback,
	onUserInteractionNeeded?: UserInteractionCallback,
	sessionId?: string,
	workingDirectory?: string,
): Promise<ToolResult[]> {
	// Group tool calls by their resource identifier
	const resourceGroups = new Map<string, ToolCall[]>();

	for (const toolCall of toolCalls) {
		const resourceId = getResourceIdentifier(toolCall);
		const group = resourceGroups.get(resourceId) || [];
		group.push(toolCall);
		resourceGroups.set(resourceId, group);
	}

	// Execute each resource group sequentially, but execute different groups in parallel
	const results = await Promise.all(
		Array.from(resourceGroups.values()).map(async group => {
			// Within the same resource group, execute sequentially
			const groupResults: ToolResult[] = [];
			for (const toolCall of group) {
				// Check abort before executing each tool
				if (abortSignal?.aborted) {
					const abortedResult: ToolResult = {
						tool_call_id: toolCall.id,
						role: 'tool',
						content: 'Error: Tool execution aborted by user',
						messageStatus: 'error',
					};
					groupResults.push(abortedResult);
					break;
				}

				const result = await executeToolCall(
					toolCall,
					abortSignal,
					onTokenUpdate,
					onSubAgentMessage,
					requestToolConfirmation,
					isToolAutoApproved,
					yoloMode,
					addToAlwaysApproved,
					onUserInteractionNeeded,
					sessionId,
					workingDirectory,
				);
				groupResults.push(result);

				// If hook failed or aborted, stop executing remaining tools
				if (result.hookFailed || abortSignal?.aborted) {
					break;
				}
			}
			return groupResults;
		}),
	);

	// Flatten results and restore original order
	const flatResults = results.flat();
	const resultMap = new Map(flatResults.map(r => [r.tool_call_id, r]));

	return toolCalls.map(tc => {
		const result = resultMap.get(tc.id);
		if (!result) {
			throw new Error(`Result not found for tool call ${tc.id}`);
		}
		return result;
	});
}
