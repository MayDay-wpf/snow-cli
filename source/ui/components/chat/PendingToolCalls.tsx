import React, {useEffect, useMemo, useState, memo} from 'react';
import {Box, Text} from 'ink';
import type {Message} from './MessageList.js';
import Spinner from 'ink-spinner';
import {
	formatDurationMs,
	formatElapsedTime,
	MIN_TOOL_DURATION_DISPLAY_MS,
} from '../../../utils/core/textUtils.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {SUBAGENT_LIVE_SLOTS_ENABLED} from '../../../hooks/conversation/core/subAgentLiveStore.js';
import {getSubAgentDisplayMode} from '../../../utils/config/themeConfig.js';

interface Props {
	messages: Message[];
}

/**
 * Max number of individual pending tools rendered with full detail. Beyond
 * this, the rest are collapsed into a single summary line to keep the UI
 * bounded when production workloads fan out many tools in parallel.
 */
const MAX_RENDERED_PENDING_TOOLS = 5;

/**
 * 动态渲染正在执行的两步工具（toolPending: true）。
 * 从 Static 中排除后，在此展示实时运行时间，避免完成后残留 pending。
 *
 * Robustness for parallel production workloads:
 * - Memoize the pending list so unrelated `messages` reference changes
 *   (streaming tokens, sibling tool updates) do not re-filter every render.
 * - Cap rendered tools at MAX_RENDERED_PENDING_TOOLS and collapse the rest
 *   into a single summary line. Without this, a 20-tool parallel burst would
 *   create 20 Spinner instances (each with its own 80ms interval) and choke
 *   Ink's reconciler.
 * - Render exactly ONE shared <Spinner> in the header. Per-tool Spinners were
 *   the main source of timer proliferation; the elapsed time per tool is
 *   already covered by a single 1s interval below.
 */
