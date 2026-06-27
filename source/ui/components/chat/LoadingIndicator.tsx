import React, {useRef, useSyncExternalStore} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import ShimmerText from '../common/ShimmerText.js';
import CodebaseSearchStatus from './CodebaseSearchStatus.js';
import {formatElapsedTime} from '../../../utils/core/textUtils.js';
import {
	subscribeTeammateStream,
	getTeammateStreamSnapshot,
	subscribeSubAgentStream,
	getSubAgentStreamSnapshot,
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

const STREAM_DELAY_STAGE_SECONDS = {
	warning: 30,
	critical: 60,
} as const;
const STREAM_DELAY_SHIMMER_COLORS = {
	normal: {
		base: '#1ACEB0',
		shimmer: '#00FFFF',
	},
	warning: {
		base: '#ffc857',
		shimmer: '#ffe7a3',
	},
	critical: {
		base: '#d97706',
		shimmer: '#ffb347',
	},
} as const;

type StreamDelayStage = keyof typeof STREAM_DELAY_SHIMMER_COLORS;

function getStreamDelayStage(waitingSeconds: number): StreamDelayStage {
	if (waitingSeconds >= STREAM_DELAY_STAGE_SECONDS.critical) {
		return 'critical';
	}

	if (waitingSeconds >= STREAM_DELAY_STAGE_SECONDS.warning) {
		return 'warning';
	}

	return 'normal';
}

function getDelayAwareColor(
	waitingSeconds: number,
	baseColor: string,
	criticalColor: string,
): string {
	const stage = getStreamDelayStage(waitingSeconds);

	if (stage === 'critical') {
		return criticalColor;
	}

	if (stage === 'warning') {
		return STREAM_DELAY_SHIMMER_COLORS.warning.base;
	}

	return baseColor;
}

type LoadingIndicatorProps = {
	isStreaming: boolean;
	isStopping: boolean;
	isSaving: boolean;
	isCompressing: boolean;
	isAutoCompressing?: boolean;
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
		maxRetries?: number;
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
	isCompressing,
	isAutoCompressing = false,
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
	const subAgentStream = useSyncExternalStore(
		subscribeSubAgentStream,
		getSubAgentStreamSnapshot,
	);

	const streamActivityMarker = [
		streamTokenCount,
		...teammateStream.map(
			tm => `${tm.agentId}:${tm.tokenCount}:${tm.isReasoning}`,
		),
		...subAgentStream.map(
			tm => `${tm.agentId}:${tm.tokenCount}:${tm.isReasoning}`,
		),
	].join('|');
	const previousStreamActivityMarkerRef = useRef<string | null>(null);
	const lastStreamActivityElapsedSecondsRef = useRef(elapsedSeconds);

	const shouldIgnoreStreamDelay = isCompressing || isAutoCompressing;

	if (
		!isStreaming ||
		shouldIgnoreStreamDelay ||
		previousStreamActivityMarkerRef.current !== streamActivityMarker
	) {
		previousStreamActivityMarkerRef.current = streamActivityMarker;
		lastStreamActivityElapsedSecondsRef.current = elapsedSeconds;
	}

	const waitingForStreamSeconds =
		isStreaming && !shouldIgnoreStreamDelay
			? Math.max(
					0,
					elapsedSeconds - lastStreamActivityElapsedSecondsRef.current,
			  )
			: 0;
	const streamDelayStage = getStreamDelayStage(waitingForStreamSeconds);
	const loadingShimmerColors = STREAM_DELAY_SHIMMER_COLORS[streamDelayStage];
	const loadingIconColor = getDelayAwareColor(
		waitingForStreamSeconds,
		[theme.colors.cyan, theme.colors.menuInfo][animationFrame % 2] as string,
		STREAM_DELAY_SHIMMER_COLORS.critical.base,
	);
	const loadingTextColor = loadingShimmerColors.base;
	const loadingTokenColor = loadingShimmerColors.shimmer;

	if (
		(!isStreaming && !isSaving && !isStopping) ||
		hasPendingToolConfirmation ||
		hasPendingUserQuestion ||
		hasBlockingOverlay
	) {
		return null;
	}

	const showTeamTree = teamMode && teammateStream.length > 0 && isStreaming;
	const showSubAgentTree = subAgentStream.length > 0 && isStreaming;
	const isRetryResending =
		retryStatus?.isRetrying === true &&
		(retryStatus.remainingSeconds === undefined ||
			retryStatus.remainingSeconds === 0);
	const loadingTips = t.chatScreen.loadingTips;
	const loadingTip =
		loadingTips.length > 0
			? loadingTips[Math.floor(elapsedSeconds / 6) % loadingTips.length] ?? null
			: null;

	const renderLoadingTip = () => {
		if (!loadingTip || !isStreaming || isStopping) {
			return null;
		}

		return (
			<Text color={theme.colors.menuSecondary} dimColor>
				<Text color={theme.colors.menuSecondary}>└─ tips: </Text>
				{loadingTip}
			</Text>
		);
	};

	const renderAgentEntry = (
		tm: {
			agentId: string;
			agentName: string;
			tokenCount: number;
			isReasoning: boolean;
			ctxUsage?: {percentage: number};
		},
		isLast: boolean,
	) => {
		const branch = isLast ? '└─' : '├─';
		const status = tm.isReasoning
			? 'Thinking'
			: tm.tokenCount > 0
			? 'Writing'
			: 'Idle';
		const statusColor = tm.isReasoning
			? theme.colors.warning
			: tm.tokenCount > 0
			? theme.colors.cyan
			: theme.colors.menuSecondary;
		const pct = tm.ctxUsage?.percentage ?? 0;
		const barWidth = 8;
		const filled = Math.round((pct / 100) * barWidth);
		const empty = barWidth - filled;
		const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
		const barColor =
			pct >= 80
				? theme.colors.error
				: pct >= 65
				? theme.colors.warning
				: pct >= 50
				? theme.colors.cyan
				: theme.colors.menuSecondary;
		return (
			<Text key={tm.agentId} dimColor>
				<Text color={theme.colors.menuSecondary}>
					{'  '}
					{branch}{' '}
				</Text>
				<Text color={theme.colors.menuSelected} bold>
					{tm.agentName}
				</Text>
				<Text color={statusColor}>
					{' '}
					({status}
					{tm.tokenCount > 0 && (
						<>
							{' · '}
							<Text color={theme.colors.cyan}>
								↓ {formatTokens(tm.tokenCount)}
							</Text>
						</>
					)}
					)
				</Text>
				{pct > 0 && (
					<Text color={barColor} dimColor>
						{' '}
						{pct}% {bar}
					</Text>
				)}
			</Text>
		);
	};

	const renderAgentTree = (
		entries: Array<{
			agentId: string;
			agentName: string;
			tokenCount: number;
			isReasoning: boolean;
			ctxUsage?: {percentage: number};
		}>,
		title: string,
	) => (
		<Box flexDirection="column">
			<Text color={loadingTextColor} dimColor bold>
				<ShimmerText
					text={title}
					baseColor={loadingTextColor}
					shimmerColor={loadingTokenColor}
				/>
			</Text>
			{entries.map((tm, idx) =>
				renderAgentEntry(tm, idx === entries.length - 1),
			)}
		</Box>
	);

	return (
		<Box marginBottom={1} marginTop={1} paddingX={1} width={terminalWidth}>
			<Text color={loadingIconColor} bold>
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
									<Text color={theme.colors.error} dimColor>
										{t.chatScreen.retryError.replace(
											'{message}',
											truncateErrorMessage(retryStatus.errorMessage),
										)}
									</Text>
								)}
								{retryStatus.remainingSeconds !== undefined &&
								retryStatus.remainingSeconds > 0 ? (
									<Text color={theme.colors.warning} dimColor>
										{t.chatScreen.retryAttempt
											.replace('{current}', String(retryStatus.attempt))
											.replace(
												'{max}',
												String(retryStatus.maxRetries ?? 5),
											)}{' '}
										{t.chatScreen.retryIn.replace(
											'{seconds}',
											String(retryStatus.remainingSeconds),
										)}
									</Text>
								) : isRetryResending ? (
									<Text color={theme.colors.warning} dimColor bold>
										<ShimmerText
											text={t.chatScreen.retryResending
												.replace('{current}', String(retryStatus.attempt))
												.replace('{max}', String(retryStatus.maxRetries ?? 5))}
											baseColor={theme.colors.warning}
											shimmerColor={STREAM_DELAY_SHIMMER_COLORS.warning.shimmer}
										/>
									</Text>
								) : null}
							</Box>
						) : codebaseSearchStatus?.isSearching ? (
							<CodebaseSearchStatus status={codebaseSearchStatus} />
						) : showTeamTree ? (
							<Box flexDirection="column">
								<Text color={loadingTextColor} dimColor bold>
									<ShimmerText
										text="⚑ Team Working"
										baseColor={loadingTextColor}
										shimmerColor={loadingTokenColor}
									/>
									({' '}
									{currentModel && (
										<>
											{currentModel}
											{' · '}
										</>
									)}
									{formatElapsedTime(elapsedSeconds)}
									{' · '}
									<Text color={loadingTokenColor}>
										↓ {formatTokens(streamTokenCount)} tokens
									</Text>
									{')'}
								</Text>
								{teammateStream.map((tm, idx) =>
									renderAgentEntry(tm, idx === teammateStream.length - 1),
								)}
							</Box>
						) : showSubAgentTree ? (
							renderAgentTree(
								subAgentStream,
								`⚑ Sub-Agent Working (${formatElapsedTime(elapsedSeconds)})`,
							)
						) : (
							<Text color={loadingTextColor} dimColor bold>
								<ShimmerText
									text={
										isReasoning
											? t.chatScreen.statusDeepThinking
											: streamTokenCount > 0
											? t.chatScreen.statusWriting
											: t.chatScreen.statusThinking
									}
									baseColor={loadingTextColor}
									shimmerColor={loadingTokenColor}
								/>
								({' '}
								{currentModel && (
									<>
										{currentModel}
										{' · '}
									</>
								)}
								{formatElapsedTime(elapsedSeconds)}
								{' · '}
								<Text color={loadingTokenColor}>
									↓ {formatTokens(streamTokenCount)} tokens
								</Text>
								{')'}
							</Text>
						)}
						{renderLoadingTip()}
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
