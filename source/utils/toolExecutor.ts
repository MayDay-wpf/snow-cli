import {executeMCPTool} from './mcpToolsManager.js';
import {subAgentService} from '../mcp/subagent.js';
import type {SubAgentMessage} from './subAgentExecutor.js';
import type {ConfirmationResult} from '../ui/components/ToolConfirmation.js';
import type {ImageContent} from '../api/types.js';
import type {MultimodalContent} from '../mcp/types/filesystem.types.js';

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
	(question: string, options: string[]): Promise<{
		selected: string;
		customInput?: string;
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
	try {
		const args = JSON.parse(toolCall.function.arguments);

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

			const result = await subAgentService.execute({
				agentId,
				prompt: args.prompt,
				onMessage: onSubAgentMessage,
				abortSignal,
				requestToolConfirmation: subAgentToolConfirmation
					? async (toolCall: ToolCall) => {
							// Use the adapter to convert to the expected signature
							const args = JSON.parse(toolCall.function.arguments);
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

			return {
				tool_call_id: toolCall.id,
				role: 'tool',
				content: JSON.stringify(result),
			};
		}

		// Regular tool execution
		const result = await executeMCPTool(
			toolCall.function.name,
			args,
			abortSignal,
			onTokenUpdate,
		);

		// Extract multimodal content (text + images)
		const {textContent, images} = extractMultimodalContent(result);

		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: textContent,
			images,
		};
	} catch (error) {
		// Check if this is a user interaction needed error
		const {UserInteractionNeededError} = await import(
			'./userInteractionError.js'
		);

		if (error instanceof UserInteractionNeededError) {
			// Call the user interaction callback if provided
			if (onUserInteractionNeeded) {
				const response = await onUserInteractionNeeded(
					error.question,
					error.options,
				);

				// Return the user's response as the tool result
				const resultContent = response.customInput
					? `User response: ${response.customInput}`
					: `User selected: ${response.selected}`;

				return {
					tool_call_id: toolCall.id,
					role: 'tool',
					content: resultContent,
				};
			} else {
				// No callback provided, return error
				return {
					tool_call_id: toolCall.id,
					role: 'tool',
					content: 'Error: User interaction needed but no callback provided',
				};
			}
		}

		// Regular error handling
		return {
			tool_call_id: toolCall.id,
			role: 'tool',
			content: `Error: ${
				error instanceof Error ? error.message : 'Tool execution failed'
			}`,
		};
	}
}

/**
 * Categorize tools by their resource type for proper execution sequencing
 */
function getToolResourceType(toolName: string): string {
	// TODO tools all modify the same TODO file - must be sequential
	if (
		toolName === 'todo-create' ||
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
