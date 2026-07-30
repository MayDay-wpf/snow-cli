import React, {useEffect, useState, memo, useSyncExternalStore} from 'react';
import {Box, Text} from 'ink';
import {
	subscribeSubAgentLive,
	getSubAgentLiveSnapshot,
	SUBAGENT_LIVE_SLOTS_ENABLED,
	type SubAgentLiveSlot,
	type SubAgentLiveStatus,
} from '../../../hooks/conversation/core/subAgentLiveStore.js';
import type {SubAgentDisplayMode} from '../../../utils/config/themeConfig.js';
import {
	formatDurationMs,
	formatElapsedTime,
	MIN_TOOL_DURATION_DISPLAY_MS,
} from '../../../utils/core/textUtils.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {formatTokens} from '../../utils/formatTokens.js';
import {formatSubAgentFinalUsage} from '../../utils/formatSubAgentUsage.js';

type ToolDisplayMode = 'full' | 'compact' | 'hidden';

interface Props {
	toolDisplayMode?: ToolDisplayMode;
	/** /subagent-display mode: slots|multi|compact|hidden */
	subAgentDisplayMode?: SubAgentDisplayMode;
	/** Terminal columns; used to clamp focus/history lines. */
	terminalWidth?: number;
}

/** Strip ANSI SGR sequences from tool title lines. */
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

const LIVE_LINE_MAX_FALLBACK = 120;
/** Prefix like `    └─ ` occupies ~7 cols before the title body. */
const LIVE_LINE_PREFIX_COLS = 7;

function statusLabel(
	slot: SubAgentLiveSlot,
	t: {
		chatScreen: {
			statusThinking: string;
			statusWriting: string;
			statusDeepThinking: string;
		};
	},
): string {
	switch (slot.status) {
		case 'thinking':
			return slot.isReasoning
				? t.chatScreen.statusDeepThinking
				: t.chatScreen.statusThinking;
		case 'writing':
			return t.chatScreen.statusWriting;
		case 'waiting_user':
			return 'Waiting';
		case 'error':
			return 'Error';
		case 'completed':
			return 'Done';
		case 'tool_focus':
		case 'multi_pending':
			return 'Running';
		default:
			return t.chatScreen.statusThinking;
	}
}

