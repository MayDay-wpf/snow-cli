import React, {useState, useEffect} from 'react';
import {
	getSnowConfig,
	updateSnowConfig,
	validateApiConfig,
	getSystemPromptConfig,
	getCustomHeadersConfig,
	type RequestMethod,
	type ApiConfig,
} from '../../../utils/config/apiConfig.js';
import {
	fetchAvailableModels,
	filterModels,
	type Model,
} from '../../../api/models.js';
import {
	getActiveProfileName,
	getAllProfiles,
	switchProfile,
	createProfile,
	deleteProfile,
	renameProfile,
	saveProfile,
	loadProfile,
	type ConfigProfile,
} from '../../../utils/config/configManager.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {
	type ConfigField,
	type ProfileMode,
	type RequestMethodOption,
	MAX_VISIBLE_FIELDS,
	stripFocusArtifacts,
} from './types.js';

export type UseConfigStateOptions = {
	/**
	 * 指定要加载/保存的 profile 名称。
	 * 提供时，加载的配置来自该 profile 文件，保存只写回该 profile，
	 * 不会修改全局的 config.json 与当前 active profile（即不切换激活配置）。
	 * 未提供时回退到当前 active profile（旧行为）。
	 */
	targetProfileName?: string;
};

export function useConfigState(options?: UseConfigStateOptions) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const targetProfileName = options?.targetProfileName;

	// Profile management
	const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
	const [activeProfile, setActiveProfile] = useState('');
	const [profileMode, setProfileMode] = useState<ProfileMode>('normal');
	const [newProfileName, setNewProfileName] = useState('');
	const [renameProfileName, setRenameProfileName] = useState('');
	const [markedProfiles, setMarkedProfiles] = useState<Set<string>>(new Set());

	// API settings
	const [baseUrl, setBaseUrl] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [requestMethod, setRequestMethod] = useState<RequestMethod>('chat');
	const [systemPromptId, setSystemPromptId] = useState<
		string | string[] | undefined
	>(undefined);
	const [customHeadersSchemeId, setCustomHeadersSchemeId] = useState<
		string | undefined
	>(undefined);
	const [systemPrompts, setSystemPrompts] = useState<
		Array<{id: string; name: string}>
	>([]);
	const [activeSystemPromptIds, setActiveSystemPromptIds] = useState<string[]>(
		[],
	);
	const [pendingPromptIds, setPendingPromptIds] = useState<Set<string>>(
		new Set(),
	);
	const [customHeaderSchemes, setCustomHeaderSchemes] = useState<
		Array<{id: string; name: string}>
	>([]);
	const [activeCustomHeadersSchemeId, setActiveCustomHeadersSchemeId] =
		useState('');
	const [anthropicBeta, setAnthropicBeta] = useState(false);
	const [anthropicCacheTTL, setAnthropicCacheTTL] = useState<'5m' | '1h'>('5m');
	const [enableAutoCompress, setEnableAutoCompress] = useState(true);
	const [autoCompressThreshold, setAutoCompressThreshold] = useState(80);
	const [showThinking, setShowThinking] = useState(true);
	const [streamingDisplay, setStreamingDisplay] = useState(true);
	const [thinkingEnabled, setThinkingEnabled] = useState(false);
	const [thinkingMode, setThinkingMode] = useState<'tokens' | 'adaptive'>(
		'tokens',
	);
	const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState(10000);
	const [thinkingEffort, setThinkingEffort] = useState<
		'low' | 'medium' | 'high' | 'max'
	>('high');
	const [geminiThinkingEnabled, setGeminiThinkingEnabled] = useState(false);
	const [geminiThinkingLevel, setGeminiThinkingLevel] = useState<
		'minimal' | 'low' | 'medium' | 'high'
	>('high');
	const [responsesReasoningEnabled, setResponsesReasoningEnabled] =
		useState(false);
	const [responsesReasoningEffort, setResponsesReasoningEffort] = useState<
		'none' | 'low' | 'medium' | 'high' | 'xhigh'
	>('high');
	const [responsesVerbosity, setResponsesVerbosity] = useState<
		'low' | 'medium' | 'high'
	>('medium');
	const [responsesFastMode, setResponsesFastMode] = useState(false);
	const [anthropicSpeed, setAnthropicSpeed] = useState<
		'fast' | 'standard' | undefined
	>(undefined);
	const [chatThinkingEnabled, setChatThinkingEnabled] = useState(false);
	const [chatReasoningEffort, setChatReasoningEffort] = useState<
		'low' | 'medium' | 'high' | 'max'
	>('high');

	// Model settings
	const [advancedModel, setAdvancedModel] = useState('');
	const [basicModel, setBasicModel] = useState('');
	const [maxContextTokens, setMaxContextTokens] = useState(4000);
	const [maxTokens, setMaxTokens] = useState(4096);
	const [toolResultTokenLimit, setToolResultTokenLimit] = useState(30);
	const [streamIdleTimeoutSec, setStreamIdleTimeoutSec] = useState(180);

	// UI state
	// 当从 ProfileEditPanel 进入（提供 targetProfileName）时，profile 字段被隐藏，
	// 初始光标应落在 baseUrl，避免 currentFieldIndex 为 -1。
	const [currentField, setCurrentField] = useState<ConfigField>(
		targetProfileName ? 'baseUrl' : 'profile',
	);
	const [errors, setErrors] = useState<string[]>([]);
	const [isEditing, setIsEditing] = useState(false);
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string>('');
	const [searchTerm, setSearchTerm] = useState('');
	const [manualInputMode, setManualInputMode] = useState(false);
	const [manualInputValue, setManualInputValue] = useState('');
	const [, forceUpdate] = useState(0);

	const supportsXHigh = requestMethod === 'responses';

	const requestMethodOptions: RequestMethodOption[] = [
		{
			label: t.configScreen.requestMethodChat,
			value: 'chat' as RequestMethod,
		},
		{
			label: t.configScreen.requestMethodResponses,
			value: 'responses' as RequestMethod,
		},
		{
			label: t.configScreen.requestMethodGemini,
			value: 'gemini' as RequestMethod,
		},
		{
			label: t.configScreen.requestMethodAnthropic,
			value: 'anthropic' as RequestMethod,
		},
	];

	const getAllFields = (): ConfigField[] => {
		return [
			// 仅在未指定 targetProfileName（即从主菜单常规进入 ConfigScreen）时才允许
			// 显示/操作 profile 切换项；从 ProfileEditPanel 进入时彻底隐藏，
			// 防止用户切换 active profile 或对 profile 进行增删改。
			...(targetProfileName ? [] : ['profile' as ConfigField]),
			'baseUrl',
			'apiKey',
			'requestMethod',
			'systemPromptId',
			'customHeadersSchemeId',
			'enableAutoCompress',
			...(enableAutoCompress ? ['autoCompressThreshold' as ConfigField] : []),
			'showThinking',
			'streamingDisplay',
			...(requestMethod === 'anthropic'
				? [
						'anthropicBeta' as ConfigField,
						'anthropicCacheTTL' as ConfigField,
						'anthropicSpeed' as ConfigField,
						'thinkingEnabled' as ConfigField,
						'thinkingMode' as ConfigField,
						...(thinkingEnabled && thinkingMode === 'tokens'
							? ['thinkingBudgetTokens' as ConfigField]
							: []),
						...(thinkingEnabled && thinkingMode === 'adaptive'
							? ['thinkingEffort' as ConfigField]
							: []),
				  ]
				: requestMethod === 'gemini'
				? [
						'geminiThinkingEnabled' as ConfigField,
						'geminiThinkingLevel' as ConfigField,
				  ]
				: requestMethod === 'responses'
				? [
						'responsesReasoningEnabled' as ConfigField,
						'responsesReasoningEffort' as ConfigField,
						'responsesVerbosity' as ConfigField,
						'responsesFastMode' as ConfigField,
				  ]
				: requestMethod === 'chat'
				? [
						'chatThinkingEnabled' as ConfigField,
						...(chatThinkingEnabled
							? ['chatReasoningEffort' as ConfigField]
							: []),
				  ]
				: []),
			'advancedModel',
			'basicModel',
			'maxContextTokens',
			'maxTokens',
			'streamIdleTimeoutSec',
			'toolResultTokenLimit',
		];
	};

	const allFields = getAllFields();
	const currentFieldIndex = allFields.indexOf(currentField);
	const totalFields = allFields.length;

	const fieldsDisplayWindow = React.useMemo(() => {
		if (allFields.length <= MAX_VISIBLE_FIELDS) {
			return {
				items: allFields,
				startIndex: 0,
				endIndex: allFields.length,
			};
		}

		const halfWindow = Math.floor(MAX_VISIBLE_FIELDS / 2);
		let startIndex = Math.max(0, currentFieldIndex - halfWindow);
		let endIndex = Math.min(allFields.length, startIndex + MAX_VISIBLE_FIELDS);

		if (endIndex - startIndex < MAX_VISIBLE_FIELDS) {
			startIndex = Math.max(0, endIndex - MAX_VISIBLE_FIELDS);
		}

		return {
			items: allFields.slice(startIndex, endIndex),
			startIndex,
			endIndex,
		};
	}, [allFields, currentFieldIndex]);

	const hiddenAboveFieldsCount = fieldsDisplayWindow.startIndex;
	const hiddenBelowFieldsCount = Math.max(
		0,
		allFields.length - fieldsDisplayWindow.endIndex,
	);

	// --- Effects ---

	useEffect(() => {
		loadProfilesAndConfig();
	}, []);

	useEffect(() => {
		if (
			requestMethod !== 'anthropic' &&
			(currentField === 'anthropicBeta' ||
				currentField === 'anthropicCacheTTL' ||
				currentField === 'anthropicSpeed' ||
				currentField === 'thinkingEnabled' ||
				currentField === 'thinkingBudgetTokens')
		) {
			setCurrentField('advancedModel');
		}
		if (
			requestMethod !== 'gemini' &&
			(currentField === 'geminiThinkingEnabled' ||
				currentField === 'geminiThinkingLevel')
		) {
			setCurrentField('advancedModel');
		}
		if (
			requestMethod !== 'responses' &&
			(currentField === 'responsesReasoningEnabled' ||
				currentField === 'responsesReasoningEffort' ||
				currentField === 'responsesVerbosity' ||
				currentField === 'responsesFastMode')
		) {
			setCurrentField('advancedModel');
		}
		if (
			requestMethod !== 'chat' &&
			(currentField === 'chatThinkingEnabled' ||
				currentField === 'chatReasoningEffort')
		) {
			setCurrentField('advancedModel');
		}
	}, [requestMethod, currentField]);

	useEffect(() => {
		if (!enableAutoCompress && currentField === 'autoCompressThreshold') {
			setCurrentField('showThinking');
		}
	}, [enableAutoCompress, currentField]);

	useEffect(() => {
		if (responsesReasoningEffort === 'xhigh' && !supportsXHigh) {
			setResponsesReasoningEffort('high');
		}
	}, [
		requestMethod,
		advancedModel,
		basicModel,
		responsesReasoningEffort,
		supportsXHigh,
	]);

	// --- Data loading ---

	const loadProfilesAndConfig = () => {
		const loadedProfiles = getAllProfiles();
		setProfiles(loadedProfiles);

		// 当指定了 targetProfileName 时，从该 profile 文件加载配置
		// （而不是当前 active profile 的全局 config）。这样可以编辑非激活 profile。
		const targetConfig = targetProfileName
			? loadProfile(targetProfileName)
			: undefined;
		const config = targetConfig?.snowcfg ?? getSnowConfig();
		setBaseUrl(config.baseUrl);
		setApiKey(config.apiKey);
		setRequestMethod(config.requestMethod || 'chat');
		setSystemPromptId(config.systemPromptId);
		setCustomHeadersSchemeId(config.customHeadersSchemeId);
		setAnthropicBeta(config.anthropicBeta || false);
		setAnthropicCacheTTL(config.anthropicCacheTTL || '5m');
		setEnableAutoCompress(config.enableAutoCompress !== false);
		setAutoCompressThreshold(config.autoCompressThreshold ?? 80);
		setShowThinking(config.showThinking !== false);
		setStreamingDisplay(config.streamingDisplay !== false);
		setThinkingEnabled(
			config.thinking?.type === 'enabled' ||
				config.thinking?.type === 'adaptive' ||
				false,
		);
		setThinkingMode(
			config.thinking?.type === 'adaptive' ? 'adaptive' : 'tokens',
		);
		setThinkingBudgetTokens(config.thinking?.budget_tokens || 10000);
		setThinkingEffort(config.thinking?.effort || 'high');
		setGeminiThinkingEnabled(config.geminiThinking?.enabled || false);
		setGeminiThinkingLevel(config.geminiThinking?.thinkingLevel || 'high');
		setResponsesReasoningEnabled(config.responsesReasoning?.enabled || false);
		setResponsesReasoningEffort(config.responsesReasoning?.effort || 'high');
		setResponsesVerbosity(config.responsesVerbosity || 'medium');
		setResponsesFastMode(config.responsesFastMode || false);
		setAnthropicSpeed(config.anthropicSpeed);
		setChatThinkingEnabled(config.chatThinking?.enabled || false);
		setChatReasoningEffort(config.chatThinking?.reasoning_effort || 'high');
		setAdvancedModel(config.advancedModel || '');
		setBasicModel(config.basicModel || '');
		setMaxContextTokens(config.maxContextTokens || 4000);
		setMaxTokens(config.maxTokens || 4096);
		setToolResultTokenLimit(config.toolResultTokenLimit ?? 30);
		setStreamIdleTimeoutSec(config.streamIdleTimeoutSec || 180);

		const systemPromptConfig = getSystemPromptConfig();
		setSystemPrompts(
			(systemPromptConfig?.prompts || []).map(p => ({id: p.id, name: p.name})),
		);
		setActiveSystemPromptIds(systemPromptConfig?.active || []);

		const customHeadersConfig = getCustomHeadersConfig();
		setCustomHeaderSchemes(
			(customHeadersConfig?.schemes || []).map(s => ({id: s.id, name: s.name})),
		);
		setActiveCustomHeadersSchemeId(customHeadersConfig?.active || '');

		// 当编辑指定 profile 时，把 activeProfile 状态指向目标 profile，
		// 让 UI（标题/保存逻辑等）按目标 profile 显示，但不实际切换全局 active。
		setActiveProfile(targetProfileName ?? getActiveProfileName());
	};

	const loadModels = async () => {
		setLoading(true);
		setLoadError('');

		const tempConfig: Partial<ApiConfig> = {
			baseUrl,
			apiKey,
			requestMethod,
			customHeadersSchemeId,
		};

		// loadModels 只是为了拉模型列表临时使用 baseUrl/apiKey/method，
		// 一律不调 updateSnowConfig（它会写全局 config.json 并 saveProfile 到磁盘当前的 active profile，
		// 在多开 CLI / ProfileEditPanel 编辑非激活 profile 等场景都会造成污染），
		// 改为通过 overrideConfig 直接传给 fetchAvailableModels 做一次性请求。
		try {
			const fetchedModels = await fetchAvailableModels(tempConfig);
			setModels(fetchedModels);
		} catch (err) {
			const errorMessage =
				err instanceof Error ? err.message : 'Unknown error occurred';
			setLoadError(errorMessage);
			throw err;
		} finally {
			setLoading(false);
		}
	};

	// --- Helpers ---

	const getCurrentOptions = () => {
		const filteredModels = filterModels(models, searchTerm);
		const seen = new Set<string>();
		const modelOptions = filteredModels
			.filter(model => {
				if (seen.has(model.id)) return false;
				seen.add(model.id);
				return true;
			})
			.map(model => ({
				label: model.id,
				value: model.id,
			}));

		return [
			{label: t.configScreen.manualInputOption, value: '__MANUAL_INPUT__'},
			...modelOptions,
		];
	};

	const getCurrentValue = () => {
		if (currentField === 'profile') return activeProfile;
		if (currentField === 'baseUrl') return baseUrl;
		if (currentField === 'apiKey') return apiKey;
		if (currentField === 'advancedModel') return advancedModel;
		if (currentField === 'basicModel') return basicModel;
		if (currentField === 'maxContextTokens') return maxContextTokens.toString();
		if (currentField === 'maxTokens') return maxTokens.toString();
		if (currentField === 'streamIdleTimeoutSec')
			return streamIdleTimeoutSec.toString();
		if (currentField === 'toolResultTokenLimit')
			return toolResultTokenLimit.toString();
		if (currentField === 'thinkingBudgetTokens')
			return thinkingBudgetTokens.toString();
		if (currentField === 'thinkingMode') return thinkingMode;
		if (currentField === 'thinkingEffort') return thinkingEffort;
		if (currentField === 'geminiThinkingLevel') return geminiThinkingLevel;
		if (currentField === 'responsesReasoningEffort')
			return responsesReasoningEffort;
		if (currentField === 'anthropicSpeed') return anthropicSpeed || '';
		if (currentField === 'chatReasoningEffort') return chatReasoningEffort;
		return '';
	};

	const getSystemPromptNameById = (id: string) =>
		systemPrompts.find(p => p.id === id)?.name || id;

	const getCustomHeadersSchemeNameById = (id: string) =>
		customHeaderSchemes.find(s => s.id === id)?.name || id;

	const getNormalizedBaseUrl = (value: string) =>
		value.trim().replace(/\/+$/, '');

	const getResolvedBaseUrl = (method: RequestMethod) => {
		const defaultOpenAiBaseUrl = 'https://api.openai.com/v1';
		const trimmedBaseUrl = getNormalizedBaseUrl(baseUrl || '');
		const shouldUseCustomBaseUrl =
			trimmedBaseUrl.length > 0 && trimmedBaseUrl !== defaultOpenAiBaseUrl;

		if (method === 'anthropic') {
			const anthropicBaseUrl = shouldUseCustomBaseUrl
				? trimmedBaseUrl
				: 'https://api.anthropic.com/v1';
			return getNormalizedBaseUrl(anthropicBaseUrl);
		}

		if (method === 'gemini') {
			const geminiBaseUrl = shouldUseCustomBaseUrl
				? trimmedBaseUrl
				: 'https://generativelanguage.googleapis.com/v1beta';
			return getNormalizedBaseUrl(geminiBaseUrl);
		}

		const openAiBaseUrl = trimmedBaseUrl || defaultOpenAiBaseUrl;
		return getNormalizedBaseUrl(openAiBaseUrl);
	};

	const getRequestUrl = () => {
		const resolvedBaseUrl = getResolvedBaseUrl(requestMethod);

		if (requestMethod === 'responses') {
			return `${resolvedBaseUrl}/responses`;
		}

		if (requestMethod === 'anthropic') {
			const endpoint = anthropicBeta ? '/messages?beta=true' : '/messages';
			return `${resolvedBaseUrl}${endpoint}`;
		}

		if (requestMethod === 'gemini') {
			const effectiveModel = advancedModel || 'model-id';
			const modelName = effectiveModel.startsWith('models/')
				? effectiveModel
				: `models/${effectiveModel}`;
			return `${resolvedBaseUrl}/${modelName}:streamGenerateContent?alt=sse`;
		}

		return `${resolvedBaseUrl}/chat/completions`;
	};

	const getSystemPromptSelectItems = () => {
		const activeNames = activeSystemPromptIds
			.map(id => getSystemPromptNameById(id))
			.join(', ');
		const activeLabel = activeNames
			? t.configScreen.followGlobalWithParentheses.replace(
					'{name}',
					activeNames,
			  )
			: t.configScreen.followGlobalNoneWithParentheses;
		return [
			{label: activeLabel, value: '__FOLLOW__'},
			{label: t.configScreen.notUse, value: '__DISABLED__'},
			...systemPrompts.map(p => ({
				label: p.name || p.id,
				value: p.id,
			})),
		];
	};

	const getSystemPromptSelectedValue = () => {
		if (systemPromptId === '') return '__DISABLED__';
		if (Array.isArray(systemPromptId)) return '__FOLLOW__';
		if (systemPromptId) return systemPromptId;
		return '__FOLLOW__';
	};

	const applySystemPromptSelectValue = (value: string) => {
		if (value === '__FOLLOW__') {
			setSystemPromptId(undefined);
			return;
		}
		if (value === '__DISABLED__') {
			setSystemPromptId('');
			return;
		}
		setSystemPromptId(value);
	};

	const getCustomHeadersSchemeSelectItems = () => {
		const activeLabel = activeCustomHeadersSchemeId
			? t.configScreen.followGlobalWithParentheses.replace(
					'{name}',
					getCustomHeadersSchemeNameById(activeCustomHeadersSchemeId),
			  )
			: t.configScreen.followGlobalNoneWithParentheses;
		return [
			{label: activeLabel, value: '__FOLLOW__'},
			{label: t.configScreen.notUse, value: '__DISABLED__'},
			...customHeaderSchemes.map(s => ({
				label: s.name || s.id,
				value: s.id,
			})),
		];
	};

	const getCustomHeadersSchemeSelectedValue = () => {
		if (customHeadersSchemeId === '') return '__DISABLED__';
		if (customHeadersSchemeId) return customHeadersSchemeId;
		return '__FOLLOW__';
	};

	const applyCustomHeadersSchemeSelectValue = (value: string) => {
		if (value === '__FOLLOW__') {
			setCustomHeadersSchemeId(undefined);
			return;
		}
		if (value === '__DISABLED__') {
			setCustomHeadersSchemeId('');
			return;
		}
		setCustomHeadersSchemeId(value);
	};

	// --- Handlers ---

	const handleCreateProfile = () => {
		const cleaned = stripFocusArtifacts(newProfileName).trim();

		if (!cleaned) {
			setErrors([t.configScreen.profileNameEmpty]);
			return;
		}

		try {
			const currentConfig = {
				snowcfg: {
					baseUrl,
					apiKey,
					requestMethod,
					systemPromptId,
					customHeadersSchemeId,
					anthropicBeta,
					anthropicCacheTTL,
					enableAutoCompress,
					autoCompressThreshold,
					showThinking,
					streamingDisplay,
					thinking: thinkingEnabled
						? thinkingMode === 'adaptive'
							? {type: 'adaptive' as const, effort: thinkingEffort}
							: {type: 'enabled' as const, budget_tokens: thinkingBudgetTokens}
						: undefined,
					anthropicSpeed,
					chatThinking: chatThinkingEnabled
						? {enabled: true, reasoning_effort: chatReasoningEffort}
						: undefined,
					advancedModel,
					basicModel,
					maxContextTokens,
					maxTokens,
					streamIdleTimeoutSec,
					toolResultTokenLimit,
				},
			};
			createProfile(cleaned, currentConfig as any);
			switchProfile(cleaned);
			loadProfilesAndConfig();
			setProfileMode('normal');
			setNewProfileName('');
			setIsEditing(false);
			setErrors([]);
		} catch (err) {
			setErrors([
				err instanceof Error ? err.message : 'Failed to create profile',
			]);
		}
	};

	const handleBatchDeleteProfiles = () => {
		if (markedProfiles.size === 0) return;

		try {
			let hasError = false;
			let firstError: Error | null = null;

			markedProfiles.forEach(profileName => {
				try {
					deleteProfile(profileName);
				} catch (err) {
					hasError = true;
					if (!firstError && err instanceof Error) {
						firstError = err;
					}
				}
			});

			const newActiveProfile = getActiveProfileName();
			setActiveProfile(newActiveProfile);
			loadProfilesAndConfig();
			setMarkedProfiles(new Set());
			setProfileMode('normal');
			setIsEditing(false);
			setErrors([]);
			if (hasError && firstError) {
				setErrors([(firstError as Error).message]);
			}
		} catch (err) {
			setErrors([
				err instanceof Error ? err.message : 'Failed to delete profiles',
			]);
			setProfileMode('normal');
		}
	};

	const handleRenameProfile = () => {
		const cleaned = stripFocusArtifacts(renameProfileName).trim();

		if (!cleaned) {
			setErrors([t.configScreen.profileNameEmpty]);
			return;
		}

		if (activeProfile === 'default') {
			setErrors([t.configScreen.cannotRenameDefault]);
			return;
		}

		try {
			renameProfile(activeProfile, cleaned);
			loadProfilesAndConfig();
			setProfileMode('normal');
			setRenameProfileName('');
			setMarkedProfiles(new Set());
			setIsEditing(false);
			setErrors([]);
		} catch (err) {
			setErrors([
				err instanceof Error ? err.message : 'Failed to rename profile',
			]);
		}
	};

	const handleModelChange = (value: string) => {
		if (value === '__MANUAL_INPUT__') {
			setManualInputMode(true);
			setManualInputValue('');
			return;
		}

		if (currentField === 'advancedModel') {
			setAdvancedModel(value);
		} else if (currentField === 'basicModel') {
			setBasicModel(value);
		}

		setIsEditing(false);
		setSearchTerm('');
	};

	const saveConfiguration = async () => {
		const validationErrors = validateApiConfig({
			baseUrl,
			apiKey,
			requestMethod,
		});
		if (validationErrors.length === 0) {
			const config: Partial<ApiConfig> = {
				baseUrl,
				apiKey,
				requestMethod,
				systemPromptId,
				customHeadersSchemeId,
				anthropicBeta,
				anthropicCacheTTL,
				enableAutoCompress,
				autoCompressThreshold,
				showThinking,
				streamingDisplay,
				advancedModel,
				basicModel,
				maxContextTokens,
				maxTokens,
				streamIdleTimeoutSec,
				toolResultTokenLimit,
			};

			if (thinkingEnabled) {
				config.thinking =
					thinkingMode === 'adaptive'
						? {
								type: 'adaptive',
								effort: thinkingEffort,
						  }
						: {
								type: 'enabled',
								budget_tokens: thinkingBudgetTokens,
						  };
			} else {
				config.thinking = undefined;
			}

			if (geminiThinkingEnabled) {
				(config as any).geminiThinking = {
					enabled: true,
					thinkingLevel: geminiThinkingLevel,
				};
			} else {
				(config as any).geminiThinking = undefined;
			}

			(config as any).responsesReasoning = {
				enabled: responsesReasoningEnabled,
				effort: responsesReasoningEffort,
			};

			config.responsesFastMode = responsesFastMode;
			config.responsesVerbosity = responsesVerbosity;
			config.anthropicSpeed = anthropicSpeed;

			(config as any).chatThinking = chatThinkingEnabled
				? {enabled: true, reasoning_effort: chatReasoningEffort}
				: undefined;

			// 保存对齐（统一规则，覆盖所有入口）：
			// editingProfile = 进入页面时记录的目标 profile（targetProfileName 优先，否则 activeProfile state）。
			// 仅当磁盘当前 active 仍然 === editingProfile 时，才调 updateSnowConfig 刷新全局 config.json + 缓存。
			// 否则（CLI 多开场景：另一个实例已经把 active 切走了；或 ProfileEditPanel 编辑非激活 profile）
			// 一律跳过 updateSnowConfig，避免把当前编辑结果错误写到磁盘当前 active profile 文件。
			const editingProfile =
				targetProfileName ?? activeProfile ?? getActiveProfileName();
			const liveActiveProfile = getActiveProfileName();
			if (liveActiveProfile === editingProfile) {
				await updateSnowConfig(config);
			}

			try {
				const fullConfig = {
					snowcfg: {
						baseUrl,
						apiKey,
						requestMethod,
						systemPromptId,
						customHeadersSchemeId,
						anthropicBeta,
						anthropicCacheTTL,
						enableAutoCompress,
						autoCompressThreshold,
						showThinking,
						streamingDisplay,
						thinking: thinkingEnabled
							? thinkingMode === 'adaptive'
								? {type: 'adaptive' as const, effort: thinkingEffort}
								: {
										type: 'enabled' as const,
										budget_tokens: thinkingBudgetTokens,
								  }
							: undefined,
						geminiThinking: geminiThinkingEnabled
							? {enabled: true, thinkingLevel: geminiThinkingLevel}
							: undefined,
						responsesReasoning: {
							enabled: responsesReasoningEnabled,
							effort: responsesReasoningEffort,
						},
						responsesVerbosity,
						responsesFastMode,
						anthropicSpeed,
						chatThinking: chatThinkingEnabled
							? {enabled: true, reasoning_effort: chatReasoningEffort}
							: undefined,
						advancedModel,
						basicModel,
						maxContextTokens,
						maxTokens,
						streamIdleTimeoutSec,
						toolResultTokenLimit,
					},
				};
				// 写回的目标固定为 editingProfile（与上面 updateSnowConfig 判定使用同一个值）。
				// 即使另一个 CLI 实例已经把磁盘 active 切走，也保证把当前编辑结果
				// 准确落盘到"用户进入页面时编辑的那个 profile"文件，绝不污染其他 profile。
				saveProfile(editingProfile, fullConfig as any);
			} catch (err) {
				console.error('Failed to save profile:', err);
			}

			setErrors([]);
			return true;
		} else {
			setErrors(validationErrors);
			return false;
		}
	};

	const triggerForceUpdate = () => forceUpdate(prev => prev + 1);

	return {
		t,
		theme,
		// Profile
		profiles,
		activeProfile,
		profileMode,
		setProfileMode,
		newProfileName,
		setNewProfileName,
		renameProfileName,
		setRenameProfileName,
		markedProfiles,
		setMarkedProfiles,
		// API settings
		baseUrl,
		setBaseUrl,
		apiKey,
		setApiKey,
		requestMethod,
		setRequestMethod,
		systemPromptId,
		setSystemPromptId,
		customHeadersSchemeId,
		setCustomHeadersSchemeId,
		systemPrompts,
		activeSystemPromptIds,
		pendingPromptIds,
		setPendingPromptIds,
		customHeaderSchemes,
		activeCustomHeadersSchemeId,
		anthropicBeta,
		setAnthropicBeta,
		anthropicCacheTTL,
		setAnthropicCacheTTL,
		enableAutoCompress,
		setEnableAutoCompress,
		autoCompressThreshold,
		setAutoCompressThreshold,
		showThinking,
		setShowThinking,
		streamingDisplay,
		setStreamingDisplay,
		thinkingEnabled,
		setThinkingEnabled,
		thinkingMode,
		setThinkingMode,
		thinkingBudgetTokens,
		setThinkingBudgetTokens,
		thinkingEffort,
		setThinkingEffort,
		geminiThinkingEnabled,
		setGeminiThinkingEnabled,
		geminiThinkingLevel,
		setGeminiThinkingLevel,
		responsesReasoningEnabled,
		setResponsesReasoningEnabled,
		responsesReasoningEffort,
		setResponsesReasoningEffort,
		responsesVerbosity,
		setResponsesVerbosity,
		responsesFastMode,
		setResponsesFastMode,
		anthropicSpeed,
		setAnthropicSpeed,
		chatThinkingEnabled,
		setChatThinkingEnabled,
		chatReasoningEffort,
		setChatReasoningEffort,
		// Model settings
		advancedModel,
		setAdvancedModel,
		basicModel,
		setBasicModel,
		maxContextTokens,
		setMaxContextTokens,
		maxTokens,
		setMaxTokens,
		streamIdleTimeoutSec,
		setStreamIdleTimeoutSec,
		toolResultTokenLimit,
		setToolResultTokenLimit,
		// UI state
		currentField,
		setCurrentField,
		errors,
		setErrors,
		isEditing,
		setIsEditing,
		models,
		loading,
		setLoading,
		loadError,
		searchTerm,
		setSearchTerm,
		manualInputMode,
		setManualInputMode,
		manualInputValue,
		setManualInputValue,
		// Derived
		supportsXHigh,
		requestMethodOptions,
		allFields,
		currentFieldIndex,
		totalFields,
		fieldsDisplayWindow,
		hiddenAboveFieldsCount,
		hiddenBelowFieldsCount,
		// Functions
		loadProfilesAndConfig,
		loadModels,
		getCurrentOptions,
		getCurrentValue,
		getSystemPromptNameById,
		getCustomHeadersSchemeNameById,
		getRequestUrl,
		getSystemPromptSelectItems,
		getSystemPromptSelectedValue,
		applySystemPromptSelectValue,
		getCustomHeadersSchemeSelectItems,
		getCustomHeadersSchemeSelectedValue,
		applyCustomHeadersSchemeSelectValue,
		handleCreateProfile,
		handleBatchDeleteProfiles,
		handleRenameProfile,
		handleModelChange,
		saveConfiguration,
		getAllFields,
		triggerForceUpdate,
	};
}

export type ConfigStateReturn = ReturnType<typeof useConfigState>;
