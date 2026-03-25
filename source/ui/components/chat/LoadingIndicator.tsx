import React, {useSyncExternalStore} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import ShimmerText from '../common/ShimmerText.js';
import CodebaseSearchStatus from './CodebaseSearchStatus.js';
import {formatElapsedTime} from '../../../utils/core/textUtils.js';
import {
	subscribeTeammateStream,
	getTeammateStreamSnapshot,
} from '../../../hooks/conversation/core/subAgentMessageHandler.js';

/**
 * 截断错误消息，避免过长显示
 */
function truncateErrorMessage(
	message: string,
	maxLength: number = 100,
): string {
	if (message.length <= maxLength) {
		return message;
	}
	return message.substring(0, maxLength) + '...';
}

function formatTokens(count: number): string {
	if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
	return String(count);
}

type LoadingIndicatorProps = {
	isStreaming: boolean;
	isStopping: boolean;
	isSaving: boolean;
	hasPendingToolConfirmation: boolean;
	hasPendingUserQuestion: boolean;
	hasBlockingOverlay: boolean;
	terminalWidth: number;
	animationFrame: number;
	retryStatus: {
		isRetrying: boolean;
		errorMessage?: string;
		remainingSeconds?: number;
		attempt: number;
	} | null;
	codebaseSearchStatus: {
		isSearching: boolean;
		attempt: number;
		maxAttempts: number;
		currentTopN: number;
		message: string;
		query?: string;
		originalResultsCount?: number;
		suggestion?: string;
	} | null;
	isReasoning: boolean;
	streamTokenCount: number;
	elapsedSeconds: number;
	currentModel?: string | null;
	teamMode?: boolean;
};

export default function LoadingIndicator({
	isStreaming,
	isStopping,
	isSaving,
	hasPendingToolConfirmation,
	hasPendingUserQuestion,
	hasBlockingOverlay,
	terminalWidth,
	animationFrame,
	retryStatus,
	codebaseSearchStatus,
	isReasoning,
	streamTokenCount,
	elapsedSeconds,
	currentModel,
	teamMode,
}: LoadingIndicatorProps) {
	const {theme} = useTheme();
	const {t} = useI18n();

	const teammateStream = useSyncExternalStore(
		subscribeTeammateStream,
		getTeammateStreamSnapshot,
	);

	if (
		(!isStreaming && !isSaving && !isStopping) ||
		hasPendingToolConfirmation ||
		hasPendingUserQuestion ||
		hasBlockingOverlay
	) {
		return null;
	}

	const showTeamTree = teamMode && teammateStream.length > 0 && isStreaming;

	return (
		<Box marginBottom={1} marginTop={1} paddingX={1} width={terminalWidth}>
			<Text color={['#00FFFF', '#1ACEB0'][animationFrame % 2] as any} bold>
				❆
			</Text>
			<Box marginLeft={1} flexDirection="column">
				{isStopping ? (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.chatScreen.statusStopping}
					</Text>
				) : isStreaming ? (
					<>
						{retryStatus && retryStatus.isRetrying ? (
							<Box flexDirection="column">
								{retryStatus.errorMessage && (
									<Text color="red" dimColor>
										{t.chatScreen.retryError.replace(
											'{message}',
											truncateErrorMessage(retryStatus.errorMessage),
										)}
									</Text>
								)}
								{retryStatus.remainingSeconds !== undefined &&
								retryStatus.remainingSeconds > 0 ? (
									<Text color="yellow" dimColor>
										{t.chatScreen.retryAttempt
											.replace('{current}', String(retryStatus.attempt))
											.replace('{max}', '5')}{' '}
										{t.chatScreen.retryIn.replace(
											'{seconds}',
											String(retryStatus.remainingSeconds),
										)}
									</Text>
								) : (
									<Text color="yellow" dimColor>
										{t.chatScreen.retryResending
											.replace('{current}', String(retryStatus.attempt))
											.replace('{max}', '5')}
									</Text>
								)}
							</Box>
						) : codebaseSearchStatus?.isSearching ? (
							<CodebaseSearchStatus status={codebaseSearchStatus} />
						) : showTeamTree ? (
							<Box flexDirection="column">
								<Text color={theme.colors.menuSecondary} dimColor bold>
									<ShimmerText text="⚑ Team Working" />
									({' '}
									{currentModel && (
										<>
											{currentModel}
											{' · '}
										</>
									)}
									{formatElapsedTime(elapsedSeconds)}
									{' · '}
									<Text color="cyan">
										↓ {formatTokens(streamTokenCount)} tokens
									</Text>
									{')'}
								</Text>
								{teammateStream.map((tm, idx) => {
									const isLast = idx === teammateStream.length - 1;
									const branch = isLast ? '└─' : '├─';
									const status = tm.isReasoning
										? 'Thinking'
										: tm.tokenCount > 0
										? 'Writing'
										: 'Idle';
									const statusColor = tm.isReasoning
										? '#FFD700'
										: tm.tokenCount > 0
										? '#00FFFF'
										: theme.colors.menuSecondary;
									const pct = tm.ctxUsage?.percentage ?? 0;
									const barWidth = 8;
									const filled = Math.round((pct / 100) * barWidth);
									const empty = barWidth - filled;
									const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
									const barColor = pct >= 80 ? 'red' : pct >= 65 ? 'yellow' : pct >= 50 ? 'cyan' : 'gray';
									return (
										<Text key={tm.agentId} dimColor>
											<Text color={theme.colors.menuSecondary}>
												{'  '}{branch}{' '}
											</Text>
											<Text color="#BA7ACE" bold>
												{tm.agentName}
											</Text>
											<Text color={statusColor}>
												{' '}({status}
												{tm.tokenCount > 0 && (
													<>
														{' · '}
														<Text color="cyan">
															↓ {formatTokens(tm.tokenCount)}
														</Text>
													</>
												)}
												)
											</Text>
											{pct > 0 && (
												<Text color={barColor} dimColor>
													{' '}{pct}% {bar}
												</Text>
											)}
										</Text>
									);
								})}
							</Box>
						) : (
							<Text color={theme.colors.menuSecondary} dimColor bold>
								<ShimmerText
									text={
										isReasoning
											? t.chatScreen.statusDeepThinking
											: streamTokenCount > 0
											? t.chatScreen.statusWriting
											: t.chatScreen.statusThinking
									}
								/>
								({' '}
								{currentModel && (
									<>
										{currentModel}
										{' · '}
									</>
								)}
								{formatElapsedTime(elapsedSeconds)}
								<>
									{' · '}
									<Text color="cyan">
										↓{' '}
										{formatTokens(streamTokenCount)}{' '}
										tokens
									</Text>
								</>
								{')'}
							</Text>
						)}
					</>
				) : (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.chatScreen.sessionCreating}
					</Text>
				)}
			</Box>
		</Box>
	);
}
