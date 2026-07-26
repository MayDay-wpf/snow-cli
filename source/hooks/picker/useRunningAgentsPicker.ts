import {
	useState,
	useCallback,
	useEffect,
	useSyncExternalStore,
	useMemo,
	useRef,
} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {runningSubAgentTracker} from '../../utils/execution/runningSubAgentTracker.js';
import {teamTracker} from '../../utils/execution/teamTracker.js';
import {
	subscribeSubAgentRuns,
	getSubAgentRunSnapshot,
	getSubAgentRun,
	type SubAgentRunRecord,
} from '../conversation/core/subAgentRunStore.js';

// Stable function references for useSyncExternalStore (must not change between renders)
const subscribeToTracker = (onStoreChange: () => void) =>
	runningSubAgentTracker.subscribe(onStoreChange);
const getTrackerSnapshot = () => runningSubAgentTracker.getRunningAgents();

const subscribeToTeamTracker = (onStoreChange: () => void) =>
	teamTracker.subscribe(onStoreChange);
const getTeamTrackerSnapshot = () => teamTracker.getRunningTeammates();

const subscribeToRunHistory = (onStoreChange: () => void) =>
	subscribeSubAgentRuns(onStoreChange);
const getRunHistorySnapshot = () => getSubAgentRunSnapshot();

/**
 * Unified entry in the running-agents picker.
 * Can represent either a sub-agent or a team teammate, or a recent history run.
 */
export interface PickerAgent {
	instanceId: string;
	agentId: string;
	agentName: string;
	prompt: string;
	startedAt: Date;
	/** 'subagent' for normal sub-agents, 'teammate' for team mode teammates */
	sourceType: 'subagent' | 'teammate';
	/** true when this row comes from completed history, not currently running */
	isHistory?: boolean;
	historyStatus?: 'running' | 'completed' | 'error';
	durationMs?: number;
	tokenCount?: number;
	historyLines?: string[];
	finalSummary?: string;
}

/**
 * Build a short visual tag for a selected running agent.
 * Uses "»" (U+00BB) instead of ">>" to avoid re-triggering the picker.
 * Includes a truncated prompt snippet to distinguish parallel agents of the same type.
 *
 * Example: [»Explore Agent: 调查项目架构和结构...]
 */