function PendingToolCallsImpl({messages}: Props) {
	const {t} = useI18n();

	// Filter pending tools once per messages reference. useMemo keeps this
	// stable across parent re-renders that don't actually change which tools
	// are pending.
	const pendingTools = useMemo(
		() =>
			messages.filter(msg => {
				// Only main-agent pending rows belong here.
				if (msg.role !== 'assistant' || msg.toolPending !== true) {
					return false;
				}
				// When live slots own sub-agent UI, hide the outer subagent-* tool
				// pending row (avoids: agent container + "subagent-agent_general (21s)").
				if (
					SUBAGENT_LIVE_SLOTS_ENABLED &&
					getSubAgentDisplayMode() !== 'hidden' &&
					typeof msg.toolCall?.name === 'string' &&
					msg.toolCall.name.startsWith('subagent-')
				) {
					return false;
				}
				return true;
			}),
		[messages],
	);

	// Single shared clock for all pending tools. Only runs while at least one
	// tool is pending; clears on unmount. One interval regardless of N.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (pendingTools.length === 0) {
			return;
		}
		const timer = setInterval(() => {
			setNow(Date.now());
		}, 1000);
		return () => clearInterval(timer);
	}, [pendingTools.length]);

	if (pendingTools.length === 0) {
		return null;
	}

	// Split into the first N detailed rows + a collapsed summary for the rest.
	const visibleTools = pendingTools.slice(0, MAX_RENDERED_PENDING_TOOLS);
	const hiddenCount = pendingTools.length - visibleTools.length;

	// Oldest started-at drives the summary elapsed label so the single shared
	// clock has a stable anchor even when tools finish out of order.
	const oldestStartedAt = pendingTools.reduce<number | undefined>(
		(oldest, tool) => {
			const startedAt =
				typeof tool.toolStartedAt === 'number' ? tool.toolStartedAt : undefined;
			if (startedAt === undefined) return oldest;
			return oldest === undefined ? startedAt : Math.min(oldest, startedAt);
		},
		undefined,
	);
	const summaryElapsedMs =
		oldestStartedAt !== undefined ? Math.max(0, now - oldestStartedAt) : 0;
	const summaryElapsedSec = Math.floor(summaryElapsedMs / 1000);
	const showSummaryElapsed =
		oldestStartedAt !== undefined &&
		summaryElapsedMs >= MIN_TOOL_DURATION_DISPLAY_MS;
	const summaryElapsedLabel = showSummaryElapsed
		? formatElapsedTime(Math.max(summaryElapsedSec, 1)) ||
		  formatDurationMs(summaryElapsedMs)
		: '';

	const renderToolRow = (tool: Message, index: number) => {
		const startedAt =
			typeof tool.toolStartedAt === 'number' ? tool.toolStartedAt : undefined;
		const elapsedMs =
			startedAt !== undefined ? Math.max(0, now - startedAt) : 0;
		const elapsedSeconds = Math.floor(elapsedMs / 1000);
		const showElapsed =
			startedAt !== undefined && elapsedMs >= MIN_TOOL_DURATION_DISPLAY_MS;
		const elapsedLabel = showElapsed
			? formatElapsedTime(Math.max(elapsedSeconds, 1)) ||
			  formatDurationMs(elapsedMs)
			: '';
		const tokens =
			typeof tool.toolProgressTokens === 'number' && tool.toolProgressTokens > 0
				? tool.toolProgressTokens
				: undefined;
		const progressParts = [
			elapsedLabel || undefined,
			tokens !== undefined ? `${tokens} tokens` : undefined,
		].filter(Boolean);
		const progressLabel =
			progressParts.length > 0 ? progressParts.join(' · ') : '';

		return (
			<Box key={tool.toolCallId || `pending-tool-${index}`}>
				<Text color="yellow">{'  '}</Text>
				<Text color="yellow">{tool.content || 'Running tool'}</Text>
				{progressLabel ? (
					<Text color="cyan" dimColor>
						{' '}
						({progressLabel})
					</Text>
				) : null}
			</Box>
		);
	};

	return (
		<Box flexDirection="column">
			{/* Single shared Spinner in the header - one timer for N tools. */}
			<Box>
				<Text color="yellow">
					<Spinner type="dots" />{' '}
				</Text>
				<Text color="yellow">
					{pendingTools.length > 1
						? t.chatScreen.pendingToolsSummary
								.replace('{count}', String(pendingTools.length))
								.replace('{elapsed}', summaryElapsedLabel || '…')
						: visibleTools[0]?.content || 'Running tool'}
				</Text>
				{pendingTools.length === 1 &&
					visibleTools[0] &&
					(() => {
						const tool = visibleTools[0]!;
						const startedAt =
							typeof tool.toolStartedAt === 'number'
								? tool.toolStartedAt
								: undefined;
						if (startedAt === undefined) return null;
						const elapsedMs = Math.max(0, now - startedAt);
						if (elapsedMs < MIN_TOOL_DURATION_DISPLAY_MS) return null;
						const elapsedSeconds = Math.floor(elapsedMs / 1000);
						const label =
							formatElapsedTime(Math.max(elapsedSeconds, 1)) ||
							formatDurationMs(elapsedMs);
						const tokens =
							typeof tool.toolProgressTokens === 'number' &&
							tool.toolProgressTokens > 0
								? `${tool.toolProgressTokens} tokens`
								: undefined;
						const parts = [label, tokens].filter(Boolean).join(' · ');
						return parts ? (
							<Text color="cyan" dimColor>
								{' '}
								({parts})
							</Text>
						) : null;
					})()}
			</Box>
			{/* When multiple tools run in parallel, list each (capped) without a
			    per-row Spinner to avoid N independent timers choking the TUI. */}
			{pendingTools.length > 1
				? visibleTools.map((tool, index) => renderToolRow(tool, index))
				: null}
			{hiddenCount > 0 ? (
				<Box>
					<Text color="cyan" dimColor>
						{'  '}
						{t.chatScreen.pendingToolsMore.replace(
							'{count}',
							String(hiddenCount),
						)}
					</Text>
				</Box>
			) : null}
		</Box>
	);
}

const areEqual = (prev: Props, next: Props): boolean =>
	prev.messages === next.messages;

const PendingToolCalls = memo(PendingToolCallsImpl, areEqual);
PendingToolCalls.displayName = 'PendingToolCalls';
export default PendingToolCalls;
