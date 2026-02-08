import {useState, useCallback, useEffect, useSyncExternalStore} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {
	runningSubAgentTracker,
	type RunningSubAgent,
} from '../../utils/execution/runningSubAgentTracker.js';

// Stable function references for useSyncExternalStore (must not change between renders)
const subscribeToTracker = (onStoreChange: () => void) =>
	runningSubAgentTracker.subscribe(onStoreChange);
const getTrackerSnapshot = () => runningSubAgentTracker.getRunningAgents();

/**
 * Build a short visual tag for a selected running agent.
 * Uses "»" (U+00BB) instead of ">>" to avoid re-triggering the picker.
 * Includes a truncated prompt snippet to distinguish parallel agents of the same type.
 *
 * Example: [»Explore Agent: 调查项目架构和结构...]
 */
function buildVisualTag(agent: RunningSubAgent): string {
	// Always include a short instanceId suffix to guarantee uniqueness.
	// TextBuffer.getFullText() uses split(tag).join(content) which is a global replace,
	// so identical tags would cause only one placeholder's content to be applied.
	const shortId = agent.instanceId.slice(-4);
	const promptSnippet = agent.prompt
		.replace(/[\r\n]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (promptSnippet) {
		const maxPromptLen = 20;
		const truncated =
			promptSnippet.length > maxPromptLen
				? promptSnippet.slice(0, maxPromptLen) + '…'
				: promptSnippet;
		return `[»${agent.agentName}#${shortId}: ${truncated}] `;
	}

	return `[»${agent.agentName}#${shortId}] `;
}

/**
 * Find a ">>" trigger that starts at the very beginning of the input (ignoring leading whitespace).
 * Only triggers when ">>" is at the start — typing ">>" in the middle of text does nothing.
 * Also skips ">>" inside [...] brackets (placeholder tags).
 * Returns the position of the first ">" in the ">>" pair, or -1 if not found.
 */
function findDoubleGreaterTrigger(beforeCursor: string): number {
	// >> must be at the very start of the display text (optionally preceded by whitespace only)
	// This prevents accidental triggers when typing >> in the middle of a sentence.
	const trimmedStart = beforeCursor.search(/\S/);
	if (trimmedStart === -1) {
		// All whitespace or empty — no trigger
		return -1;
	}

	// Check if the first non-whitespace characters are ">>"
	if (
		beforeCursor[trimmedStart] === '>' &&
		trimmedStart + 1 < beforeCursor.length &&
		beforeCursor[trimmedStart + 1] === '>'
	) {
		// Verify it's not inside brackets (e.g. from a placeholder tag)
		let bracketDepth = 0;
		for (let i = 0; i <= trimmedStart; i++) {
			if (beforeCursor[i] === '[') {
				bracketDepth++;
			} else if (beforeCursor[i] === ']') {
				bracketDepth = Math.max(0, bracketDepth - 1);
			}
		}

		if (bracketDepth === 0) {
			return trimmedStart;
		}
	}

	return -1;
}

/**
 * Hook to manage the running agents picker panel.
 * Triggered by ">>" in input, shows currently running sub-agents
 * with multi-select support for directing messages to specific agents.
 */
export function useRunningAgentsPicker(
	buffer: TextBuffer,
	triggerUpdate: () => void,
) {
	const [showRunningAgentsPicker, setShowRunningAgentsPicker] = useState(false);
	const [runningAgentsSelectedIndex, setRunningAgentsSelectedIndex] =
		useState(0);
	const [selectedRunningAgents, setSelectedRunningAgents] = useState<
		Set<string>
	>(new Set());
	const [doubleGreaterPosition, setDoubleGreaterPosition] = useState(-1);

	// Subscribe to the running sub-agent tracker for real-time updates.
	// getTrackerSnapshot returns a cached array that only changes on mutation,
	// satisfying useSyncExternalStore's referential stability requirement.
	const runningAgents = useSyncExternalStore(
		subscribeToTracker,
		getTrackerSnapshot,
	);

	// Reset selected index when agents list changes
	useEffect(() => {
		if (showRunningAgentsPicker) {
			// Clamp selected index to valid range
			if (runningAgentsSelectedIndex >= runningAgents.length) {
				setRunningAgentsSelectedIndex(Math.max(0, runningAgents.length - 1));
			}

			// Reset selection if the selected agents are no longer running
			setSelectedRunningAgents(prev => {
				const runningIds = new Set(runningAgents.map(a => a.instanceId));
				const filtered = new Set(
					Array.from(prev).filter(id => runningIds.has(id)),
				);
				if (filtered.size !== prev.size) {
					return filtered;
				}
				return prev;
			});
		}
	}, [runningAgents, showRunningAgentsPicker, runningAgentsSelectedIndex]);

	// Update running agents picker state based on >> pattern.
	// >> must appear at the very start of the input (leading whitespace OK) to trigger the panel.
	// When the user deletes >> (e.g. via backspace), the panel auto-closes.
	const updateRunningAgentsPickerState = useCallback(
		(_text: string, _cursorPos: number) => {
			const displayText = buffer.text;

			// Check the full display text for >> at the beginning
			const position = findDoubleGreaterTrigger(displayText);

			if (position !== -1) {
				// Found valid >> at start of input
				if (
					!showRunningAgentsPicker ||
					doubleGreaterPosition !== position
				) {
					setShowRunningAgentsPicker(true);
					setDoubleGreaterPosition(position);
					setRunningAgentsSelectedIndex(0);
					setSelectedRunningAgents(new Set());
				}
			} else {
				// No >> at start — hide picker
				if (showRunningAgentsPicker) {
					setShowRunningAgentsPicker(false);
					setDoubleGreaterPosition(-1);
					setSelectedRunningAgents(new Set());
				}
			}
		},
		[buffer, showRunningAgentsPicker, doubleGreaterPosition],
	);

	// Toggle selection of current agent
	const toggleRunningAgentSelection = useCallback(() => {
		if (
			runningAgents.length > 0 &&
			runningAgentsSelectedIndex < runningAgents.length
		) {
			const agent = runningAgents[runningAgentsSelectedIndex];
			if (agent) {
				setSelectedRunningAgents(prev => {
					const newSet = new Set(prev);
					if (newSet.has(agent.instanceId)) {
						newSet.delete(agent.instanceId);
					} else {
						newSet.add(agent.instanceId);
					}
					return newSet;
				});
				triggerUpdate();
			}
		}
	}, [runningAgents, runningAgentsSelectedIndex, triggerUpdate]);

	// Confirm selection - remove >> from buffer, insert visual tags, return selected agents.
	// Each selected agent is inserted as a TextPlaceholder:
	//   Visual: [»AgentName: promptSnippet]  (shown in input box, no ">>" to avoid re-trigger)
	//   Content: # SubAgentTarget:instanceId:agentName\n  (embedded in getFullText())
	// The pending message system can later parse "# SubAgentTarget:" markers to route messages.
	//
	// If no agents have been explicitly toggled via Space, the currently highlighted
	// agent is auto-selected so the user can pick with a single Enter press.
	const confirmRunningAgentsSelection = useCallback((): RunningSubAgent[] => {
		let effectiveSelection = selectedRunningAgents;

		// Auto-select the highlighted item when nothing was explicitly toggled
		if (
			effectiveSelection.size === 0 &&
			runningAgents.length > 0 &&
			runningAgentsSelectedIndex < runningAgents.length
		) {
			const highlighted = runningAgents[runningAgentsSelectedIndex];
			if (highlighted) {
				effectiveSelection = new Set([highlighted.instanceId]);
			}
		}

		const selected = runningAgents.filter(agent =>
			effectiveSelection.has(agent.instanceId),
		);

		if (doubleGreaterPosition !== -1) {
			const displayText = buffer.text;
			const beforeGt = displayText.slice(0, doubleGreaterPosition);
			const afterGt = displayText
				.slice(doubleGreaterPosition + 2)
				.trimStart(); // Remove ">>" and leading whitespace

			// Replace >> with the remaining text.
			// setText(nonEmpty) preserves existing placeholders (Skills, etc.).
			// setText('') clears placeholderStorage, which is fine when buffer was only ">>".
			buffer.setText(beforeGt + afterGt);

			if (selected.length > 0) {
				// Position cursor at where >> was, then insert agent tags there.
				// insertTextPlaceholder inserts at cursor and advances it,
				// so multiple tags are inserted in order.
				buffer.setCursorPosition(beforeGt.length);

				for (const agent of selected) {
					const markerContent = `# SubAgentTarget:${agent.instanceId}:${agent.agentName}\n`;
					const visualTag = buildVisualTag(agent);
					buffer.insertTextPlaceholder(markerContent, visualTag);
				}
			}
		}

		// Reset state
		setShowRunningAgentsPicker(false);
		setRunningAgentsSelectedIndex(0);
		setSelectedRunningAgents(new Set());
		setDoubleGreaterPosition(-1);
		triggerUpdate();

		return selected;
	}, [
		buffer,
		runningAgents,
		runningAgentsSelectedIndex,
		selectedRunningAgents,
		doubleGreaterPosition,
		triggerUpdate,
	]);

	// Close the picker without confirming
	const closeRunningAgentsPicker = useCallback(() => {
		setShowRunningAgentsPicker(false);
		setRunningAgentsSelectedIndex(0);
		setSelectedRunningAgents(new Set());
		setDoubleGreaterPosition(-1);
	}, []);

	return {
		showRunningAgentsPicker,
		setShowRunningAgentsPicker,
		runningAgentsSelectedIndex,
		setRunningAgentsSelectedIndex,
		runningAgents,
		selectedRunningAgents,
		toggleRunningAgentSelection,
		confirmRunningAgentsSelection,
		closeRunningAgentsPicker,
		updateRunningAgentsPickerState,
	};
}