function buildVisualTag(agent: PickerAgent): string {
	const shortId = agent.instanceId.slice(-4);
	const promptSnippet = agent.prompt
		.replace(/[\r\n]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	const prefix = agent.sourceType === 'teammate' ? '»☆' : '»';

	if (promptSnippet) {
		const maxPromptLen = 20;
		const truncated =
			promptSnippet.length > maxPromptLen
				? promptSnippet.slice(0, maxPromptLen) + '…'
				: promptSnippet;
		return `[${prefix}${agent.agentName}#${shortId}: ${truncated}] `;
	}

	return `[${prefix}${agent.agentName}#${shortId}] `;
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
 * Triggered by ">>" in input, shows currently running sub-agents and team teammates
 * with multi-select support for directing messages to specific agents.
 */
export type SubAgentDetailFocus = 'timeline' | 'input';

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

	// Sub-agent detail TUI (entered from >> picker via Enter/v)
	const [showSubAgentDetail, setShowSubAgentDetail] = useState(false);
	const [detailAgentInstanceId, setDetailAgentInstanceId] = useState<
		string | null
	>(null);
	const [detailFocus, setDetailFocus] =
		useState<SubAgentDetailFocus>('timeline');
	const [detailInputValue, setDetailInputValue] = useState('');
	const [detailTimelineOffset, setDetailTimelineOffset] = useState(0);
	const [detailSendFeedback, setDetailSendFeedback] = useState<string | null>(
		null,
	);

	const subAgents = useSyncExternalStore(
		subscribeToTracker,
		getTrackerSnapshot,
	);

	const teammates = useSyncExternalStore(
		subscribeToTeamTracker,
		getTeamTrackerSnapshot,
	);

	const runHistory = useSyncExternalStore(
		subscribeToRunHistory,
		getRunHistorySnapshot,
	);

	const detailAgentSnapshotRef = useRef<PickerAgent | null>(null);

	const runningAgents: PickerAgent[] = useMemo(() => {
		const agents: PickerAgent[] = subAgents.map(a => ({
			...a,
			sourceType: 'subagent' as const,
			isHistory: false,
		}));
		for (const t of teammates) {
			agents.push({
				instanceId: t.instanceId,
				agentId: `teammate-${t.memberId}`,
				agentName: t.memberName,
				prompt: t.prompt,
				startedAt: t.startedAt,
				sourceType: 'teammate' as const,
				isHistory: false,
			});
		}
		return agents;
	}, [subAgents, teammates]);

	const pickerAgents: PickerAgent[] = useMemo(() => {
		const runningIds = new Set(runningAgents.map(a => a.instanceId));
		const historyAgents: PickerAgent[] = runHistory
			.filter(r => !runningIds.has(r.instanceId))
			.slice(0, 12)
			.map((r: SubAgentRunRecord) => ({
				instanceId: r.instanceId,
				agentId: r.agentId,
				agentName: r.agentName,
				prompt: r.prompt,
				startedAt: new Date(r.startedAt),
				sourceType: r.sourceType,
				isHistory: true,
				historyStatus: r.status,
				durationMs: r.durationMs,
				tokenCount: r.tokenCount,
				historyLines: r.historyLines,
				finalSummary: r.finalSummary,
			}));
		return [...runningAgents, ...historyAgents];
	}, [runningAgents, runHistory]);

	// Reset selected index when agents list changes
	useEffect(() => {
		if (showRunningAgentsPicker) {
			// Clamp selected index to valid range
			if (runningAgentsSelectedIndex >= pickerAgents.length) {
				setRunningAgentsSelectedIndex(Math.max(0, pickerAgents.length - 1));
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
	}, [
		pickerAgents.length,
		runningAgents,
		showRunningAgentsPicker,
		runningAgentsSelectedIndex,
	]);

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
				if (!showRunningAgentsPicker || doubleGreaterPosition !== position) {
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
			pickerAgents.length > 0 &&
			runningAgentsSelectedIndex < pickerAgents.length
		) {
			const agent = pickerAgents[runningAgentsSelectedIndex];
			if (agent && !agent.isHistory) {
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
	}, [pickerAgents, runningAgentsSelectedIndex, triggerUpdate]);

	// Confirm selection - remove >> from buffer, insert visual tags, return selected agents.
	// Each selected agent is inserted as a TextPlaceholder:
	//   Visual: [»AgentName: promptSnippet]  (shown in input box, no ">>" to avoid re-trigger)
	//   Content: # SubAgentTarget:instanceId:agentName\n  or  # TeamTarget:instanceId:agentName\n
	// The pending message system can later parse these markers to route messages.
	//
	// If no agents have been explicitly toggled via Space, the currently highlighted
	// agent is auto-selected so the user can pick with a single Enter press.
	const confirmRunningAgentsSelection = useCallback((): PickerAgent[] => {
		let effectiveSelection = selectedRunningAgents;

		// Auto-select the highlighted running item when nothing was explicitly toggled.
		// History rows are view-only and must never become message targets.
		if (effectiveSelection.size === 0 && pickerAgents.length > 0) {
			const highlighted = pickerAgents[runningAgentsSelectedIndex];
			if (highlighted && !highlighted.isHistory) {
				effectiveSelection = new Set([highlighted.instanceId]);
			}
		}

		const selected = runningAgents.filter(agent =>
			effectiveSelection.has(agent.instanceId),
		);

		if (doubleGreaterPosition !== -1) {
			const displayText = buffer.text;
			const beforeGt = displayText.slice(0, doubleGreaterPosition);
			const afterGt = displayText.slice(doubleGreaterPosition + 2).trimStart();

			buffer.setText(beforeGt + afterGt);

			if (selected.length > 0) {
				buffer.setCursorPosition(beforeGt.length);

				for (const agent of selected) {
					const markerPrefix =
						agent.sourceType === 'teammate' ? 'TeamTarget' : 'SubAgentTarget';
					const markerContent = `# ${markerPrefix}:${agent.instanceId}:${agent.agentName}\n`;
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
		pickerAgents,
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

	const detailAgent = useMemo(() => {
		if (!detailAgentInstanceId) return null;

		const fromRunning =
			runningAgents.find(a => a.instanceId === detailAgentInstanceId) ?? null;
		if (fromRunning) {
			detailAgentSnapshotRef.current = fromRunning;
			return fromRunning;
		}

		const fromPicker =
			pickerAgents.find(a => a.instanceId === detailAgentInstanceId) ?? null;
		if (fromPicker) {
			detailAgentSnapshotRef.current = fromPicker;
			return fromPicker;
		}

		const record = getSubAgentRun(detailAgentInstanceId);
		if (record) {
			const fromHistory: PickerAgent = {
				instanceId: record.instanceId,
				agentId: record.agentId,
				agentName: record.agentName,
				prompt: record.prompt,
				startedAt: new Date(record.startedAt),
				sourceType: record.sourceType,
				isHistory: true,
				historyStatus: record.status,
				durationMs: record.durationMs,
				tokenCount: record.tokenCount,
				historyLines: record.historyLines,
				finalSummary: record.finalSummary,
			};
			detailAgentSnapshotRef.current = fromHistory;
			return fromHistory;
		}

		// Keep last known snapshot so detail stays open after tracker drops the agent.
		const snapshot = detailAgentSnapshotRef.current;
		if (snapshot && snapshot.instanceId === detailAgentInstanceId) {
			return {...snapshot, isHistory: true};
		}

		return null;
	}, [detailAgentInstanceId, pickerAgents, runningAgents, runHistory]);

	// Keep detail open even after agent finishes (slot may still show Done).
	// If the agent fully disappears from tracker and no live slot, stay with last known.
	useEffect(() => {
		if (!showSubAgentDetail || !detailAgentInstanceId) return;
		// Clamp timeline offset to non-negative
		if (detailTimelineOffset < 0) {
			setDetailTimelineOffset(0);
		}
	}, [showSubAgentDetail, detailAgentInstanceId, detailTimelineOffset]);

	const openSubAgentDetail = useCallback(
		(instanceId?: string) => {
			const targetId =
				instanceId ||
				pickerAgents[runningAgentsSelectedIndex]?.instanceId ||
				runningAgents[runningAgentsSelectedIndex]?.instanceId ||
				null;
			if (!targetId) return false;

			// Clear >> from input if picker was open
			if (doubleGreaterPosition !== -1) {
				const displayText = buffer.text;
				const beforeGt = displayText.slice(0, doubleGreaterPosition);
				const afterGt = displayText
					.slice(doubleGreaterPosition + 2)
					.trimStart();
				buffer.setText(beforeGt + afterGt);
			}

			const fromList =
				pickerAgents.find(a => a.instanceId === targetId) ?? null;
			if (fromList) {
				detailAgentSnapshotRef.current = fromList;
			}

			setShowRunningAgentsPicker(false);
			setSelectedRunningAgents(new Set());
			setDoubleGreaterPosition(-1);
			setDetailAgentInstanceId(targetId);
			setDetailFocus('timeline');
			setDetailInputValue('');
			setDetailTimelineOffset(0);
			setDetailSendFeedback(null);
			setShowSubAgentDetail(true);
			triggerUpdate();
			return true;
		},
		[
			buffer,
			doubleGreaterPosition,
			pickerAgents,
			runningAgents,
			runningAgentsSelectedIndex,
			triggerUpdate,
		],
	);

	const closeSubAgentDetail = useCallback(() => {
		setShowSubAgentDetail(false);
		setDetailAgentInstanceId(null);
		setDetailFocus('timeline');
		setDetailInputValue('');
		setDetailTimelineOffset(0);
		setDetailSendFeedback(null);
		triggerUpdate();
	}, [triggerUpdate]);

	const toggleDetailFocus = useCallback(() => {
		setDetailFocus(prev => (prev === 'timeline' ? 'input' : 'timeline'));
		triggerUpdate();
	}, [triggerUpdate]);

	const scrollDetailTimeline = useCallback(
		(delta: number) => {
			setDetailTimelineOffset(prev => Math.max(0, prev + delta));
			triggerUpdate();
		},
		[triggerUpdate],
	);

	const appendDetailInput = useCallback(
		(ch: string) => {
			setDetailInputValue(prev => prev + ch);
			triggerUpdate();
		},
		[triggerUpdate],
	);

	const backspaceDetailInput = useCallback(() => {
		setDetailInputValue(prev => prev.slice(0, -1));
		triggerUpdate();
	}, [triggerUpdate]);

	const sendDetailMessage = useCallback((): boolean => {
		const text = detailInputValue.trim();
		if (!text || !detailAgentInstanceId) return false;

		const agent =
			runningAgents.find(a => a.instanceId === detailAgentInstanceId) ||
			detailAgent;
		if (!agent || agent.isHistory) {
			setDetailSendFeedback('Agent is no longer running (history view)');
			triggerUpdate();
			return false;
		}

		let ok = false;
		if (agent.sourceType === 'teammate') {
			ok = teamTracker.sendMessageToTeammate('lead', agent.instanceId, text);
		} else {
			ok = runningSubAgentTracker.enqueueMessage(agent.instanceId, text);
		}

		if (ok) {
			setDetailInputValue('');
			setDetailSendFeedback(`✓ Sent to ${agent.agentName}`);
			// Auto-clear feedback
			setTimeout(() => setDetailSendFeedback(null), 2500);
		} else {
			setDetailSendFeedback('✗ Failed to send (agent not running)');
		}
		triggerUpdate();
		return ok;
	}, [
		detailAgent,
		detailAgentInstanceId,
		detailInputValue,
		runningAgents,
		triggerUpdate,
	]);

	/** Open detail for 1-based index (1-9) in the current picker list. */
	const openSubAgentDetailByIndex = useCallback(
		(oneBasedIndex: number): boolean => {
			const idx = oneBasedIndex - 1;
			if (idx < 0 || idx >= pickerAgents.length) return false;
			const agent = pickerAgents[idx];
			if (!agent) return false;
			return openSubAgentDetail(agent.instanceId);
		},
		[openSubAgentDetail, pickerAgents],
	);

	/**
	 * Switch detail view to another agent by 1-based index among currently
	 * running agents (not history). Falls back to pickerAgents if needed.
	 */
	const switchDetailAgentByIndex = useCallback(
		(oneBasedIndex: number): boolean => {
			const list =
				runningAgents.length > 0
					? runningAgents
					: pickerAgents.filter(a => !a.isHistory);
			const idx = oneBasedIndex - 1;
			if (idx < 0 || idx >= list.length) return false;
			const agent = list[idx];
			if (!agent) return false;
			if (agent.instanceId === detailAgentInstanceId) return true;

			detailAgentSnapshotRef.current = agent;
			setDetailAgentInstanceId(agent.instanceId);
			setDetailFocus('timeline');
			setDetailInputValue('');
			setDetailTimelineOffset(0);
			setDetailSendFeedback(null);
			setShowSubAgentDetail(true);
			triggerUpdate();
			return true;
		},
		[detailAgentInstanceId, pickerAgents, runningAgents, triggerUpdate],
	);

	/** Abort/stop the currently viewed running agent from Detail TUI. */
	const abortDetailAgent = useCallback((): boolean => {
		if (!detailAgentInstanceId) return false;
		const agent =
			runningAgents.find(a => a.instanceId === detailAgentInstanceId) ||
			detailAgent;
		if (!agent || agent.isHistory) {
			setDetailSendFeedback('Agent is no longer running (history view)');
			triggerUpdate();
			return false;
		}

		let ok = false;
		if (agent.sourceType === 'teammate') {
			const controller = teamTracker.getAbortController(agent.instanceId);
			if (controller && !controller.signal.aborted) {
				try {
					controller.abort();
					ok = true;
				} catch {
					ok = false;
				}
			}
		} else {
			ok = runningSubAgentTracker.abortAgent(agent.instanceId);
		}

		if (ok) {
			setDetailSendFeedback(`⏹ Stopped ${agent.agentName}`);
			setTimeout(() => setDetailSendFeedback(null), 2500);
		} else {
			setDetailSendFeedback('✗ Failed to stop agent');
		}
		triggerUpdate();
		return ok;
	}, [detailAgent, detailAgentInstanceId, runningAgents, triggerUpdate]);

	/**
	 * Open detail from live cards when main input is empty.
	 * Prefer active (non-terminal) slots; fall back to any live slot.
	 */
	const openLiveSlotDetailByIndex = useCallback(
		(oneBasedIndex = 1): boolean => {
			try {
				const {getSubAgentLiveSnapshot} =
					require('../conversation/core/subAgentLiveStore.js') as typeof import('../conversation/core/subAgentLiveStore.js');
				const slots = getSubAgentLiveSnapshot();
				if (!slots || slots.length === 0) return false;

				const active = slots.filter(
					s => s.status !== 'completed' && s.status !== 'error',
				);
				const list = active.length > 0 ? active : slots;
				const idx = oneBasedIndex - 1;
				if (idx < 0 || idx >= list.length) return false;
				const slot = list[idx];
				if (!slot) return false;

				// Live slot agentId is the run instance identity for concurrent agents.
				return openSubAgentDetail(slot.agentId);
			} catch {
				return false;
			}
		},
		[openSubAgentDetail],
	);

	return {
		showRunningAgentsPicker,
		setShowRunningAgentsPicker,
		runningAgentsSelectedIndex,
		setRunningAgentsSelectedIndex,
		// Prefer combined list (running + recent history) for the panel.
		runningAgents: pickerAgents,
		selectedRunningAgents,
		toggleRunningAgentSelection,
		confirmRunningAgentsSelection,
		closeRunningAgentsPicker,
		updateRunningAgentsPickerState,
		// Detail TUI
		showSubAgentDetail,
		detailAgent,
		detailFocus,
		detailInputValue,
		detailTimelineOffset,
		detailSendFeedback,
		openSubAgentDetail,
		closeSubAgentDetail,
		toggleDetailFocus,
		scrollDetailTimeline,
		appendDetailInput,
		backspaceDetailInput,
		sendDetailMessage,
		setDetailFocus,
		openSubAgentDetailByIndex,
		switchDetailAgentByIndex,
		abortDetailAgent,
		openLiveSlotDetailByIndex,
	};
}
