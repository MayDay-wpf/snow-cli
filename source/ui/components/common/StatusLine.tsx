import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {getSimpleMode} from '../../../utils/config/themeConfig.js';
import {smartTruncatePath} from '../../../utils/ui/messageFormatter.js';

const MEMORY_REFRESH_INTERVAL_MS = 5000;

// 根据平台返回快捷键显示文本: Windows/Linux使用 Alt+P, macOS使用 Ctrl+P
const getProfileShortcut = () =>
	process.platform === 'darwin' ? 'Ctrl+P' : 'Alt+P';

function getCurrentProcessMemoryUsageMb(): number {
	return Math.max(1, process.memoryUsage().rss / (1024 * 1024));
}

function formatMemoryUsage(memoryUsageMb: number): string {
	if (memoryUsageMb >= 1024) {
		return `${(memoryUsageMb / 1024).toFixed(2)} GB`;
	}

	return `${memoryUsageMb.toFixed(0)} MB`;
}

function useCurrentProcessMemoryUsage(): number {
	const [memoryUsageMb, setMemoryUsageMb] = React.useState(() =>
		getCurrentProcessMemoryUsageMb(),
	);

	React.useEffect(() => {
		const timer = setInterval(() => {
			setMemoryUsageMb(getCurrentProcessMemoryUsageMb());
		}, MEMORY_REFRESH_INTERVAL_MS);

		return () => clearInterval(timer);
	}, []);

	return memoryUsageMb;
}

type VSCodeConnectionStatus =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'error';

type EditorContext = {
	activeFile?: string;
	selectedText?: string;
	cursorPosition?: {line: number; character: number};
	workspaceFolder?: string;
};

type ContextUsage = {
	inputTokens: number;
	maxContextTokens: number;
	cacheCreationTokens?: number;
	cacheReadTokens?: number;
	cachedTokens?: number;
};

type Props = {
	// 模式信息
	yoloMode?: boolean;
	planMode?: boolean;
	vulnerabilityHuntingMode?: boolean;
	toolSearchDisabled?: boolean;

	// IDE连接信息
	vscodeConnectionStatus?: VSCodeConnectionStatus;
	editorContext?: EditorContext;

	// 实例连接信息
	connectionStatus?:
		| 'disconnected'
		| 'connecting'
		| 'connected'
		| 'reconnecting';
	connectionInstanceName?: string;

	// Token消耗信息
	contextUsage?: ContextUsage;

	// 代码库索引状态
	codebaseIndexing?: boolean;
	codebaseProgress?: {
		totalFiles: number;
		processedFiles: number;
		totalChunks: number;
		currentFile?: string;
		status?: string;
		error?: string;
	} | null;

	// 文件监视器状态
	watcherEnabled?: boolean;
	fileUpdateNotification?: {
		file: string;
		timestamp: number;
	} | null;
	copyStatusMessage?: {
		text: string;
		isError?: boolean;
		timestamp: number;
	} | null;

	// Profile 信息
	currentProfileName?: string;

	// 自动压缩禁止中断提示
	compressBlockToast?: string | null;
};

function calculateContextPercentage(contextUsage: ContextUsage): number {
	const isAnthropic =
		(contextUsage.cacheCreationTokens || 0) > 0 ||
		(contextUsage.cacheReadTokens || 0) > 0;

	const totalInputTokens = isAnthropic
		? contextUsage.inputTokens +
		  (contextUsage.cacheCreationTokens || 0) +
		  (contextUsage.cacheReadTokens || 0)
		: contextUsage.inputTokens;

	return Math.min(
		100,
		(totalInputTokens / contextUsage.maxContextTokens) * 100,
	);
}

