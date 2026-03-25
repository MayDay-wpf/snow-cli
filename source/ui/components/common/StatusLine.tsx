import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {getSimpleMode} from '../../../utils/config/themeConfig.js';
import {smartTruncatePath} from '../../../utils/ui/messageFormatter.js';
import {
	loadProfile,
	getActiveProfileName,
} from '../../../utils/config/configManager.js';
import {useStatusLineHookItems} from './statusline/useStatusLineHooks.js';
import type {
	BackendConnectionStatus,
	StatusLineCodebaseProgress,
	StatusLineContextUsage,
	StatusLineContextWindowMetrics,
	StatusLineCopyStatusMessage,
	StatusLineEditorContext,
	StatusLineFileUpdateNotification,
	VSCodeConnectionStatus,
} from './statusline/types.js';

const MEMORY_REFRESH_INTERVAL_MS = 5000;
const PROCESS_MEMORY_COMMAND_TIMEOUT_MS = 1500;
const execFileAsync = promisify(execFile);
const WINDOWS_POWERSHELL_CANDIDATES = [
	'pwsh.exe',
	'powershell.exe',
	'pwsh',
	'powershell',
] as const;

// 根据平台返回快捷键显示文本: Windows/Linux使用 Alt+P, macOS使用 Ctrl+P
const getProfileShortcut = () =>
	process.platform === 'darwin' ? 'Ctrl+P' : 'Alt+P';

function getFallbackProcessMemoryUsageMb(): number {
	return Math.max(1, process.memoryUsage().rss / (1024 * 1024));
}

function parseMacosPhysicalFootprintMb(
	commandOutput: string,
): number | undefined {
	const match = commandOutput.match(
		/Physical footprint:\s+([0-9.]+)\s*([KMGT])/i,
	);
	const valueText = match?.[1];
	const unit = match?.[2]?.toUpperCase();
	if (!valueText || !unit) {
		return undefined;
	}

	const value = Number.parseFloat(valueText);
	if (!Number.isFinite(value)) {
		return undefined;
	}

	switch (unit) {
		case 'T': {
			return value * 1024 * 1024;
		}
		case 'G': {
			return value * 1024;
		}
		case 'M': {
			return value;
		}
		case 'K': {
			return value / 1024;
		}
		default: {
			return undefined;
		}
	}
}

function parseWindowsMemoryUsageMb(commandOutput: string): number | undefined {
	const valueText = commandOutput.trim();
	if (valueText.length === 0) {
		return undefined;
	}

	const value = Number.parseInt(valueText, 10);
	if (!Number.isFinite(value)) {
		return undefined;
	}

	return Math.max(1, value / (1024 * 1024));
}

async function getMacosProcessMemoryUsageMb(): Promise<number | undefined> {
	try {
		// macOS 活动监视器更接近 physical footprint，而不是 RSS。
		const {stdout} = await execFileAsync(
			'vmmap',
			['-summary', String(process.pid)],
			{
				timeout: PROCESS_MEMORY_COMMAND_TIMEOUT_MS,
				maxBuffer: 1024 * 1024,
			},
		);
		return parseMacosPhysicalFootprintMb(stdout);
	} catch {
		return undefined;
	}
}

async function getWindowsProcessMemoryUsageMb(): Promise<number | undefined> {
	const script = [
		"$ErrorActionPreference = 'Stop'",
		`$process = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -Filter \"IDProcess = ${process.pid}\" -ErrorAction SilentlyContinue`,
		'if ($null -ne $process -and $null -ne $process.WorkingSetPrivate) { [Console]::Out.Write([string]$process.WorkingSetPrivate); return }',
		`$fallback = Get-Process -Id ${process.pid} -ErrorAction Stop`,
		'[Console]::Out.Write([string]$fallback.PrivateMemorySize64)',
	].join('; ');

	for (const shell of WINDOWS_POWERSHELL_CANDIDATES) {
		try {
			const {stdout} = await execFileAsync(
				shell,
				['-NoProfile', '-Command', script],
				{
					timeout: PROCESS_MEMORY_COMMAND_TIMEOUT_MS,
					maxBuffer: 1024 * 1024,
				},
			);
			const memoryUsageMb = parseWindowsMemoryUsageMb(stdout);
			if (memoryUsageMb !== undefined) {
				return memoryUsageMb;
			}
		} catch {}
	}

	return undefined;
}