function statusColorFor(
	status: SubAgentLiveStatus,
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

function formatSlotElapsed(
	startedAt: number,
	now: number,
	frozenDurationMs?: number,
): string {
	const elapsedMs =
		typeof frozenDurationMs === 'number'
			? Math.max(0, frozenDurationMs)
			: Math.max(0, now - startedAt);
	if (elapsedMs < MIN_TOOL_DURATION_DISPLAY_MS) {
		return '';
	}
	const elapsedSec = Math.floor(elapsedMs / 1000);
	return (
		formatElapsedTime(Math.max(elapsedSec, 1)) || formatDurationMs(elapsedMs)
	);
}

function SubAgentLiveSlotsImpl({
	toolDisplayMode = 'full',
	subAgentDisplayMode = 'slots',
	terminalWidth,
}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();

	const slots = useSyncExternalStore(
		subscribeSubAgentLive,
		getSubAgentLiveSnapshot,
	);

	const hasActiveSlots = slots.some(
		s => s.status !== 'completed' && s.status !== 'error',
	);

	// Single shared 1s clock for elapsed labels while any active slot runs.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!hasActiveSlots) {
			return;
		}
		const timer = setInterval(() => {
			setNow(Date.now());
		}, 1000);
		return () => clearInterval(timer);
	}, [hasActiveSlots]);

	if (
		!SUBAGENT_LIVE_SLOTS_ENABLED ||
		subAgentDisplayMode === 'hidden' ||
		slots.length === 0
	) {
		return null;
	}

	const hideFocus =
		toolDisplayMode === 'hidden' || subAgentDisplayMode === 'compact';
	const showMultiHistory = subAgentDisplayMode === 'multi' && !hideFocus;

	const activeSlots = slots.filter(
		s => s.status !== 'completed' && s.status !== 'error',
	);

	// Parent already pads; clamp body lines so multi-line/long titles never wrap.
	const maxLineCols = Math.max(
		24,
		(typeof terminalWidth === 'number' && terminalWidth > 0
			? terminalWidth
			: LIVE_LINE_MAX_FALLBACK) - LIVE_LINE_PREFIX_COLS,
	);

	return (
		<Box flexDirection="column">
			{slots.map(slot => {
				const label = statusLabel(slot, t);
				const elapsed = formatSlotElapsed(slot.startedAt, now, slot.durationMs);
				// Desired header: (elapsed · status · tokens)
				const finalTokenText = slot.finalUsage
					? formatSubAgentFinalUsage(slot.finalUsage)
					: undefined;
				const headerParts = [
					elapsed || undefined,
					label,
					finalTokenText ??
						(slot.tokenCount > 0
							? `↓ ${formatTokens(slot.tokenCount)} tokens`
							: undefined),
				].filter(Boolean);
				const headerMeta =
					headerParts.length > 0 ? headerParts.join(' · ') : '';
				const color = statusColorFor(
					slot.status,
					slot.isReasoning,
					theme.colors,
				);
				const isTerminal =
					slot.status === 'completed' || slot.status === 'error';
				const activeIndex = activeSlots.findIndex(
					s => s.agentId === slot.agentId,
				);
				const indexLabel =
					!isTerminal && activeIndex >= 0 && activeIndex < 9
						? String(activeIndex + 1)
						: '';

				// Tool focus wins; content preview only while writing with no tool focus.
				// Terminal slots hide body — header alone is the residual Done card.
				const rawFocusTitle = isTerminal
					? ''
					: !hideFocus && slot.focus?.title
					? slot.focus.title
					: !hideFocus && slot.status === 'writing' && slot.preview
					? slot.preview
					: '';
				const focusTitle = rawFocusTitle
					? clampLine(toSingleLine(rawFocusTitle), maxLineCols)
					: '';

				return (
					<Box key={slot.agentId} flexDirection="column">
						<Box>
							<Text
								color={
									isTerminal ? theme.colors.success : theme.colors.menuSelected
								}
								bold
								wrap="truncate"
							>
								{'  '}
								{indexLabel ? `${indexLabel}◈ ` : '◈ '}
								{clampLine(toSingleLine(slot.agentName), maxLineCols)}
							</Text>
							{headerMeta ? (
								<Text color={color} dimColor wrap="truncate">
									{'  '}({headerMeta})
								</Text>
							) : null}
						</Box>
						{focusTitle && !showMultiHistory ? (
							<Box>
								<Text
									color={theme.colors.menuSecondary}
									dimColor
									wrap="truncate"
								>
									{'    └─ '}
									{focusTitle}
								</Text>
							</Box>
						) : null}
						{showMultiHistory && !isTerminal
							? (slot.historyLines || []).slice(-5).map((line, idx, arr) => {
									const display = clampLine(toSingleLine(line), maxLineCols);
									if (!display) return null;
									return (
										<Box key={slot.agentId + '-h-' + String(idx)}>
											<Text
												color={theme.colors.menuSecondary}
												dimColor
												wrap="truncate"
											>
												{'    '}
												{idx === arr.length - 1 ? '└─ ' : '│  '}
												{display}
											</Text>
										</Box>
									);
							  })
							: null}
						{!isTerminal && slot.otherPendingCount > 0 ? (
							<Box>
								<Text color={theme.colors.cyan} dimColor wrap="truncate">
									{'    └─ '}
									{t.chatScreen.pendingToolsMore.replace(
										'{count}',
										String(slot.otherPendingCount),
									)}
								</Text>
							</Box>
						) : null}
					</Box>
				);
			})}
			{activeSlots.length > 0 ? (
				<Box>
					<Text color={theme.colors.menuSecondary} dimColor wrap="truncate">
						{'  ▸ Enter / 1-9 open detail'}
					</Text>
				</Box>
			) : null}
		</Box>
	);
}

const areEqual = (prev: Props, next: Props): boolean =>
	prev.toolDisplayMode === next.toolDisplayMode &&
	prev.subAgentDisplayMode === next.subAgentDisplayMode &&
	prev.terminalWidth === next.terminalWidth;

const SubAgentLiveSlots = memo(SubAgentLiveSlotsImpl, areEqual);
SubAgentLiveSlots.displayName = 'SubAgentLiveSlots';
export default SubAgentLiveSlots;
