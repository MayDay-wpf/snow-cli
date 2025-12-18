import {useState, useRef, useCallback, useEffect} from 'react';
import type {ToolCall} from '../../utils/execution/toolExecutor.js';
import type {ConfirmationResult} from '../../ui/components/tools/ToolConfirmation.js';
import {
	loadPermissionsConfig,
	addToolToPermissions,
	addMultipleToolsToPermissions,
	removeToolFromPermissions,
	clearAllPermissions,
} from '../../utils/config/permissionsConfig.js';

export type PendingConfirmation = {
	tool: ToolCall;
	batchToolNames?: string; // Deprecated: kept for backward compatibility
	allTools?: ToolCall[]; // All tools when confirming multiple tools
	resolve: (result: ConfirmationResult) => void;
};

/**
 * Hook for managing tool confirmation state and logic
 * @param workingDirectory - Current working directory for permissions persistence
 */
export function useToolConfirmation(workingDirectory: string) {
	const [pendingToolConfirmation, setPendingToolConfirmation] =
		useState<PendingConfirmation | null>(null);
	// Use ref for always-approved tools to ensure closure functions always see latest state
	const alwaysApprovedToolsRef = useRef<Set<string>>(new Set());
	const [alwaysApprovedTools, setAlwaysApprovedTools] = useState<Set<string>>(
		new Set(),
	);

	// Load persisted permissions on mount
	useEffect(() => {
		const config = loadPermissionsConfig(workingDirectory);
		const loadedTools = new Set(config.alwaysApprovedTools);
		alwaysApprovedToolsRef.current = loadedTools;
		setAlwaysApprovedTools(loadedTools);
	}, [workingDirectory]);

	/**
	 * Request user confirmation for tool execution
	 */
	const requestToolConfirmation = async (
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	): Promise<ConfirmationResult> => {
		return new Promise<ConfirmationResult>(resolve => {
			setPendingToolConfirmation({
				tool: toolCall,
				batchToolNames,
				allTools,
				resolve: (result: ConfirmationResult) => {
					setPendingToolConfirmation(null);
					resolve(result);
				},
			});
		});
	};

	/**
	 * Check if a tool is auto-approved
	 * Uses ref to ensure it always sees the latest approved tools
	 */
	const isToolAutoApproved = useCallback(
		(toolName: string): boolean => {
			return (
				alwaysApprovedToolsRef.current.has(toolName) ||
				toolName.startsWith('todo-') ||
				toolName.startsWith('subagent-') ||
				toolName === 'askuser-ask_question'
			);
		},
		[], // No dependencies - ref is always stable
	);

	/**
	 * Add a tool to the always-approved list
	 */
	const addToAlwaysApproved = useCallback(
		(toolName: string) => {
			// Update ref immediately (for closure functions)
			alwaysApprovedToolsRef.current.add(toolName);
			// Update state (for UI reactivity)
			setAlwaysApprovedTools(prev => new Set([...prev, toolName]));
			// Persist to disk
			addToolToPermissions(workingDirectory, toolName);
		},
		[workingDirectory],
	);

	/**
	 * Add multiple tools to the always-approved list
	 */
	const addMultipleToAlwaysApproved = useCallback(
		(toolNames: string[]) => {
			// Update ref immediately (for closure functions)
			toolNames.forEach(name => alwaysApprovedToolsRef.current.add(name));
			// Update state (for UI reactivity)
			setAlwaysApprovedTools(prev => new Set([...prev, ...toolNames]));
			// Persist to disk
			addMultipleToolsToPermissions(workingDirectory, toolNames);
		},
		[workingDirectory],
	);

	/**
	 * Remove a tool from the always-approved list
	 */
	const removeFromAlwaysApproved = useCallback(
		(toolName: string) => {
			// Update ref immediately (for closure functions)
			alwaysApprovedToolsRef.current.delete(toolName);
			// Update state (for UI reactivity)
			setAlwaysApprovedTools(prev => {
				const next = new Set(prev);
				next.delete(toolName);
				return next;
			});
			// Persist to disk
			removeToolFromPermissions(workingDirectory, toolName);
		},
		[workingDirectory],
	);

	/**
	 * Clear all always-approved tools
	 */
	const clearAllAlwaysApproved = useCallback(() => {
		// Update ref immediately (for closure functions)
		alwaysApprovedToolsRef.current.clear();
		// Update state (for UI reactivity)
		setAlwaysApprovedTools(new Set());
		// Persist to disk
		clearAllPermissions(workingDirectory);
	}, [workingDirectory]);

	return {
		pendingToolConfirmation,
		alwaysApprovedTools,
		requestToolConfirmation,
		isToolAutoApproved,
		addToAlwaysApproved,
		addMultipleToAlwaysApproved,
		removeFromAlwaysApproved,
		clearAllAlwaysApproved,
	};
}