async function getCurrentProcessMemoryUsageMb(): Promise<number> {
	if (process.platform === 'darwin') {
		const memoryUsageMb = await getMacosProcessMemoryUsageMb();
		if (memoryUsageMb !== undefined) {
			return Math.max(1, memoryUsageMb);
		}
	}

	if (process.platform === 'win32') {
		const memoryUsageMb = await getWindowsProcessMemoryUsageMb();
		if (memoryUsageMb !== undefined) {
			return Math.max(1, memoryUsageMb);
		}
	}

	return getFallbackProcessMemoryUsageMb();
}

function formatMemoryUsage(memoryUsageMb: number): string {
	if (memoryUsageMb >= 1024) {
		return `${(memoryUsageMb / 1024).toFixed(2)} GB`;
	}

	return `${memoryUsageMb.toFixed(0)} MB`;
}

function useCurrentProcessMemoryUsage(): number {
	const [memoryUsageMb, setMemoryUsageMb] = React.useState(() =>
		getFallbackProcessMemoryUsageMb(),
	);

	React.useEffect(() => {
		let disposed = false;
		let isRefreshing = false;

		const refreshMemoryUsage = async () => {
			if (isRefreshing) {
				return;
			}

			isRefreshing = true;
			try {
				const nextMemoryUsageMb = await getCurrentProcessMemoryUsageMb();
				if (!disposed) {
					setMemoryUsageMb(nextMemoryUsageMb);
				}
			} finally {
				isRefreshing = false;
			}
		};

		void refreshMemoryUsage();
		const timer = setInterval(() => {
			void refreshMemoryUsage();
		}, MEMORY_REFRESH_INTERVAL_MS);

		return () => {
			disposed = true;
			clearInterval(timer);
		};
	}, []);

	return memoryUsageMb;
}

type Props = {
	// 模式信息
	yoloMode?: boolean;
	planMode?: boolean;
	vulnerabilityHuntingMode?: boolean;
	toolSearchDisabled?: boolean;
	hybridCompressEnabled?: boolean;
	teamMode?: boolean;

	// IDE连接信息
	vscodeConnectionStatus?: VSCodeConnectionStatus;
	editorContext?: StatusLineEditorContext;

	// 实例连接信息
	connectionStatus?: BackendConnectionStatus;
	connectionInstanceName?: string;

	// Token消耗信息
	contextUsage?: StatusLineContextUsage;

	// 代码库索引状态
	codebaseIndexing?: boolean;
	codebaseProgress?: StatusLineCodebaseProgress | null;

	// 文件监视器状态
	watcherEnabled?: boolean;
	fileUpdateNotification?: StatusLineFileUpdateNotification | null;
	copyStatusMessage?: StatusLineCopyStatusMessage | null;

	// Profile 信息
	currentProfileName?: string;

	// 自动压缩禁止中断提示
	compressBlockToast?: string | null;
};

function calculateContextPercentage(
	contextUsage: StatusLineContextUsage,
): number {
	const hasAnthropicCache =
		(contextUsage.cacheCreationTokens || 0) > 0 ||
		(contextUsage.cacheReadTokens || 0) > 0;

	const totalInputTokens = hasAnthropicCache
		? contextUsage.inputTokens +
		  (contextUsage.cacheCreationTokens || 0) +
		  (contextUsage.cacheReadTokens || 0)
		: contextUsage.inputTokens;

	return Math.min(
		100,
		(totalInputTokens / contextUsage.maxContextTokens) * 100,
	);
}

function buildContextWindowState(
	contextUsage: StatusLineContextUsage,
): StatusLineContextUsage & StatusLineContextWindowMetrics {
	const hasAnthropicCache =
		(contextUsage.cacheCreationTokens || 0) > 0 ||
		(contextUsage.cacheReadTokens || 0) > 0;
	const hasOpenAICache = (contextUsage.cachedTokens || 0) > 0;
	const totalInputTokens = hasAnthropicCache
		? contextUsage.inputTokens +
		  (contextUsage.cacheCreationTokens || 0) +
		  (contextUsage.cacheReadTokens || 0)
		: contextUsage.inputTokens;

	return {
		...contextUsage,
		percentage: calculateContextPercentage(contextUsage),
		totalInputTokens,
		hasAnthropicCache,
		hasOpenAICache,
		hasAnyCache: hasAnthropicCache || hasOpenAICache,
	};
}

