import React, {useState, useEffect} from 'react';
import {
	getOpenAiConfig,
	updateOpenAiConfig,
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
	saveProfile,
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

export function useConfigState() {
	const {t} = useI18n();
	const {theme} = useTheme();

	// Profile management
	const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
	const [activeProfile, setActiveProfile] = useState('');
	const [profileMode, setProfileMode] = useState<ProfileMode>('normal');
	const [newProfileName, setNewProfileName] = useState('');
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
	const [thinkingEnabled, setThinkingEnabled] = useState(false);
	const [thinkingMode, setThinkingMode] = useState<'tokens' | 'adaptive'>(
		'tokens',
	);
	const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState(10000);
	const [thinkingEffort, setThinkingEffort] = useState<
		'low' | 'medium' | 'high' | 'max'
	>('high');
	const [geminiThinkingEnabled, setGeminiThinkingEnabled] = useState(false);
	const [geminiThinkingBudget, setGeminiThinkingBudget] = useState(1024);
	const [responsesReasoningEnabled, setResponsesReasoningEnabled] =
		useState(false);
	const [responsesReasoningEffort, setResponsesReasoningEffort] = useState<
		'none' | 'low' | 'medium' | 'high' | 'xhigh'
	>('high');
	const [responsesVerbosity, setResponsesVerbosity] = useState<
		'low' | 'medium' | 'high'
	>('medium');
	const [responsesFastMode, setResponsesFastMode] = useState(false);

	// Model settings
	const [advancedModel, setAdvancedModel] = useState('');
	const [basicModel, setBasicModel] = useState('');
	const [maxContextTokens, setMaxContextTokens] = useState(4000);
	const [maxTokens, setMaxTokens] = useState(4096);
	const [streamIdleTimeoutSec, setStreamIdleTimeoutSec] = useState(180);
	const [toolResultTokenLimit, setToolResultTokenLimit] = useState(100000);
	const [editSimilarityThreshold, setEditSimilarityThreshold] = useState(0.75);

	// UI state
	const [currentField, setCurrentField] = useState<ConfigField>('profile');
	const [errors, setErrors] = useState<string[]>([]);
	const [isEditing, setIsEditing] = useState(false);
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string>('');
	const [searchTerm, setSearchTerm] = useState('');
	const [manualInputMode, setManualInputMode] = useState(false);
	const [manualInputValue, setManualInputValue] = useState('');
	const [editingThresholdValue, setEditingThresholdValue] = useState('');
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
			'profile',
			'baseUrl',
			'apiKey',
			'requestMethod',
			'systemPromptId',
			'customHeadersSchemeId',
			'enableAutoCompress',
			...(enableAutoCompress ? ['autoCompressThreshold' as ConfigField] : []),
			'showThinking',
			...(requestMethod === 'anthropic'
				? [
						'anthropicBeta' as ConfigField,
						'anthropicCacheTTL' as ConfigField,
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
						'geminiThinkingBudget' as ConfigField,
				  ]
				: requestMethod === 'responses'
				? [
						'responsesReasoningEnabled' as ConfigField,
						'responsesReasoningEffort' as ConfigField,
						'responsesVerbosity' as ConfigField,
						'responsesFastMode' as ConfigField,
				  ]
				: []),
			'advancedModel',
			'basicModel',
			'maxContextTokens',
			'maxTokens',
			'streamIdleTimeoutSec',
			'toolResultTokenLimit',
			'editSimilarityThreshold',
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
				currentField === 'thinkingEnabled' ||
				currentField === 'thinkingBudgetTokens')
		) {
			setCurrentField('advancedModel');
		}
		if (
			requestMethod !== 'gemini' &&
			(currentField === 'geminiThinkingEnabled' ||
				currentField === 'geminiThinkingBudget')
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

		const config = getOpenAiConfig();
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
		setGeminiThinkingBudget(config.geminiThinking?.budget || 1024);
		setResponsesReasoningEnabled(config.responsesReasoning?.enabled || false);
		setResponsesReasoningEffort(config.responsesReasoning?.effort || 'high');
		setResponsesVerbosity(config.responsesVerbosity || 'medium');
		setResponsesFastMode(config.responsesFastMode || false);
		setAdvancedModel(config.advancedModel || '');
		setBasicModel(config.basicModel || '');
		setMaxContextTokens(config.maxContextTokens || 4000);
		setMaxTokens(config.maxTokens || 4096);
		setStreamIdleTimeoutSec(config.streamIdleTimeoutSec || 180);
		setToolResultTokenLimit(config.toolResultTokenLimit || 100000);
		setEditSimilarityThreshold(config.editSimilarityThreshold ?? 0.75);

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

		setActiveProfile(getActiveProfileName());
	};

	const loadModels = async () => {
		setLoading(true);
		setLoadError('');

		const tempConfig: Partial<ApiConfig> = {
			baseUrl,
			apiKey,
			requestMethod,
		};
		await updateOpenAiConfig(tempConfig);

		try {
			const fetchedModels = await fetchAvailableModels();
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
		const modelOptions = filteredModels.map(model => ({
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
		if (currentField === 'editSimilarityThreshold')
			return editSimilarityThreshold.toString();
		if (currentField === 'thinkingBudgetTokens')
			return thinkingBudgetTokens.toString();
		if (currentField === 'thinkingMode') return thinkingMode;
		if (currentField === 'thinkingEffort') return thinkingEffort;
		if (currentField === 'geminiThinkingBudget')
			return geminiThinkingBudget.toString();
		if (currentField === 'responsesReasoningEffort')
			return responsesReasoningEffort;
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
					thinking: thinkingEnabled
						? thinkingMode === 'adaptive'
							? {type: 'adaptive' as const, effort: thinkingEffort}
							: {type: 'enabled' as const, budget_tokens: thinkingBudgetTokens}
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
				advancedModel,
				basicModel,
				maxContextTokens,
				maxTokens,
				streamIdleTimeoutSec,
				toolResultTokenLimit,
				editSimilarityThreshold,
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
					budget: geminiThinkingBudget,
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

			await updateOpenAiConfig(config);

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
						thinking: thinkingEnabled
							? thinkingMode === 'adaptive'
								? {type: 'adaptive' as const, effort: thinkingEffort}
								: {
										type: 'enabled' as const,
										budget_tokens: thinkingBudgetTokens,
								  }
							: undefined,
						geminiThinking: geminiThinkingEnabled
							? {enabled: true, budget: geminiThinkingBudget}
							: undefined,
					responsesReasoning: {
						enabled: responsesReasoningEnabled,
						effort: responsesReasoningEffort,
					},
					responsesVerbosity,
					responsesFastMode,
					advancedModel,
						basicModel,
						maxContextTokens,
						maxTokens,
						streamIdleTimeoutSec,
						toolResultTokenLimit,
						editSimilarityThreshold,
					},
				};
				saveProfile(activeProfile, fullConfig as any);
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
		geminiThinkingBudget,
		setGeminiThinkingBudget,
		responsesReasoningEnabled,
		setResponsesReasoningEnabled,
		responsesReasoningEffort,
		setResponsesReasoningEffort,
		responsesVerbosity,
		setResponsesVerbosity,
		responsesFastMode,
		setResponsesFastMode,
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
		editSimilarityThreshold,
		setEditSimilarityThreshold,
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
		editingThresholdValue,
		setEditingThresholdValue,
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
		handleModelChange,
		saveConfiguration,
		getAllFields,
		triggerForceUpdate,
	};
}

export type ConfigStateReturn = ReturnType<typeof useConfigState>;
