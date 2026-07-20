import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import React, {useSyncExternalStore} from 'react';
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
import {readSettings} from '../../../utils/config/unifiedSettings.js';
import {configEvents} from '../../../utils/config/configEvents.js';
import {useStatusLineHookItems} from './statusline/useStatusLineHooks.js';
import {BUILTIN_STATUSLINE_IDS} from './statusline/builtinIds.js';
import {
	tpsTracker,
	subscribeTpsTracker,
	getTpsTrackerSnapshot,
} from '../../../hooks/conversation/core/tpsTracker.js';
import type {
	BackendConnectionStatus,
	StatusLineCodebaseProgress,
	StatusLineContextUsage,
	StatusLineContextWindowMetrics,
	StatusLineCopyStatusMessage,
	StatusLineEditorContext,
	StatusLineFileUpdateNotification,
	StatusLinePrivacyState,
	VSCodeConnectionStatus,
} from './statusline/types.js';
import {GradientText} from './statusline/GradientText.js';
import {formatTokens, pctColorName} from '../../utils/formatTokens.js';

const MEMORY_REFRESH_INTERVAL_MS = 5000;
const PROCESS_MEMORY_COMMAND_TIMEOUT_MS = 1500;
const execFileAsync = promisify(execFile);
const TELEMETRY_STATUS_ICON = '⌁';
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
	imageCompressEnabled?: boolean;
	teamMode?: boolean;
	ultraTodoEnabled?: boolean;
	telemetryEnabled?: boolean;

	// IDE连接信息
	vscodeConnectionStatus?: VSCodeConnectionStatus;
	editorContext?: StatusLineEditorContext;

	// 实例连接信息
	connectionStatus?: BackendConnectionStatus;
	connectionInstanceName?: string;

	// 词元消耗信息
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

function pickProjectFirst<T>(
	projectValue: T | undefined,
	globalValue: T | undefined,
): T | undefined {
	return projectValue !== undefined ? projectValue : globalValue;
}

function buildPrivacyState(
	workingDirectory = process.cwd(),
): StatusLinePrivacyState {
	const globalSettings = readSettings('global');
	const projectSettings = readSettings('project', workingDirectory);
	const globalPrivacy = globalSettings.privacy;
	const projectPrivacy = projectSettings.privacy;
	const enabled = pickProjectFirst(
		projectPrivacy?.enabled,
		globalPrivacy?.enabled,
	);
	const mode =
		pickProjectFirst(projectPrivacy?.mode, globalPrivacy?.mode) ?? 'api';
	const apiUrl = pickProjectFirst(
		projectPrivacy?.api?.url,
		globalPrivacy?.api?.url,
	)?.trim();
	const model = pickProjectFirst(
		projectPrivacy?.api?.model,
		globalPrivacy?.api?.model,
	)?.trim();
	const toolResultTools =
		pickProjectFirst(
			projectPrivacy?.toolResults?.tools,
			globalPrivacy?.toolResults?.tools,
		) ?? [];

	return {
		configured: Boolean(projectPrivacy || globalPrivacy),
		enabled: enabled === true,
		mode,
		apiUrlConfigured: Boolean(apiUrl),
		apiUrl: mode === 'api' ? apiUrl || undefined : undefined,
		model: model || undefined,
		toolResultTools: [...toolResultTools],
	};
}

