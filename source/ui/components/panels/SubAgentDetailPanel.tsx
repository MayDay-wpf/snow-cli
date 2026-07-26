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
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, '');
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
): string[] {
	const lines: string[] = [];
	const prompt = agent.prompt
		? stripAnsi(
				agent.prompt
					.replace(/[\r\n]+/g, ' ')
					.replace(/\s+/g, ' ')
					.trim(),
		  )
		: '';
	if (prompt) {
		lines.push(`prompt · ${prompt}`);
	}

	// Prefer live timeline; fall back to durable history lines for completed runs.
	const history =
		slot?.historyLines && slot.historyLines.length > 0
			? slot.historyLines
			: agent.historyLines || [];
	for (const line of history) {
		const cleaned = stripAnsi(line).trim();
		if (cleaned) lines.push(cleaned);
	}

	if (slot?.focus?.title) {
		const focusTitle = stripAnsi(slot.focus.title).trim();
		const last = lines[lines.length - 1];
		if (focusTitle && focusTitle !== last) {
			lines.push(focusTitle);
		}
	} else if (slot?.status === 'writing' && slot.preview) {
		const preview = stripAnsi(slot.preview).trim();
		const last = lines[lines.length - 1];
		if (preview && preview !== last) {
			lines.push(preview);
		}
	}

	if (slot && slot.otherPendingCount > 0) {
		lines.push(`+${slot.otherPendingCount} more pending tools`);
	}

	const summary = agent.finalSummary?.trim();
	if (summary) {
		const summaryLine = `result · ${stripAnsi(summary)}`;
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

		const timeline = buildTimelineLines(slot, agent);
		const visibleCount = Math.max(4, maxHeight);
		const maxOffset = Math.max(0, timeline.length - visibleCount);
		const offset = Math.min(Math.max(0, timelineOffset), maxOffset);
		const visibleLines = timeline.slice(offset, offset + visibleCount);
		const moreAbove = offset;
		const moreBelow = Math.max(0, timeline.length - (offset + visibleCount));

		const inputFocused = focus === 'input';
		const timelineFocused = focus === 'timeline';

		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.menuInfo}
				paddingX={1}
				marginTop={1}
			>
				{/* Header */}
				<Box>
					<Text color={theme.colors.menuSelected} bold>
						{'◈ '}
						{agent.agentName}
					</Text>
					{headerMeta ? (
						<Text color={color} dimColor>
							{'  '}({headerMeta})
						</Text>
					) : null}
				</Box>
				<Box>
					<Text
						color={isTeammate ? theme.colors.warning : theme.colors.cyan}
						dimColor
					>
						{typeLabel}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{' · #'}
						{agent.agentId}
						{' · '}
						{shortId}
					</Text>
					{slot?.ctxUsage ? (
						<Text color={theme.colors.menuSecondary} dimColor>
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
					>
						{timelineFocused ? '❯ ' : '  '}
						{t.subAgentDetailPanel.timelineTitle}
					</Text>
					{moreAbove > 0 ? (
						<Text color={theme.colors.menuSecondary} dimColor>
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
								<Text color={theme.colors.menuSecondary} dimColor>
									{'  '}
									{prefix}
									{line.length > 96 ? `${line.slice(0, 93)}...` : line}
								</Text>
							</Box>
						);
					})}
					{moreBelow > 0 ? (
						<Text color={theme.colors.menuSecondary} dimColor>
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
						>
							{inputFocused ? '❯ ' : '  '}
							{t.subAgentDetailPanel.inputLabel}
						</Text>
						<Box marginLeft={2}>
							<Text color={theme.colors.menuInfo}>
								{'> '}
								{inputValue || (
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
								<Text color={theme.colors.success} dimColor>
									{sendFeedback}
								</Text>
							</Box>
						) : null}
					</Box>
				) : (
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.subAgentDetailPanel.historyReadOnly ||
								'History view · read only'}
						</Text>
					</Box>
				)}

				{/* Hints */}
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
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
