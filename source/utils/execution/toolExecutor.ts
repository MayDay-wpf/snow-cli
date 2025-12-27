import {
	executeMCPTool,
	getRegisteredServicePrefixes,
} from './mcpToolsManager.js';
import {subAgentService} from '../../mcp/subagent.js';
import type {SubAgentMessage} from './subAgentExecutor.js';
import type {ConfirmationResult} from '../../ui/components/tools/ToolConfirmation.js';
import type {ImageContent} from '../../api/types.js';
import type {MultimodalContent} from '../../mcp/types/filesystem.types.js';

/**
 * 检测并修复被错误合并的工具名称
 * 例如: "ace-semantic_searchdesktop-commander-start_search" 应该被分割为两个工具
 * 返回第一个有效的工具名称，如果无法修复则返回原始名称
 */
function fixMergedToolName(toolName: string): {
	fixedName: string;
	wasMerged: boolean;
	originalName: string;
} {
	// 动态获取已注册的服务前缀
	const knownPrefixes = getRegisteredServicePrefixes();

	// 检查是否包含多个已知前缀（表示被错误合并）
	let foundPrefixes: {prefix: string; index: number}[] = [];

	for (const prefix of knownPrefixes) {
		let searchIndex = 0;
		while (true) {
			const index = toolName.indexOf(prefix, searchIndex);
			if (index === -1) break;
			foundPrefixes.push({prefix, index});
			searchIndex = index + 1;
		}
	}

	// 按位置排序
	foundPrefixes.sort((a, b) => a.index - b.index);

	// 如果找到多个前缀，说明工具名称被错误合并
	if (foundPrefixes.length > 1) {
		// 提取第一个工具名称（从第一个前缀到第二个前缀之前）
		const firstPrefix = foundPrefixes[0];
		const secondPrefix = foundPrefixes[1];

		if (firstPrefix && secondPrefix && firstPrefix.index === 0) {
			const firstToolName = toolName.substring(0, secondPrefix.index);
			console.warn(`[Tool Name Fix] Detected merged tool names: "${toolName}"`);
			console.warn(`[Tool Name Fix] Extracted first tool: "${firstToolName}"`);
			console.warn(
				`[Tool Name Fix] Ignored second tool starting at: "${toolName.substring(
					secondPrefix.index,
				)}"`,
			);

			return {
				fixedName: firstToolName,
				wasMerged: true,
				originalName: toolName,
			};
		}
	}

	return {
		fixedName: toolName,
		wasMerged: false,
		originalName: toolName,
	};
}

