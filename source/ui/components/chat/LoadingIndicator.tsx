import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import ShimmerText from '../common/ShimmerText.js';
import CodebaseSearchStatus from './CodebaseSearchStatus.js';
import {formatElapsedTime} from '../../../utils/core/textUtils.js';

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

type LoadingIndicatorProps = {
	isStreaming: boolean;
	isStopping: boolean;
	isSaving: boolean;
	hasPendingToolConfirmation: boolean;
	hasPendingUserQuestion: boolean;
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
		reviewResults?: {
			originalCount: number;
			filteredCount: number;
			removedCount: number;
			highConfidenceFiles?: string[];
			reviewFailed?: boolean;
		};
	} | null;
	isReasoning: boolean;
	streamTokenCount: number;
	elapsedSeconds: number;
	currentModel?: string | null;
};

export default function LoadingIndicator({
	isStreaming,
	isStopping,
	isSaving,
	hasPendingToolConfirmation,
	hasPendingUserQuestion,
	terminalWidth,
	animationFrame,
	retryStatus,
	codebaseSearchStatus,
	isReasoning,
	streamTokenCount,
	elapsedSeconds,
	currentModel,
}: LoadingIndicatorProps) {
	const {theme} = useTheme();
	const {t} = useI18n();

	// 不显示加载指示器的条件
	if (
		(!isStreaming && !isSaving && !isStopping) ||
		hasPendingToolConfirmation ||
		hasPendingUserQuestion
	) {
		return null;
	}

	return (
		<Box marginBottom={1} paddingX={1} width={terminalWidth}>
			<Text
				color={
					[
						theme.colors.menuInfo,
						theme.colors.success,
						theme.colors.menuSelected,
						theme.colors.menuInfo,
						theme.colors.menuSecondary,
					][animationFrame] as any
				}
				bold
			>
				❆
			</Text>
			<Box marginLeft={1} marginBottom={1} flexDirection="column">
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
						) : codebaseSearchStatus && !codebaseSearchStatus.isSearching ? (
							<CodebaseSearchStatus status={codebaseSearchStatus} />
						) : (
							<Text color={theme.colors.menuSecondary} dimColor>
								<ShimmerText
									text={
										isReasoning
											? t.chatScreen.statusDeepThinking
											: streamTokenCount > 0
											? t.chatScreen.statusWriting
											: t.chatScreen.statusThinking
									}
								/>{' '}
								(
								{currentModel && (
									<>
										{currentModel}
										{' · '}
									</>
								)}
								{formatElapsedTime(elapsedSeconds)}
								{' · '}
								<Text color="cyan">
									↓{' '}
									{streamTokenCount >= 1000
										? `${(streamTokenCount / 1000).toFixed(1)}k`
										: streamTokenCount}{' '}
									tokens
								</Text>
								)
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