export default function StatusLine({
	yoloMode = false,
	planMode = false,
	vulnerabilityHuntingMode = false,
	toolSearchDisabled = true,
	vscodeConnectionStatus,
	editorContext,
	connectionStatus,
	connectionInstanceName,
	contextUsage,
	codebaseIndexing = false,
	codebaseProgress,
	watcherEnabled = false,
	fileUpdateNotification,
	copyStatusMessage,
	currentProfileName,
	compressBlockToast,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const simpleMode = getSimpleMode();
	const memoryUsageMb = useCurrentProcessMemoryUsage();
	const formattedMemoryUsage = formatMemoryUsage(memoryUsageMb);
	const simpleMemoryStatusText = `⛁ ${formattedMemoryUsage}`;
	const detailedMemoryStatusText = `⛁ ${t.chatScreen.memoryUsageLabel} ${formattedMemoryUsage}`;

	// 是否显示任何状态信息
	const hasAnyStatus =
		yoloMode ||
		planMode ||
		vulnerabilityHuntingMode ||
		!toolSearchDisabled ||
		(vscodeConnectionStatus && vscodeConnectionStatus !== 'disconnected') ||
		(connectionStatus && connectionStatus !== 'disconnected') ||
		contextUsage ||
		codebaseIndexing ||
		watcherEnabled ||
		fileUpdateNotification ||
		copyStatusMessage ||
		currentProfileName ||
		compressBlockToast ||
		detailedMemoryStatusText;

	if (!hasAnyStatus) {
		return null;
	}

	// 简易模式：横向单行显示状态，Token信息单独一行
	if (simpleMode) {
		const statusItems: Array<{text: string; color: string}> = [];

		// Profile - 显示在最前面
		if (currentProfileName) {
			statusItems.push({
				text: `ꚰ ${currentProfileName}`,
				color: theme.colors.menuInfo,
			});
		}

		// YOLO模式
		if (yoloMode) {
			statusItems.push({text: '❁ YOLO', color: theme.colors.warning});
		}

		// Plan模式
		if (planMode) {
			statusItems.push({text: '⚐ Plan', color: '#60A5FA'});
		}

		// Vulnerability Hunting 模式
		if (vulnerabilityHuntingMode) {
			statusItems.push({text: '⍨ Vuln Hunt', color: '#de409aff'});
		}

		// Tool Search 开启提示
		if (!toolSearchDisabled) {
			statusItems.push({
				text: '♾︎ ToolSearch ON',
				color: theme.colors.menuInfo,
			});
		}

		// IDE连接状态
		if (vscodeConnectionStatus && vscodeConnectionStatus !== 'disconnected') {
			if (vscodeConnectionStatus === 'connecting') {
				statusItems.push({text: '◐ IDE', color: 'yellow'});
			} else if (vscodeConnectionStatus === 'connected') {
				statusItems.push({text: '● IDE', color: 'green'});
			} else if (vscodeConnectionStatus === 'error') {
				statusItems.push({text: '○ IDE', color: 'gray'});
			}
		}

		// 实例连接状态 - 只显示连接状态，不显示断开
		if (connectionStatus && connectionStatus !== 'disconnected') {
			if (connectionStatus === 'connecting') {
				statusItems.push({
					text: '◐ Backend',
					color: 'yellow',
				});
			} else if (connectionStatus === 'reconnecting') {
				statusItems.push({
					text: '↻ Backend',
					color: 'yellow',
				});
			} else if (connectionStatus === 'connected') {
				const instanceLabel = connectionInstanceName
					? `● ${connectionInstanceName}`
					: '● Backend';
				statusItems.push({
					text: instanceLabel,
					color: 'green',
				});
			}
		}

		// 代码库索引状态 - 显示错误或索引进度
		if ((codebaseIndexing || codebaseProgress?.error) && codebaseProgress) {
			if (codebaseProgress.error) {
				statusItems.push({
					text: codebaseProgress.error,
					color: 'yellow',
				});
			} else {
				statusItems.push({
					text: `◐ ${t.chatScreen.codebaseIndexingShort || '索引'} ${
						codebaseProgress.processedFiles
					}/${codebaseProgress.totalFiles}`,
					color: 'cyan',
				});
			}
		}

		// 文件监视器状态
		if (!codebaseIndexing && watcherEnabled) {
			statusItems.push({
				text: `☉ ${t.chatScreen.statusWatcherActiveShort || '监视'}`,
				color: 'green',
			});
		}

		// 文件更新通知
		if (fileUpdateNotification) {
			statusItems.push({
				text: `⛁ ${t.chatScreen.statusFileUpdatedShort || '已更新'}`,
				color: 'yellow',
			});
		}

		if (copyStatusMessage) {
			statusItems.push({
				text: copyStatusMessage.text,
				color: copyStatusMessage.isError
					? theme.colors.error
					: theme.colors.success,
			});
		}

		if (compressBlockToast) {
			statusItems.push({
				text: compressBlockToast,
				color: theme.colors.warning,
			});
		}

		statusItems.push({
			text: simpleMemoryStatusText,
			color: theme.colors.menuSecondary,
		});

		return (
			<Box flexDirection="column" paddingX={1} marginTop={1}>
				{/* Token信息单独一行 - 显示在最上方 */}
				{contextUsage && (
					<Box marginBottom={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{(() => {
								const isAnthropic =
									(contextUsage.cacheCreationTokens || 0) > 0 ||
									(contextUsage.cacheReadTokens || 0) > 0;
								const isOpenAI = (contextUsage.cachedTokens || 0) > 0;

								const percentage = calculateContextPercentage(contextUsage);

								const totalInputTokens = isAnthropic
									? contextUsage.inputTokens +
									  (contextUsage.cacheCreationTokens || 0) +
									  (contextUsage.cacheReadTokens || 0)
									: contextUsage.inputTokens;

								let color: string;
								if (percentage < 50) color = theme.colors.success;
								else if (percentage < 75) color = theme.colors.warning;
								else if (percentage < 90) color = theme.colors.warning;
								else color = theme.colors.error;

								const formatNumber = (num: number) => {
									if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
									return num.toString();
								};

								const hasCacheMetrics = isAnthropic || isOpenAI;

								return (
									<>
										<Text color={color}>{percentage.toFixed(1)}%</Text>
										<Text> · </Text>
										<Text color={color}>{formatNumber(totalInputTokens)}</Text>
										<Text>{t.chatScreen.tokens}</Text>
										{hasCacheMetrics && (
											<>
												<Text> · </Text>
												{isAnthropic && (
													<>
														{(contextUsage.cacheReadTokens || 0) > 0 && (
															<>
																<Text color={theme.colors.menuInfo}>
																	↯{' '}
																	{formatNumber(
																		contextUsage.cacheReadTokens || 0,
																	)}{' '}
																	{t.chatScreen.cached}
																</Text>
															</>
														)}
														{(contextUsage.cacheCreationTokens || 0) > 0 && (
															<>
																{(contextUsage.cacheReadTokens || 0) > 0 && (
																	<Text> · </Text>
																)}
																<Text color={theme.colors.warning}>
																	◆{' '}
																	{formatNumber(
																		contextUsage.cacheCreationTokens || 0,
																	)}{' '}
																	{t.chatScreen.newCache}
																</Text>
															</>
														)}
													</>
												)}
												{isOpenAI && (
													<Text color={theme.colors.menuInfo}>
														↯ {formatNumber(contextUsage.cachedTokens || 0)}{' '}
														{t.chatScreen.cached}
													</Text>
												)}
											</>
										)}
									</>
								);
							})()}
						</Text>
					</Box>
				)}

				{/* 状态信息行 */}
				{statusItems.length > 0 && (
					<Box>
						<Text dimColor>
							{statusItems.map((item, index) => (
								<React.Fragment key={index}>
									{index > 0 && (
										<Text color={theme.colors.menuSecondary}> | </Text>
									)}
									<Text color={item.color}>{item.text}</Text>
								</React.Fragment>
							))}
						</Text>
					</Box>
				)}
			</Box>
		);
	}

	return (
		<Box flexDirection="column" paddingX={1}>
			{/* Token使用信息 - 始终显示在第一行 */}
			{contextUsage && (
				<Box>
					<Text color={theme.colors.menuSecondary} dimColor>
						{(() => {
							const isAnthropic =
								(contextUsage.cacheCreationTokens || 0) > 0 ||
								(contextUsage.cacheReadTokens || 0) > 0;
							const isOpenAI = (contextUsage.cachedTokens || 0) > 0;

							const percentage = calculateContextPercentage(contextUsage);

							const totalInputTokens = isAnthropic
								? contextUsage.inputTokens +
								  (contextUsage.cacheCreationTokens || 0) +
								  (contextUsage.cacheReadTokens || 0)
								: contextUsage.inputTokens;

							let color: string;
							if (percentage < 50) color = theme.colors.success;
							else if (percentage < 75) color = theme.colors.warning;
							else if (percentage < 90) color = theme.colors.warning;
							else color = theme.colors.error;

							const formatNumber = (num: number) => {
								if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
								return num.toString();
							};

							const hasCacheMetrics = isAnthropic || isOpenAI;

							return (
								<>
									<Text color={color}>{percentage.toFixed(1)}%</Text>
									<Text> · </Text>
									<Text color={color}>{formatNumber(totalInputTokens)}</Text>
									<Text>{t.chatScreen.tokens}</Text>
									{hasCacheMetrics && (
										<>
											<Text> · </Text>
											{isAnthropic && (
												<>
													{(contextUsage.cacheReadTokens || 0) > 0 && (
														<>
															<Text color={theme.colors.menuInfo}>
																↯{' '}
																{formatNumber(
																	contextUsage.cacheReadTokens || 0,
																)}{' '}
																{t.chatScreen.cached}
															</Text>
														</>
													)}
													{(contextUsage.cacheCreationTokens || 0) > 0 && (
														<>
															{(contextUsage.cacheReadTokens || 0) > 0 && (
																<Text> · </Text>
															)}
															<Text color={theme.colors.warning}>
																◆{' '}
																{formatNumber(
																	contextUsage.cacheCreationTokens || 0,
																)}{' '}
																{t.chatScreen.newCache}
															</Text>
														</>
													)}
												</>
											)}
											{isOpenAI && (
												<Text color={theme.colors.menuInfo}>
													↯ {formatNumber(contextUsage.cachedTokens || 0)}{' '}
													{t.chatScreen.cached}
												</Text>
											)}
										</>
									)}
								</>
							);
						})()}
					</Text>
				</Box>
			)}

			{/* Profile显示 */}
			{currentProfileName && (
				<Box>
					<Text color={theme.colors.menuInfo} dimColor>
						ꚰ {t.chatScreen.profileCurrent}: {currentProfileName} |{' '}
						{getProfileShortcut()} {t.chatScreen.profileSwitchHint}
					</Text>
				</Box>
			)}

			<Box>
				<Text color={theme.colors.menuSecondary} dimColor>
					{detailedMemoryStatusText}
				</Text>
			</Box>

			{/* YOLO模式提示 */}
			{yoloMode && (
				<Box>
					<Text color={theme.colors.warning} dimColor>
						{t.chatScreen.yoloModeActive}
					</Text>
				</Box>
			)}

			{/* Plan模式提示 */}
			{planMode && (
				<Box>
					<Text color="#60A5FA" dimColor>
						{t.chatScreen.planModeActive}
					</Text>
				</Box>
			)}

			{/* Vulnerability Hunting 模式提示 */}
			{vulnerabilityHuntingMode && (
				<Box>
					<Text color="#EF4444" dimColor>
						{t.chatScreen.vulnerabilityHuntingModeActive}
					</Text>
				</Box>
			)}

			{/* Tool Search 开启提示 */}
			{!toolSearchDisabled && (
				<Box>
					<Text color={theme.colors.menuInfo} dimColor>
						{t.chatScreen.toolSearchEnabled}
					</Text>
				</Box>
			)}

			{/* IDE连接状态 */}
			{vscodeConnectionStatus &&
				(vscodeConnectionStatus === 'connecting' ||
					vscodeConnectionStatus === 'connected' ||
					vscodeConnectionStatus === 'error') && (
					<Box>
						<Text
							color={
								vscodeConnectionStatus === 'connecting'
									? 'yellow'
									: vscodeConnectionStatus === 'error'
									? 'gray'
									: 'green'
							}
							dimColor
						>
							{vscodeConnectionStatus === 'connecting' ? (
								<>
									<Spinner type="dots" /> {t.chatScreen.ideConnecting}
								</>
							) : vscodeConnectionStatus === 'error' ? (
								<>○ {t.chatScreen.ideError}</>
							) : (
								<>
									● {t.chatScreen.ideConnected}
									{editorContext?.activeFile &&
										t.chatScreen.ideActiveFile.replace(
											'{file}',
											smartTruncatePath(editorContext.activeFile, 40, false),
										)}
									{editorContext?.selectedText &&
										t.chatScreen.ideSelectedText.replace(
											'{count}',
											editorContext.selectedText.length.toString(),
										)}
								</>
							)}
						</Text>
					</Box>
				)}

			{/* 实例连接状态 - 只显示连接中或已连接，不显示断开 */}
			{connectionStatus &&
				(connectionStatus === 'connecting' ||
					connectionStatus === 'connected' ||
					connectionStatus === 'reconnecting') && (
					<Box>
						<Text
							color={
								connectionStatus === 'connecting' ||
								connectionStatus === 'reconnecting'
									? 'yellow'
									: 'green'
							}
							dimColor
						>
							{connectionStatus === 'connecting' ? (
								<>
									<Spinner type="dots" /> 正在连接后端服务...
								</>
							) : connectionStatus === 'reconnecting' ? (
								<>
									<Spinner type="dots" /> 正在重连后端服务...
								</>
							) : (
								<>
									● 已连接后端服务
									{connectionInstanceName && ` (${connectionInstanceName})`}
								</>
							)}
						</Text>
					</Box>
				)}

			{/* 代码库索引状态 - 显示错误或索引进度 */}
			{(codebaseIndexing || codebaseProgress?.error) && codebaseProgress && (
				<Box>
					{codebaseProgress.error ? (
						<Text color="red" dimColor>
							{codebaseProgress.error}
						</Text>
					) : (
						<Text color="cyan" dimColor>
							<Spinner type="dots" />{' '}
							{t.chatScreen.codebaseIndexing
								.replace(
									'{processed}',
									codebaseProgress.processedFiles.toString(),
								)
								.replace('{total}', codebaseProgress.totalFiles.toString())}
							{codebaseProgress.totalChunks > 0 &&
								` (${t.chatScreen.codebaseProgress.replace(
									'{chunks}',
									codebaseProgress.totalChunks.toString(),
								)})`}
						</Text>
					)}
				</Box>
			)}

			{/* 文件监视器状态 */}
			{!codebaseIndexing && watcherEnabled && (
				<Box>
					<Text color="green" dimColor>
						☉ {t.chatScreen.statusWatcherActive}
					</Text>
				</Box>
			)}

			{/* 文件更新通知 */}
			{fileUpdateNotification && (
				<Box>
					<Text color="yellow" dimColor>
						⛁{' '}
						{t.chatScreen.statusFileUpdated.replace(
							'{file}',
							fileUpdateNotification.file,
						)}
					</Text>
				</Box>
			)}

			{copyStatusMessage && (
				<Box>
					<Text
						color={
							copyStatusMessage.isError
								? theme.colors.error
								: theme.colors.success
						}
						dimColor
					>
						{copyStatusMessage.text}
					</Text>
				</Box>
			)}

			{compressBlockToast && (
				<Box>
					<Text color={theme.colors.warning} dimColor>
						{compressBlockToast}
					</Text>
				</Box>
			)}
		</Box>
	);
}