export default function StatusLine({
	yoloMode = false,
	planMode = false,
	vulnerabilityHuntingMode = false,
	toolSearchDisabled = true,
	hybridCompressEnabled = false,
	imageCompressEnabled = false,
	teamMode = false,
	ultraTodoEnabled = false,
	telemetryEnabled = false,
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
	// 订阅 TPS 追踪器，测速仪启用时每秒更新
	const tpsSnapshot = useSyncExternalStore(
		subscribeTpsTracker,
		getTpsTrackerSnapshot,
	);
	const contextWindowState = React.useMemo(
		() => (contextUsage ? buildContextWindowState(contextUsage) : undefined),
		[contextUsage],
	);
	const [privacyRevision, setPrivacyRevision] = React.useState(0);
	React.useEffect(() => {
		const handleConfigChange = (event: {type: string; value: any}) => {
			if (event.type === 'privacy') {
				setPrivacyRevision(prev => prev + 1);
			}
		};
		configEvents.onConfigChange(handleConfigChange);
		return () => {
			configEvents.removeConfigChangeListener(handleConfigChange);
		};
	}, []);
	const privacyState = React.useMemo(
		() => buildPrivacyState(),
		[privacyRevision],
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
					imageCompress: imageCompressEnabled,
					team: teamMode,
					ultraTodo: ultraTodoEnabled,
					telemetry: telemetryEnabled,
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
				privacy: privacyState,
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
					thinkingEnabled:
						cfg?.thinking?.type === 'enabled' ||
						cfg?.thinking?.type === 'adaptive',
					thinkingType: cfg?.thinking?.type,
					thinkingBudgetTokens: cfg?.thinking?.budget_tokens,
					thinkingEffort: cfg?.thinking?.effort,
					geminiThinkingEnabled: cfg?.geminiThinking?.enabled,
					geminiThinkingLevel: cfg?.geminiThinking?.thinkingLevel,
					responsesReasoningEnabled: cfg?.responsesReasoning?.enabled,
					responsesReasoningEffort: cfg?.responsesReasoning?.effort,
					chatThinkingEnabled: cfg?.chatThinking?.enabled,
					chatReasoningEffort: cfg?.chatThinking?.reasoning_effort,
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
					toolResultTokenLimit: cfg?.toolResultTokenLimit,
					streamingDisplay: cfg?.streamingDisplay,
				},
				compression: {
					blockToast: compressBlockToast,
				},
				speedometer: {
					enabled: tpsTracker.isActive(),
					tps: tpsSnapshot.tps,
					peakTps: tpsSnapshot.peakTps,
					ttftMs: tpsSnapshot.ttftMs,
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
		privacyState,
		profileConfig,
		simpleMode,
		t.chatScreen.gitBranch,
		toolSearchDisabled,
		hybridCompressEnabled,
		teamMode,
		vscodeConnectionStatus,
		vulnerabilityHuntingMode,
		watcherEnabled,
		ultraTodoEnabled,
		telemetryEnabled,
		yoloMode,
		tpsSnapshot,
	]);
	const {items: statusLineHookItems, externalHookIds} = useStatusLineHookItems(
		statusLineHookContext,
	);
	const isBuiltinOverridden = React.useCallback(
		(id: string) => externalHookIds.has(id),
		[externalHookIds],
	);

	const simpleMemoryStatusText = `⛁ ${formattedMemoryUsage}`;
	const detailedMemoryStatusText = `⛁ ${t.chatScreen.memoryUsageLabel} ${formattedMemoryUsage}`;

	const renderContextUsage = () => {
		if (!contextWindowState) {
			return null;
		}

		const {
			percentage,
			totalInputTokens,
			maxContextTokens,
			hasAnthropicCache,
			hasOpenAICache,
			hasAnyCache,
			cacheReadTokens = 0,
			cacheCreationTokens = 0,
			cachedTokens = 0,
		} = contextWindowState as StatusLineContextUsage &
			StatusLineContextWindowMetrics & {maxContextTokens?: number};

		const colorKey = pctColorName(percentage);
		const color = theme.colors[colorKey];
		const maxLabel =
			typeof maxContextTokens === 'number' && maxContextTokens > 0
				? formatTokens(maxContextTokens, true)
				: null;

		return (
			<Text color={theme.colors.menuSecondary} dimColor>
				<Text color={color} bold>
					{percentage.toFixed(1)}%
				</Text>
				<Text> · </Text>
				<Text color={color}>{formatTokens(totalInputTokens, true)}</Text>
				{maxLabel ? (
					<Text color={theme.colors.menuSecondary}>/{maxLabel}</Text>
				) : (
					<Text>{t.chatScreen.tokens}</Text>
				)}
				{hasAnyCache && (
					<>
						<Text> · </Text>
						{hasAnthropicCache && (
							<>
								{cacheReadTokens > 0 && (
									<Text color={theme.colors.menuInfo}>
										↯ {formatTokens(cacheReadTokens, true)}{' '}
										{t.chatScreen.cached}
									</Text>
								)}
								{cacheCreationTokens > 0 && (
									<>
										{cacheReadTokens > 0 && <Text> · </Text>}
										<Text color={theme.colors.warning}>
											◆ {formatTokens(cacheCreationTokens, true)}{' '}
											{t.chatScreen.newCache}
										</Text>
									</>
								)}
							</>
						)}
						{hasOpenAICache && (
							<Text color={theme.colors.menuInfo}>
								↯ {formatTokens(cachedTokens, true)} {t.chatScreen.cached}
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
		ultraTodoEnabled ||
		!toolSearchDisabled ||
		hybridCompressEnabled ||
		imageCompressEnabled ||
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
		detailedMemoryStatusText ||
		tpsTracker.isActive();

	if (!hasAnyStatus) {
		return null;
	}

	// 简易模式：横向单行显示状态，词元信息单独一行
	if (simpleMode) {
		const statusItems: Array<{
			text: string;
			color: string;
			gradient?: string[];
		}> = [];

		if (
			currentProfileName &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.profile)
		) {
			statusItems.push({
				text: `§ ${currentProfileName}`,
				color: theme.colors.menuInfo,
			});
		}

		for (const item of statusLineHookItems) {
			statusItems.push({
				text: item.text,
				color: item.color || theme.colors.menuSecondary,
				gradient: item.gradient,
			});
		}

		if (yoloMode && !isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modeYolo)) {
			statusItems.push({text: '⧴ YOLO', color: theme.colors.warning});
		}

		if (planMode && !isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modePlan)) {
			statusItems.push({text: '⚐ Plan', color: '#60A5FA'});
		}

		if (
			vulnerabilityHuntingMode &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modeHunt)
		) {
			statusItems.push({text: '⍨ Vuln Hunt', color: '#de409aff'});
		}

		if (
			!toolSearchDisabled &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.toolSearch)
		) {
			statusItems.push({
				text: '♾︎ ToolSearch ON',
				color: theme.colors.menuInfo,
			});
		}

		if (teamMode && !isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modeTeam)) {
			statusItems.push({text: '⚑ Team', color: '#10B981'});
		}

		if (
			ultraTodoEnabled &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modeUltraTodo)
		) {
			statusItems.push({text: '◈ Ultra TODO', color: '#A78BFA'});
		}

		if (
			telemetryEnabled &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.telemetry)
		) {
			statusItems.push({
				text: `${TELEMETRY_STATUS_ICON} OTel`,
				color: theme.colors.menuInfo,
			});
		}

		if (
			hybridCompressEnabled &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.hybridCompress)
		) {
			statusItems.push({
				text: '⇌ Hybrid Compress',
				color: theme.colors.menuInfo,
			});
		}

		if (
			imageCompressEnabled &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.imageCompress)
		) {
			statusItems.push({
				text: '🖼 Image Compress',
				color: theme.colors.menuInfo,
			});
		}

		if (
			vscodeConnectionStatus &&
			vscodeConnectionStatus !== 'disconnected' &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.ideConnection)
		) {
			if (vscodeConnectionStatus === 'connecting') {
				statusItems.push({text: '◐ IDE', color: 'yellow'});
			} else if (vscodeConnectionStatus === 'connected') {
				statusItems.push({text: '● IDE', color: 'green'});
			} else if (vscodeConnectionStatus === 'error') {
				statusItems.push({text: '○ IDE', color: 'gray'});
			}
		}

		if (
			connectionStatus &&
			connectionStatus !== 'disconnected' &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.backendConnection)
		) {
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

		if (
			(codebaseIndexing || codebaseProgress?.error) &&
			codebaseProgress &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.codebaseIndexing)
		) {
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

		if (
			!codebaseIndexing &&
			watcherEnabled &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.watcher)
		) {
			statusItems.push({
				text: `☉ ${t.chatScreen.statusWatcherActiveShort || '监视'}`,
				color: 'green',
			});
		}

		if (
			fileUpdateNotification &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.fileUpdate)
		) {
			statusItems.push({
				text: `⛁ ${t.chatScreen.statusFileUpdatedShort || '已更新'}`,
				color: 'yellow',
			});
		}

		if (
			copyStatusMessage &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.copyStatus)
		) {
			statusItems.push({
				text: copyStatusMessage.text,
				color: copyStatusMessage.isError
					? theme.colors.error
					: theme.colors.success,
			});
		}

		if (
			compressBlockToast &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.compressBlock)
		) {
			statusItems.push({
				text: compressBlockToast,
				color: theme.colors.warning,
			});
		}

		if (!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.memory)) {
			statusItems.push({
				text: simpleMemoryStatusText,
				color: theme.colors.menuSecondary,
			});
		}

		if (
			tpsTracker.isActive() &&
			!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.speedometer)
		) {
			let speedometerText = `⏱ ${tpsSnapshot.tps} tok/s`;
			if (tpsSnapshot.ttftMs !== null) {
				const ttftSec = (tpsSnapshot.ttftMs / 1000).toFixed(1);
				speedometerText += ` · ttft ${ttftSec}s`;
			}
			statusItems.push({
				text: speedometerText,
				color:
					tpsSnapshot.tps > 0 ? theme.colors.cyan : theme.colors.menuSecondary,
			});
		}

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
									<GradientText
										text={item.text}
										color={item.color}
										gradient={item.gradient}
										dimColor
									/>
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

			{currentProfileName &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.profile) && (
					<Box>
						<Text color={theme.colors.menuInfo} dimColor>
							§ {t.chatScreen.profileCurrent}: {currentProfileName} |{' '}
							{getProfileShortcut()} {t.chatScreen.profileSwitchHint}
						</Text>
					</Box>
				)}

			{statusLineHookItems.map(item => (
				<Box key={item.id}>
					<GradientText
						text={item.detailedText || item.text}
						color={item.color || theme.colors.menuSecondary}
						gradient={item.gradient}
						dimColor
					/>
				</Box>
			))}

			{!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.memory) && (
				<Box>
					<Text color={theme.colors.menuSecondary} dimColor>
						{detailedMemoryStatusText}
					</Text>
				</Box>
			)}

			{tpsTracker.isActive() &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.speedometer) && (
					<Box>
						<Text color={theme.colors.menuSecondary} dimColor>
							⏱ {t.chatScreen.speedometerLabel || 'tps'}:{' '}
							<Text
								color={
									tpsSnapshot.tps > 0
										? theme.colors.cyan
										: theme.colors.menuSecondary
								}
								bold
							>
								{tpsSnapshot.tps}
							</Text>
							{' tok/s'}
							{' · peak '}
							<Text color={theme.colors.warning}>{tpsSnapshot.peakTps}</Text>
							{tpsSnapshot.ttftMs !== null && (
								<>
									{' · ttft '}
									<Text color={theme.colors.menuInfo}>
										{(tpsSnapshot.ttftMs / 1000).toFixed(1)}s
									</Text>
								</>
							)}
						</Text>
					</Box>
				)}

			{yoloMode && !isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modeYolo) && (
				<Box>
					<Text color={theme.colors.warning} dimColor>
						{t.chatScreen.yoloModeActive}
					</Text>
				</Box>
			)}

			{planMode && !isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modePlan) && (
				<Box>
					<Text color="#60A5FA" dimColor>
						{t.chatScreen.planModeActive}
					</Text>
				</Box>
			)}

			{vulnerabilityHuntingMode &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modeHunt) && (
					<Box>
						<Text color="#EF4444" dimColor>
							{t.chatScreen.vulnerabilityHuntingModeActive}
						</Text>
					</Box>
				)}

			{!toolSearchDisabled &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.toolSearch) && (
					<Box>
						<Text color={theme.colors.menuInfo} dimColor>
							{t.chatScreen.toolSearchEnabled}
						</Text>
					</Box>
				)}

			{teamMode && !isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modeTeam) && (
				<Box>
					<Text color="#10B981" dimColor>
						{t.chatScreen.teamModeActive}
					</Text>
				</Box>
			)}

			{ultraTodoEnabled &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.modeUltraTodo) && (
					<Box>
						<Text color="#A78BFA" dimColor>
							{t.chatScreen.ultraTodoActive}
						</Text>
					</Box>
				)}

			{telemetryEnabled &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.telemetry) && (
					<Box>
						<Text color={theme.colors.menuInfo} dimColor>
							{TELEMETRY_STATUS_ICON} {t.chatScreen.telemetryActive}
						</Text>
					</Box>
				)}

			{hybridCompressEnabled &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.hybridCompress) && (
					<Box>
						<Text color={theme.colors.menuInfo} dimColor>
							{t.chatScreen.hybridCompressEnabled}
						</Text>
					</Box>
				)}

			{imageCompressEnabled &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.imageCompress) && (
					<Box>
						<Text color={theme.colors.menuInfo} dimColor>
							{t.chatScreen.imageCompressEnabled}
						</Text>
					</Box>
				)}

			{vscodeConnectionStatus &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.ideConnection) &&
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
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.backendConnection) &&
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

			{(codebaseIndexing || codebaseProgress?.error) &&
				codebaseProgress &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.codebaseIndexing) && (
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

			{!codebaseIndexing &&
				watcherEnabled &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.watcher) && (
					<Box>
						<Text color="green" dimColor>
							☉ {t.chatScreen.statusWatcherActive}
						</Text>
					</Box>
				)}

			{fileUpdateNotification &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.fileUpdate) && (
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

			{copyStatusMessage &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.copyStatus) && (
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

			{compressBlockToast &&
				!isBuiltinOverridden(BUILTIN_STATUSLINE_IDS.compressBlock) && (
					<Box>
						<Text color={theme.colors.warning} dimColor>
							{compressBlockToast}
						</Text>
					</Box>
				)}
		</Box>
	);
}
