import React, {
	memo,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
} from 'react';
import {Box, Text} from 'ink';
import type {PickerAgent} from '../../../hooks/picker/useRunningAgentsPicker.js';
import {
	subscribeSubAgentLive,
	getSubAgentLiveSnapshot,
	type SubAgentLiveSlot,
	type SubAgentLiveStatus,
} from '../../../hooks/conversation/core/subAgentLiveStore.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	formatDurationMs,
	formatElapsedTime,
	MIN_TOOL_DURATION_DISPLAY_MS,
} from '../../../utils/core/textUtils.js';

type DetailFocus = 'timeline' | 'input';

interface Props {
	agent: PickerAgent | null;
	visible: boolean;
	focus: DetailFocus;
	inputValue: string;
	timelineOffset: number;
	maxHeight?: number;
	sendFeedback?: string | null;
	/** Terminal columns; used to size the panel and clamp timeline lines. */
	terminalWidth?: number;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Collapse ANSI + newlines into a single trimmed line for TUI rendering. */
function toSingleLine(text: string): string {
	return stripAnsi(String(text ?? ''))
		.replace(/[\r\n]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Clamp a single-line string to maxCols characters, appending `...` when needed. */
function clampLine(text: string, maxCols: number): string {
	if (maxCols <= 0) return '';
	if (text.length <= maxCols) return text;
	if (maxCols <= 3) return text.slice(0, maxCols);
	return `${text.slice(0, maxCols - 3)}...`;
}

function formatTokens(count: number): string {
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}

function formatElapsed(
	startedAt: Date | number,
	now: number,
	frozenMs?: number,
): string {
	const startMs =
		typeof startedAt === 'number' ? startedAt : startedAt.getTime();
	const elapsedMs =
		typeof frozenMs === 'number'
			? Math.max(0, frozenMs)
			: Math.max(0, now - startMs);
	if (elapsedMs < MIN_TOOL_DURATION_DISPLAY_MS) {
		return '0s';
	}
	const elapsedSec = Math.floor(elapsedMs / 1000);
	return (
		formatElapsedTime(Math.max(elapsedSec, 1)) || formatDurationMs(elapsedMs)
	);
}

function statusLabel(
	status: SubAgentLiveStatus | undefined,
	isReasoning: boolean,
	t: {
		chatScreen: {
			statusThinking: string;
			statusWriting: string;
			statusDeepThinking: string;
		};
		subAgentDetailPanel: {
			statusRunning: string;
			statusWaiting: string;
			statusDone: string;
			statusError: string;
		};
	},
): string {
	switch (status) {
		case 'thinking':
			return isReasoning
				? t.chatScreen.statusDeepThinking
				: t.chatScreen.statusThinking;
		case 'writing':
			return t.chatScreen.statusWriting;
		case 'waiting_user':
			return t.subAgentDetailPanel.statusWaiting;
		case 'error':
			return t.subAgentDetailPanel.statusError;
		case 'completed':
			return t.subAgentDetailPanel.statusDone;
		case 'tool_focus':
		case 'multi_pending':
			return t.subAgentDetailPanel.statusRunning;
		default:
			return t.subAgentDetailPanel.statusRunning;
	}
}

function statusColorFor(
	status: SubAgentLiveStatus | undefined,
	isReasoning: boolean,
	colors: {
		warning: string;
		cyan: string;
		error: string;
		success: string;
		menuSecondary: string;
	},
): string {
	switch (status) {
		case 'thinking':
			return colors.warning;
		case 'writing':
			return colors.cyan;
		case 'tool_focus':
		case 'multi_pending':
			return colors.warning;
		case 'waiting_user':
			return colors.menuSecondary;
		case 'error':
			return colors.error;
		case 'completed':
			return colors.success;
		default:
			return isReasoning ? colors.warning : colors.menuSecondary;
	}
}

function buildTimelineLines(
	slot: SubAgentLiveSlot | undefined,
	agent: PickerAgent,
	maxLineCols: number,
): string[] {
	const lines: string[] = [];
	const prompt = agent.prompt ? toSingleLine(agent.prompt) : '';
	if (prompt) {
		lines.push(clampLine(`prompt · ${prompt}`, maxLineCols));
	}

	// Prefer live timeline; fall back to durable history lines for completed runs.
	const history =
		slot?.historyLines && slot.historyLines.length > 0
			? slot.historyLines
			: agent.historyLines || [];
	for (const line of history) {
		const cleaned = toSingleLine(line);
		if (cleaned) lines.push(clampLine(cleaned, maxLineCols));
	}

	if (slot?.focus?.title) {
		const focusTitle = toSingleLine(slot.focus.title);
		const last = lines[lines.length - 1];
		const clamped = clampLine(focusTitle, maxLineCols);
		if (clamped && clamped !== last) {
			lines.push(clamped);
		}
	} else if (slot?.status === 'writing' && slot.preview) {
		const preview = toSingleLine(slot.preview);
		const last = lines[lines.length - 1];
		const clamped = clampLine(preview, maxLineCols);
		if (clamped && clamped !== last) {
			lines.push(clamped);
		}
	}

	if (slot && slot.otherPendingCount > 0) {
		lines.push(
			clampLine(`+${slot.otherPendingCount} more pending tools`, maxLineCols),
		);
	}

	const summary = toSingleLine(agent.finalSummary || '');
	if (summary) {
		const summaryLine = clampLine(`result · ${summary}`, maxLineCols);
		const last = lines[lines.length - 1];
		if (summaryLine !== last) {
			lines.push(summaryLine);
		}
	}

	if (lines.length === 0) {
		lines.push(agent.isHistory ? '(no saved timeline)' : '(no activity yet)');
	}

	return lines;
}

const SubAgentDetailPanel = memo(
	({
		agent,
		visible,
		focus,
		inputValue,
		timelineOffset,
		maxHeight = 12,
		sendFeedback,
		terminalWidth = 80,
	}: Props) => {
		const {theme} = useTheme();
		const {t} = useI18n();

		const slots = useSyncExternalStore(
			subscribeSubAgentLive,
			getSubAgentLiveSnapshot,
		);

		const slot = useMemo(() => {
			if (!agent) return undefined;
			return slots.find(s => s.agentId === agent.instanceId);
		}, [agent, slots]);

		const isActive =
			!!slot && slot.status !== 'completed' && slot.status !== 'error';
		const [now, setNow] = useState(() => Date.now());
		useEffect(() => {
			if (!visible || !isActive) return;
			const timer = setInterval(() => setNow(Date.now()), 1000);
			return () => clearInterval(timer);
		}, [visible, isActive]);

		if (!visible || !agent) {
			return null;
		}

		// Parent ChatInput already has paddingX; keep a modest min width.
		const panelWidth = Math.max(40, (terminalWidth ?? 80) - 2);
		// Reserve ~6 cols for `  └─ ` / `  │  ` tree prefixes inside padding.
		const maxLineCols = Math.max(24, panelWidth - 8);

		const isHistory = !!agent.isHistory;
		const isTeammate = agent.sourceType === 'teammate';
		const typeLabel = isHistory
			? t.runningAgentsPanel.historyLabel || t.runningAgentsPanel.subAgentLabel
			: isTeammate
			? t.runningAgentsPanel.teammateLabel
			: t.runningAgentsPanel.subAgentLabel;

		const historyStatus =
			agent.historyStatus === 'error'
				? 'error'
				: agent.historyStatus === 'completed'
				? 'completed'
				: undefined;
		const status = slot?.status ?? historyStatus;
		const isReasoning = slot?.isReasoning ?? false;
		const label = statusLabel(status, isReasoning, t);
		const color = statusColorFor(status, isReasoning, theme.colors);
		const elapsed = formatElapsed(
			slot?.startedAt ?? agent.startedAt,
			now,
			slot?.durationMs ?? agent.durationMs,
		);
		const tokenCount = slot?.tokenCount ?? agent.tokenCount ?? 0;
		const tokenText =
			tokenCount > 0 ? `${formatTokens(tokenCount)} tokens` : undefined;
		const headerMeta = [elapsed, label, tokenText].filter(Boolean).join(' · ');
		const shortId = agent.instanceId.slice(-6);
		const headerName = clampLine(toSingleLine(agent.agentName), maxLineCols);
		const headerMetaText = headerMeta
			? clampLine(toSingleLine(headerMeta), Math.max(12, maxLineCols - 4))
			: '';

		const timeline = buildTimelineLines(slot, agent, maxLineCols);
		const visibleCount = Math.max(4, maxHeight);
		const maxOffset = Math.max(0, timeline.length - visibleCount);
		const offset = Math.min(Math.max(0, timelineOffset), maxOffset);
		const visibleLines = timeline.slice(offset, offset + visibleCount);
		const moreAbove = offset;
		const moreBelow = Math.max(0, timeline.length - (offset + visibleCount));

		const inputFocused = focus === 'input';
		const timelineFocused = focus === 'timeline';
		// Reserve `> ` prefix + optional cursor block for input display.
		const inputDisplay = clampLine(
			toSingleLine(inputValue),
			Math.max(12, maxLineCols - 4),
		);

		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.menuInfo}
				paddingX={1}
				marginTop={1}
				width={panelWidth}
			>
				{/* Header */}
				<Box>
					<Text color={theme.colors.menuSelected} bold wrap="truncate">
						{'◈ '}
						{headerName}
					</Text>
					{headerMetaText ? (
						<Text color={color} dimColor wrap="truncate">
							{'  '}({headerMetaText})
						</Text>
					) : null}
				</Box>
				<Box>
					<Text
						color={isTeammate ? theme.colors.warning : theme.colors.cyan}
						dimColor
						wrap="truncate"
					>
						{typeLabel}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor wrap="truncate">
						{' · #'}
						{agent.agentId}
						{' · '}
						{shortId}
					</Text>
					{slot?.ctxUsage ? (
						<Text color={theme.colors.menuSecondary} dimColor wrap="truncate">
							{' · ctx '}
							{Math.round(slot.ctxUsage.percentage)}%
						</Text>
					) : null}
				</Box>

				{/* Timeline */}
				<Box marginTop={1} flexDirection="column">
					<Text
						color={
							timelineFocused
								? theme.colors.menuSelected
								: theme.colors.menuSecondary
						}
						bold={timelineFocused}
						wrap="truncate"
					>
						{timelineFocused ? '❯ ' : '  '}
						{t.subAgentDetailPanel.timelineTitle}
					</Text>
					{moreAbove > 0 ? (
						<Text color={theme.colors.menuSecondary} dimColor wrap="truncate">
							{'  ↑ '}
							{t.subAgentDetailPanel.moreAbove.replace(
								'{count}',
								String(moreAbove),
							)}
						</Text>
					) : null}
					{visibleLines.map((line, idx) => {
						const isLast = idx === visibleLines.length - 1;
						const prefix = isLast ? '└─ ' : '│  ';
						return (
							<Box key={`${offset + idx}-${line.slice(0, 24)}`}>
								<Text
									color={theme.colors.menuSecondary}
									dimColor
									wrap="truncate"
								>
									{'  '}
									{prefix}
									{line}
								</Text>
							</Box>
						);
					})}
					{moreBelow > 0 ? (
						<Text color={theme.colors.menuSecondary} dimColor wrap="truncate">
							{'  ↓ '}
							{t.subAgentDetailPanel.moreBelow.replace(
								'{count}',
								String(moreBelow),
							)}
						</Text>
					) : null}
				</Box>

				{/* Input (hidden for history-only view) */}
				{!isHistory ? (
					<Box marginTop={1} flexDirection="column">
						<Text
							color={
								inputFocused
									? theme.colors.menuSelected
									: theme.colors.menuSecondary
							}
							bold={inputFocused}
							wrap="truncate"
						>
							{inputFocused ? '❯ ' : '  '}
							{t.subAgentDetailPanel.inputLabel}
						</Text>
						<Box marginLeft={2}>
							<Text color={theme.colors.menuInfo} wrap="truncate">
								{'> '}
								{inputDisplay || (
									<Text color={theme.colors.menuSecondary} dimColor>
										{t.subAgentDetailPanel.inputPlaceholder}
									</Text>
								)}
								{inputFocused ? (
									<Text color={theme.colors.menuSelected}>█</Text>
								) : null}
							</Text>
						</Box>
						{sendFeedback ? (
							<Box marginLeft={2}>
								<Text color={theme.colors.success} dimColor wrap="truncate">
									{clampLine(toSingleLine(sendFeedback), maxLineCols)}
								</Text>
							</Box>
						) : null}
					</Box>
				) : (
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor wrap="truncate">
							{t.subAgentDetailPanel.historyReadOnly ||
								'History view · read only'}
						</Text>
					</Box>
				)}

				{/* Hints */}
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor wrap="truncate">
						{!isHistory && t.subAgentDetailPanel.hintRunning
							? t.subAgentDetailPanel.hintRunning
							: t.subAgentDetailPanel.hint}
					</Text>
				</Box>
			</Box>
		);
	},
);

SubAgentDetailPanel.displayName = 'SubAgentDetailPanel';

export default SubAgentDetailPanel;
export type {DetailFocus};