//安全解析JSON，处理可能被拼接的多个JSON对象
function safeParseToolArguments(argsString: string): Record<string, any> {
	if (!argsString || argsString.trim() === '') {
		return {};
	}

	try {
		return JSON.parse(argsString);
	} catch (error) {
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
						} catch {
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
 * Check if a value is a multimodal content array
 */
function isMultimodalContent(value: any): value is MultimodalContent {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every(
			(item: any) =>
				item &&
				typeof item === 'object' &&
				(item.type === 'text' || item.type === 'image'),
		)
	);
}

/**
 * Extract images and text content from a result that may be multimodal
 */
function extractMultimodalContent(result: any): {
	textContent: string;
	images?: ImageContent[];
} {
	// Check if result has multimodal content array
	let contentToCheck = result;

	// Handle wrapped results (e.g., {content: [...], files: [...], totalFiles: n})
	if (result && typeof result === 'object' && result.content) {
		contentToCheck = result.content;
	}

	if (isMultimodalContent(contentToCheck)) {
		const textParts: string[] = [];
		const images: ImageContent[] = [];

		for (const item of contentToCheck) {
			if (item.type === 'text') {
				textParts.push(item.text);
			} else if (item.type === 'image') {
				images.push({
					type: 'image',
					data: item.data,
					mimeType: item.mimeType,
				});
			}
		}

		// If we extracted the content, we need to rebuild the result
		if (
			result &&
			typeof result === 'object' &&
			result.content === contentToCheck
		) {
			// Check if result has only 'content' field (pure MCP response)
			// In this case, return the extracted text directly without wrapping
			const resultKeys = Object.keys(result);
			if (resultKeys.length === 1 && resultKeys[0] === 'content') {
				// Pure MCP response - return extracted text directly
				return {
					textContent: textParts.join('\n\n'),
					images: images.length > 0 ? images : undefined,
				};
			}

			// Result has additional fields (e.g., files, totalFiles) - preserve them
			const newResult = {...result, content: textParts.join('\n\n')};
			return {
				textContent: JSON.stringify(newResult),
				images: images.length > 0 ? images : undefined,
			};
		}

		return {
			textContent: textParts.join('\n\n'),
			images: images.length > 0 ? images : undefined,
		};
	}

	// Not multimodal, return as JSON string
	return {
		textContent: JSON.stringify(result),
	};
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
): Promise<ToolResult> {
	// 检测并修复被错误合并的工具名称
	const toolNameFix = fixMergedToolName(toolCall.function.name);
	if (toolNameFix.wasMerged) {
		// 修复工具调用对象中的名称
		toolCall = {
			...toolCall,
			function: {
				...toolCall.function,
				name: toolNameFix.fixedName,
			},
		};
	}

	let result: ToolResult | undefined;
	let executionError: Error | null = null;

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

	try {
		const args = safeParseToolArguments(toolCall.function.arguments);

		// Execute beforeToolCall hook
		try {
			const {unifiedHooksExecutor} = await import(
				'../execution/unifiedHooksExecutor.js'
			);
			const hookResult = await unifiedHooksExecutor.executeHooks(
				'beforeToolCall',
				{
					toolName: toolCall.function.name,
					args,
				},
			);
			// Handle hook exit codes: 0=continue, 1=continue, 2+=set hookFailed and return
			if (hookResult && !hookResult.success) {
				// Find failed command hook
				const commandError = hookResult.results.find(
					(r: any) => r.type === 'command' && !r.success,
				);

				if (commandError && commandError.type === 'command') {
					const {exitCode, command, output, error} = commandError;

					// Exit code 2+: Set hookFailed flag and return result immediately
					if (exitCode >= 2 || exitCode < 0) {
						return {
							tool_call_id: toolCall.id,
							role: 'tool',
							content: '', // Content will be rendered by HookErrorDisplay component
							hookFailed: true,
							hookErrorDetails: {
								type: 'error',
								exitCode,
								command,
								output,
								error,
							},
						};
					}
					// Exit code 1: Warning, continue execution (logged but not thrown)
					// Exit code 0: Success, continue
				}
			}
		} catch (error) {
			// Log unexpected errors and continue - don't block on unexpected errors
			console.warn('Failed to execute beforeToolCall hook:', error);
		}

		// Check if this is a sub-agent tool
		if (toolCall.function.name.startsWith('subagent-')) {
			const agentId = toolCall.function.name.substring('subagent-'.length);

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

			const subAgentResult = await subAgentService.execute({
				agentId,
				prompt: args['prompt'] as string,
				onMessage: onSubAgentMessage,
				abortSignal,
				requestToolConfirmation: subAgentToolConfirmation
					? async (toolCall: ToolCall) => {
							// Use the adapter to convert to the expected signature
							const args = safeParseToolArguments(toolCall.function.arguments);
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

			result = {
				tool_call_id: toolCall.id,
				role: 'tool',
				content: JSON.stringify(subAgentResult),
			};
		} else {
			// Regular tool execution
			const toolResult = await executeMCPTool(
				toolCall.function.name,
				args,
				abortSignal,
				onTokenUpdate,
			);

			// Extract multimodal content (text + images)
			const {textContent, images} = extractMultimodalContent(toolResult);

			result = {
				tool_call_id: toolCall.id,
				role: 'tool',
				content: textContent,
				images,
			};
		}
	} catch (error) {
		executionError = error instanceof Error ? error : new Error(String(error));

		// Check if this is a user interaction needed error
		const {UserInteractionNeededError} = await import(
			'../ui/userInteractionError.js'
		);

		if (error instanceof UserInteractionNeededError) {
			// Call the user interaction callback if provided
			if (onUserInteractionNeeded) {
				const response = await onUserInteractionNeeded(
					error.question,
					error.options,
					error.multiSelect,
				);

				// 检查用户是否取消
				if (response.cancelled) {
					// 抛出错误以触发中断流程
					throw new Error('User cancelled the interaction');
				}

				//返回用户的响应作为工具结果
				const answerText = response.customInput
					? `${
							Array.isArray(response.selected)
								? response.selected.join(', ')
								: response.selected
					  }: ${response.customInput}`
					: Array.isArray(response.selected)
					? response.selected.join(', ')
					: response.selected;

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
			const hookResult = await unifiedHooksExecutor.executeHooks(
				'afterToolCall',
				{
					toolName: toolCall.function.name,
					args: safeParseToolArguments(toolCall.function.arguments),
					result,
					error: executionError,
				},
			);

			// Handle hook result based on exit code strategy
			if (hookResult && !hookResult.success) {
				// Find failed command hook
				const commandError = hookResult.results.find(
					(r: any) => r.type === 'command' && !r.success,
				);

				if (commandError && commandError.type === 'command') {
					const {exitCode, command, output, error} = commandError;

					if (exitCode === 1) {
						// Exit code 1: Warning - append to tool result
						const combinedOutput =
							[output, error].filter(Boolean).join('\n\n') || '(no output)';
						const warningMessage = `\n\n[afterToolCall Hook Warning]\nCommand: ${command}\nOutput:\n${combinedOutput}`;

						// Append warning to result content
						if (result && typeof result.content === 'string') {
							result.content = result.content + warningMessage;
						}
					} else if (exitCode >= 2 || exitCode < 0) {
						// Exit code 2+: Set hookFailed flag on result
						// Set error details for UI rendering (HookErrorDisplay component)
						if (result && typeof result.content === 'string') {
							result.hookFailed = true;
							result.hookErrorDetails = {
								type: 'error',
								exitCode,
								command,
								output,
								error,
							};
						}
					}
				}
			}
		} catch (error) {
			// Log unexpected errors but continue - don't block tool execution
			console.warn('Failed to execute afterToolCall hook:', error);
		}
	}

	// Cleanup ESC key listener
	if (escKeyListener) {
		if (process.stdin.isTTY && process.stdin.setRawMode) {
			process.stdin.setRawMode(false);
			process.stdin.off('data', escKeyListener);
		}
	}

	return result!;
}

/**
 * Categorize tools by their resource type for proper execution sequencing
 */
function getToolResourceType(toolName: string): string {
	// TODO tools all modify the same TODO file - must be sequential
	if (
		toolName === 'todo-update' ||
		toolName === 'todo-add' ||
		toolName === 'todo-delete'
	) {
		return 'todo-state';
	}

	// Terminal commands must be sequential to avoid race conditions
	// (e.g., npm install -> npm build, port conflicts, file locks)
	if (toolName === 'terminal-execute') {
		return 'terminal-execution';
	}

	// Each file is a separate resource
	if (
		toolName === 'filesystem-edit' ||
		toolName === 'filesystem-edit_search' ||
		toolName === 'filesystem-create'
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
	const resourceType = getToolResourceType(toolName);

	if (resourceType === 'todo-state') {
		return 'todo-state'; // All TODO operations share same resource
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
		} catch {
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
				);
				groupResults.push(result);

				// If hook failed, stop executing remaining tools
				if (result.hookFailed) {
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
