import { useState } from 'react';
import type { ToolCall } from '../utils/toolExecutor.js';
import type { ConfirmationResult } from '../ui/components/ToolConfirmation.js';

export type PendingConfirmation = {
	tool: ToolCall;
	batchToolNames?: string;
	resolve: (result: ConfirmationResult) => void;
};

/**
 * Hook for managing tool confirmation state and logic
 */
export function useToolConfirmation() {
	const [pendingToolConfirmation, setPendingToolConfirmation] = useState<PendingConfirmation | null>(null);
	const [alwaysApprovedTools, setAlwaysApprovedTools] = useState<Set<string>>(new Set());

	/**
	 * Request user confirmation for tool execution
	 */
	const requestToolConfirmation = async (
		toolCall: ToolCall,
		batchToolNames?: string
	): Promise<ConfirmationResult> => {
		return new Promise<ConfirmationResult>((resolve) => {
			setPendingToolConfirmation({
				tool: toolCall,
				batchToolNames,
				resolve: (result: ConfirmationResult) => {
					setPendingToolConfirmation(null);
					resolve(result);
				}
			});
		});
	};

	/**
	 * Check if a tool is auto-approved
	 */
	const isToolAutoApproved = (toolName: string): boolean => {
		return alwaysApprovedTools.has(toolName) || toolName.startsWith('todo-');
	};

	/**
	 * Add a tool to the always-approved list
	 */
	const addToAlwaysApproved = (toolName: string) => {
		setAlwaysApprovedTools(prev => new Set([...prev, toolName]));
	};

	/**
	 * Add multiple tools to the always-approved list
	 */
	const addMultipleToAlwaysApproved = (toolNames: string[]) => {
		setAlwaysApprovedTools(prev => new Set([...prev, ...toolNames]));
	};

	return {
		pendingToolConfirmation,
		alwaysApprovedTools,
		requestToolConfirmation,
		isToolAutoApproved,
		addToAlwaysApproved,
		addMultipleToAlwaysApproved
	};
}
