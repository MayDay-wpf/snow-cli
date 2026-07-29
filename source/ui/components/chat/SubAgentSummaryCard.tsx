import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	formatDurationMs,
	formatElapsedTime,
	MIN_TOOL_DURATION_DISPLAY_MS,
} from '../../../utils/core/textUtils.js';

export type SubAgentSummaryData = {
	instanceId: string;
	agentId: string;
	agentName: string;
	prompt?: string;
	status: 'completed' | 'error';
	durationMs?: number;
	tokenCount?: number;
	historyLines?: string[];
	resultPreview?: string;
	errorMessage?: string;
	toolCount?: number;
};

interface Props {
	summary: SubAgentSummaryData;
	/** full: show short timeline; compact: header + result only */
	expanded?: boolean;
	maxPreviewLines?: number;
}

function stripAnsi(text: string): string {
	return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function formatTokens(count: number): string {
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}

function formatDuration(durationMs?: number): string | undefined {
	if (
		typeof durationMs !== 'number' ||
		durationMs < MIN_TOOL_DURATION_DISPLAY_MS
	) {
		return undefined;
	}
	const sec = Math.floor(durationMs / 1000);
	return formatElapsedTime(Math.max(sec, 1)) || formatDurationMs(durationMs);
}

function truncate(text: string, max = 96): string {
	const cleaned = stripAnsi(text)
		.replace(/[\r\n]+/g, ' ')
		.trim();
	if (cleaned.length <= max) return cleaned;
	return `${cleaned.slice(0, max - 1)}…`;
}

function SubAgentSummaryCardImpl({
	summary,
	expanded = true,
	maxPreviewLines = 4,
}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();

	const isError = summary.status === 'error';
	const statusLabel = isError
		? t.subAgentSummaryCard.statusError
		: t.subAgentSummaryCard.statusDone;
	const statusColor = isError ? theme.colors.error : theme.colors.success;
	const duration = formatDuration(summary.durationMs);
	const tokenText =
		typeof summary.tokenCount === 'number' && summary.tokenCount > 0
			? `${formatTokens(summary.tokenCount)} tokens`
			: undefined;
	const toolText =
		typeof summary.toolCount === 'number' && summary.toolCount > 0
			? t.subAgentSummaryCard.toolsCount.replace(
					'{count}',
					String(summary.toolCount),
			  )
			: undefined;
	const meta = [duration, statusLabel, tokenText, toolText]
		.filter(Boolean)
		.join(' · ');

	const prompt = summary.prompt ? truncate(summary.prompt, 80) : '';
	const history = (summary.historyLines || [])
		.map(line => stripAnsi(line).trim())
		.filter(Boolean)
		.slice(-maxPreviewLines);
	const resultText = summary.errorMessage || summary.resultPreview || '';

	return (
		<Box flexDirection="column" marginTop={0}>
			<Box>
				<Text color={theme.colors.menuSelected} bold>
					{'◈ '}
					{summary.agentName}
				</Text>
				{meta ? (
					<Text color={statusColor} dimColor>
						{'  '}({meta})
					</Text>
				) : null}
			</Box>

			<Box>
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.runningAgentsPanel.subAgentLabel}
					{' · #'}
					{summary.agentId}
					{' · '}
					{summary.instanceId.slice(-6)}
				</Text>
			</Box>

			{prompt ? (
				<Box>
					<Text color={theme.colors.menuSecondary} dimColor>
						{'  '}
						{t.subAgentSummaryCard.promptLabel}
						{' · '}
						{prompt}
					</Text>
				</Box>
			) : null}

			{expanded && history.length > 0 ? (
				<Box flexDirection="column">
					{history.map((line, idx) => {
						const isLast = idx === history.length - 1 && !resultText;
						const prefix = isLast ? '└─ ' : '│  ';
						return (
							<Box key={`${idx}-${line.slice(0, 20)}`}>
								<Text color={theme.colors.menuSecondary} dimColor>
									{'  '}
									{prefix}
									{truncate(line, 100)}
								</Text>
							</Box>
						);
					})}
				</Box>
			) : null}

			{resultText ? (
				<Box>
					<Text
						color={isError ? theme.colors.error : theme.colors.menuSecondary}
						dimColor={!isError}
					>
						{'  └─ '}
						{expanded
							? `${
									isError
										? t.subAgentSummaryCard.errorLabel
										: t.subAgentSummaryCard.resultLabel
							  } · ${truncate(resultText, 140)}`
							: truncate(resultText, 100)}
					</Text>
				</Box>
			) : null}

			<Box>
				<Text color={theme.colors.menuInfo} dimColor>
					{'  '}
					{t.subAgentSummaryCard.historyHint}
				</Text>
			</Box>
		</Box>
	);
}

const SubAgentSummaryCard = memo(SubAgentSummaryCardImpl);
SubAgentSummaryCard.displayName = 'SubAgentSummaryCard';
export default SubAgentSummaryCard;