export default function StatusLine({
	yoloMode = false,
	planMode = false,
	vulnerabilityHuntingMode = false,
	toolSearchDisabled = true,
	hybridCompressEnabled = false,
	teamMode = false,
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
	const {t, language} = useI18n();
	const {theme} = useTheme();
	const simpleMode = getSimpleMode();
	const memoryUsageMb = useCurrentProcessMemoryUsage();
	const formattedMemoryUsage = formatMemoryUsage(memoryUsageMb);
	const contextWindowState = React.useMemo(
		() => (contextUsage ? buildContextWindowState(contextUsage) : undefined),
		[contextUsage],
	);

	// 获取当前 profile 的完整配置（不含 apiKey）
	const profileConfig = React.useMemo(() => {
		const profileName = currentProfileName ?? getActiveProfileName();
		return loadProfile(profileName);
	}, [currentProfileName]);

	const statusLineHookContext = React.useMemo(() => {
		const cfg = profileConfig?.snowcfg;
		return {
			cwd: process.cwd(),
			platform: process.platform,
			language,
			simpleMode,
			labels: {
				gitBranch: t.chatScreen.gitBranch,
			},
			system: {
				memory: {
					usageMb: memoryUsageMb,
					formattedUsage: formattedMemoryUsage,
				},
				modes: {
					yolo: yoloMode,
					plan: planMode,
					vulnerabilityHunting: vulnerabilityHuntingMode,
					toolSearchEnabled: !toolSearchDisabled,
					hybridCompress: hybridCompressEnabled,
					team: teamMode,
					simple: simpleMode,
				},
				ide: {
					connectionStatus: vscodeConnectionStatus ?? 'disconnected',
					editorContext,
					selectedTextLength: editorContext?.selectedText?.length ?? 0,
				},
				backend: {
					connectionStatus: connectionStatus ?? 'disconnected',
					instanceName: connectionInstanceName,
				},
				contextWindow: contextWindowState,
				codebase: {
					indexing: codebaseIndexing,
					progress: codebaseProgress,
				},
				watcher: {
					enabled: watcherEnabled,
					fileUpdateNotification,
				},
				clipboard: copyStatusMessage,
				profile: {
					currentName: currentProfileName,
					baseUrl: cfg?.baseUrl,
					requestMethod: cfg?.requestMethod,
					advancedModel: cfg?.advancedModel,
					basicModel: cfg?.basicModel,
					maxContextTokens: cfg?.maxContextTokens,
					maxTokens: cfg?.maxTokens,
					anthropicBeta: cfg?.anthropicBeta,
					anthropicCacheTTL: cfg?.anthropicCacheTTL,
					thinkingEnabled: cfg?.thinking?.type === 'enabled',
					thinkingType: cfg?.thinking?.type,
					thinkingBudgetTokens: cfg?.thinking?.budget_tokens,
					thinkingEffort: cfg?.thinking?.effort,
					geminiThinkingEnabled: cfg?.geminiThinking?.enabled,
					geminiThinkingBudget: cfg?.geminiThinking?.budget,
					responsesReasoningEnabled: cfg?.responsesReasoning?.enabled,
					responsesReasoningEffort: cfg?.responsesReasoning?.effort,
					responsesFastMode: cfg?.responsesFastMode,
					responsesVerbosity: cfg?.responsesVerbosity,
					anthropicSpeed: cfg?.anthropicSpeed,
					enablePromptOptimization: cfg?.enablePromptOptimization,
					enableAutoCompress: cfg?.enableAutoCompress,
					autoCompressThreshold: cfg?.autoCompressThreshold,
					showThinking: cfg?.showThinking,
					streamIdleTimeoutSec: cfg?.streamIdleTimeoutSec,
					systemPromptId: cfg?.systemPromptId,
					customHeadersSchemeId: cfg?.customHeadersSchemeId,
					editSimilarityThreshold: cfg?.editSimilarityThreshold,
					toolResultTokenLimit: cfg?.toolResultTokenLimit,
					streamingDisplay: cfg?.streamingDisplay,
				},
				compression: {
					blockToast: compressBlockToast,
				},
			},
		};
	}, [
		codebaseIndexing,
		codebaseProgress,
		compressBlockToast,
		connectionInstanceName,
		connectionStatus,
		contextWindowState,
		copyStatusMessage,
		currentProfileName,
		editorContext,
		fileUpdateNotification,
		formattedMemoryUsage,
		language,
		memoryUsageMb,
		planMode,
		profileConfig,
		simpleMode,
		t.chatScreen.gitBranch,
		toolSearchDisabled,
		hybridCompressEnabled,
		teamMode,
		vscodeConnectionStatus,
		vulnerabilityHuntingMode,
		watcherEnabled,
		yoloMode,
	]);
	const statusLineHookItems = useStatusLineHookItems(statusLineHookContext);

	const simpleMemoryStatusText = `⛁ ${formattedMemoryUsage}`;
	const detailedMemoryStatusText = `⛁ ${t.chatScreen.memoryUsageLabel} ${formattedMemoryUsage}`;

	const renderContextUsage = () => {
		if (!contextWindowState) {
			return null;
		}

		const {
			percentage,
			totalInputTokens,
			hasAnthropicCache,
			hasOpenAICache,
			hasAnyCache,
			cacheReadTokens = 0,
			cacheCreationTokens = 0,
			cachedTokens = 0,
		} = contextWindowState;

		let color: string;
		if (percentage < 50) color = theme.colors.success;
		else if (percentage < 75) color = theme.colors.warning;
		else if (percentage < 90) color = theme.colors.warning;
		else color = theme.colors.error;

		const formatNumber = (num: number) => {
			if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
			return num.toString();
		};

		return (
			<Text color={theme.colors.menuSecondary} dimColor>
				<Text color={color}>{percentage.toFixed(1)}%</Text>
				<Text> · </Text>
				<Text color={color}>{formatNumber(totalInputTokens)}</Text>
				<Text>{t.chatScreen.tokens}</Text>
				{hasAnyCache && (
					<>
						<Text> · </Text>
						{hasAnthropicCache && (
							<>
								{cacheReadTokens > 0 && (
									<Text color={theme.colors.menuInfo}>
										↯ {formatNumber(cacheReadTokens)} {t.chatScreen.cached}
									</Text>
								)}
								{cacheCreationTokens > 0 && (
									<>
										{cacheReadTokens > 0 && <Text> · </Text>}
										<Text color={theme.colors.warning}>
											◆ {formatNumber(cacheCreationTokens)}{' '}
											{t.chatScreen.newCache}
										</Text>
									</>
								)}
							</>
						)}
						{hasOpenAICache && (
							<Text color={theme.colors.menuInfo}>
								↯ {formatNumber(cachedTokens)} {t.chatScreen.cached}
							</Text>
						)}
					</>
				)}
			</Text>
		);
	};

	// 是否显示任何状态信息
	const hasAnyStatus =
		yoloMode ||
		planMode ||
		vulnerabilityHuntingMode ||
		teamMode ||
		!toolSearchDisabled ||
		hybridCompressEnabled ||
		(vscodeConnectionStatus && vscodeConnectionStatus !== 'disconnected') ||
		(connectionStatus && connectionStatus !== 'disconnected') ||
		contextUsage ||
		codebaseIndexing ||
		watcherEnabled ||
		fileUpdateNotification ||
		copyStatusMessage ||
		currentProfileName ||
		compressBlockToast ||
		statusLineHookItems.length > 0 ||
		detailedMemoryStatusText;

	if (!hasAnyStatus) {
		return null;
	}

	// 简易模式：横向单行显示状态，Token信息单独一行
	if (simpleMode) {
		const statusItems: Array<{text: string; color: string}> = [];

		if (currentProfileName) {
			statusItems.push({
				text: `ꚰ ${currentProfileName}`,
				color: theme.colors.menuInfo,
			});
		}

		for (const item of statusLineHookItems) {
			statusItems.push({
				text: item.text,
				color: item.color || theme.colors.menuSecondary,
			});
		}

		if (yoloMode) {
			statusItems.push({text: '❁ YOLO', color: theme.colors.warning});
		}

		if (planMode) {
			statusItems.push({text: '⚐ Plan', color: '#60A5FA'});
		}

		if (vulnerabilityHuntingMode) {
			statusItems.push({text: '⍨ Vuln Hunt', color: '#de409aff'});
		}

		if (!toolSearchDisabled) {
			statusItems.push({
				text: '♾︎ ToolSearch ON',
				color: theme.colors.menuInfo,
			});
		}

		if (teamMode) {
			statusItems.push({text: '⚑ Team', color: '#10B981'});
		}

		if (hybridCompressEnabled) {
			statusItems.push({
				text: '⇌ Hybrid Compress',
				color: theme.colors.menuInfo,
			});
		}

		if (vscodeConnectionStatus && vscodeConnectionStatus !== 'disconnected') {
			if (vscodeConnectionStatus === 'connecting') {
				statusItems.push({text: '◐ IDE', color: 'yellow'});
			} else if (vscodeConnectionStatus === 'connected') {
				statusItems.push({text: '● IDE', color: 'green'});
			} else if (vscodeConnectionStatus === 'error') {
				statusItems.push({text: '○ IDE', color: 'gray'});
			}
		}

		if (connectionStatus && connectionStatus !== 'disconnected') {
			if (connectionStatus === 'connecting') {
				statusItems.push({text: '◐ Backend', color: 'yellow'});
			} else if (connectionStatus === 'reconnecting') {
				statusItems.push({text: '↻ Backend', color: 'yellow'});
			} else if (connectionStatus === 'connected') {
				const instanceLabel = connectionInstanceName
					? `● ${connectionInstanceName}`
					: '● Backend';
				statusItems.push({text: instanceLabel, color: 'green'});
			}
		}

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

		if (!codebaseIndexing && watcherEnabled) {
			statusItems.push({
				text: `☉ ${t.chatScreen.statusWatcherActiveShort || '监视'}`,
				color: 'green',
			});
		}

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
				{contextUsage && <Box marginBottom={1}>{renderContextUsage()}</Box>}
				{statusItems.length > 0 && (
					<Box>
						<Text dimColor>
							{statusItems.map((item, index) => (
								<React.Fragment key={`${item.text}-${index}`}>
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
			{contextUsage && <Box>{renderContextUsage()}</Box>}

			{currentProfileName && (
				<Box>
					<Text color={theme.colors.menuInfo} dimColor>
						ꚰ {t.chatScreen.profileCurrent}: {currentProfileName} |{' '}
						{getProfileShortcut()} {t.chatScreen.profileSwitchHint}
					</Text>
				</Box>
			)}

			{statusLineHookItems.map(item => (
				<Box key={item.id}>
					<Text color={item.color || theme.colors.menuSecondary} dimColor>
						{item.detailedText || item.text}
					</Text>
				</Box>
			))}

			<Box>
				<Text color={theme.colors.menuSecondary} dimColor>
					{detailedMemoryStatusText}
				</Text>
			</Box>

			{yoloMode && (
				<Box>
					<Text color={theme.colors.warning} dimColor>
						{t.chatScreen.yoloModeActive}
					</Text>
				</Box>
			)}

			{planMode && (
				<Box>
					<Text color="#60A5FA" dimColor>
						{t.chatScreen.planModeActive}
					</Text>
				</Box>
			)}

			{vulnerabilityHuntingMode && (
				<Box>
					<Text color="#EF4444" dimColor>
						{t.chatScreen.vulnerabilityHuntingModeActive}
					</Text>
				</Box>
			)}

			{!toolSearchDisabled && (
				<Box>
					<Text color={theme.colors.menuInfo} dimColor>
						{t.chatScreen.toolSearchEnabled}
					</Text>
				</Box>
			)}

			{teamMode && (
				<Box>
					<Text color="#10B981" dimColor>
						{t.chatScreen.teamModeActive}
					</Text>
				</Box>
			)}

			{hybridCompressEnabled && (
				<Box>
					<Text color={theme.colors.menuInfo} dimColor>
						{t.chatScreen.hybridCompressEnabled}
					</Text>
				</Box>
			)}

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

			{!codebaseIndexing && watcherEnabled && (
				<Box>
					<Text color="green" dimColor>
						☉ {t.chatScreen.statusWatcherActive}
					</Text>
				</Box>
			)}

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
