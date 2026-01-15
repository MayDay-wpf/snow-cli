import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import Gradient from 'ink-gradient';
import {Select, Alert, Spinner} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import ScrollableSelectInput from '../components/common/ScrollableSelectInput.js';
import {
	getOpenAiConfig,
	updateOpenAiConfig,
	validateApiConfig,
	getSystemPromptConfig,
	getCustomHeadersConfig,
	type RequestMethod,
	type ApiConfig,
} from '../../utils/config/apiConfig.js';
import {
	fetchAvailableModels,
	filterModels,
	type Model,
} from '../../api/models.js';
import {
	getActiveProfileName,
	getAllProfiles,
	switchProfile,
	createProfile,
	deleteProfile,
	saveProfile,
	type ConfigProfile,
} from '../../utils/config/configManager.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
	inlineMode?: boolean;
};

type ConfigField =
	| 'profile'
	| 'baseUrl'
	| 'apiKey'
	| 'requestMethod'
	| 'systemPromptId'
	| 'customHeadersSchemeId'
	| 'anthropicBeta'
	| 'anthropicCacheTTL'
	| 'enableAutoCompress'
	| 'showThinking'
	| 'thinkingEnabled'
	| 'thinkingBudgetTokens'
	| 'geminiThinkingEnabled'
	| 'geminiThinkingBudget'
	| 'responsesReasoningEnabled'
	| 'responsesReasoningEffort'
	| 'advancedModel'
	| 'basicModel'
	| 'maxContextTokens'
	| 'maxTokens'
	| 'toolResultTokenLimit'
	| 'editSimilarityThreshold';

type ProfileMode = 'normal' | 'creating' | 'deleting';

const focusEventTokenRegex = /(?:\x1b)?\[[0-9;]*[IO]/g;

const isFocusEventInput = (value?: string) => {
	if (!value) {
		return false;
	}

	if (
		value === '\x1b[I' ||
		value === '\x1b[O' ||
		value === '[I' ||
		value === '[O'
	) {
		return true;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return false;
	}

	const tokens = trimmed.match(focusEventTokenRegex);
	if (!tokens) {
		return false;
	}

	const normalized = trimmed.replace(/\s+/g, '');
	const tokensCombined = tokens.join('');
	return tokensCombined === normalized;
};

const stripFocusArtifacts = (value: string) => {
	if (!value) {
		return '';
	}

	return value
		.replace(/\x1b\[[0-9;]*[IO]/g, '')
		.replace(/\[[0-9;]*[IO]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

export default function ConfigScreen({
	onBack,
	onSave,
	inlineMode = false,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();

	// Profile management
	const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
	const [activeProfile, setActiveProfile] = useState('');
	const [profileMode, setProfileMode] = useState<ProfileMode>('normal');
	const [newProfileName, setNewProfileName] = useState('');

	// API settings
	const [baseUrl, setBaseUrl] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [requestMethod, setRequestMethod] = useState<RequestMethod>('chat');
	const [systemPromptId, setSystemPromptId] = useState<string | undefined>(
		undefined,
	);
	const [customHeadersSchemeId, setCustomHeadersSchemeId] = useState<
		string | undefined
	>(undefined);
	const [systemPrompts, setSystemPrompts] = useState<
		Array<{id: string; name: string}>
	>([]);
	const [activeSystemPromptId, setActiveSystemPromptId] = useState('');
	const [customHeaderSchemes, setCustomHeaderSchemes] = useState<
		Array<{id: string; name: string}>
	>([]);
	const [activeCustomHeadersSchemeId, setActiveCustomHeadersSchemeId] =
		useState('');
	const [anthropicBeta, setAnthropicBeta] = useState(false);
	const [anthropicCacheTTL, setAnthropicCacheTTL] = useState<'5m' | '1h'>('5m');
	const [enableAutoCompress, setEnableAutoCompress] = useState(true);
	const [showThinking, setShowThinking] = useState(true);
	const [thinkingEnabled, setThinkingEnabled] = useState(false);
	const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState(10000);
	const [geminiThinkingEnabled, setGeminiThinkingEnabled] = useState(false);
	const [geminiThinkingBudget, setGeminiThinkingBudget] = useState(1024);
	const [responsesReasoningEnabled, setResponsesReasoningEnabled] =
		useState(false);
	const [responsesReasoningEffort, setResponsesReasoningEffort] = useState<
		'low' | 'medium' | 'high' | 'xhigh'
	>('high');

	// Model settings
	const [advancedModel, setAdvancedModel] = useState('');
	const [basicModel, setBasicModel] = useState('');
	const [maxContextTokens, setMaxContextTokens] = useState(4000);
	const [maxTokens, setMaxTokens] = useState(4096);
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

	// Scrolling configuration
	const MAX_VISIBLE_FIELDS = 8;

	// Responses reasoning effort options（XHIGH 不做模型限制）
	const supportsXHigh = requestMethod === 'responses';

	const requestMethodOptions = [
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

	// Get all available fields based on current request method
	const getAllFields = (): ConfigField[] => {
		return [
			'profile',
			'baseUrl',
			'apiKey',
			'requestMethod',
			'systemPromptId',
			'customHeadersSchemeId',
			'enableAutoCompress',
			'showThinking',
			...(requestMethod === 'anthropic'
				? [
						'anthropicBeta' as ConfigField,
						'anthropicCacheTTL' as ConfigField,
						'thinkingEnabled' as ConfigField,
						'thinkingBudgetTokens' as ConfigField,
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
				  ]
				: []),
			'advancedModel',
			'basicModel',
			'maxContextTokens',
			'maxTokens',
			'toolResultTokenLimit',
			'editSimilarityThreshold',
		];
	};

	// Get current field index and total count
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

	useEffect(() => {
		loadProfilesAndConfig();
	}, []);

	// Auto-adjust currentField when requestMethod changes
	useEffect(() => {
		// If requestMethod is not 'anthropic' and currentField is on Anthropic-specific fields,
		// move to the next available field
		if (
			requestMethod !== 'anthropic' &&
			(currentField === 'anthropicBeta' ||
				currentField === 'anthropicCacheTTL' ||
				currentField === 'thinkingEnabled' ||
				currentField === 'thinkingBudgetTokens')
		) {
			setCurrentField('advancedModel');
		}
		// If requestMethod is not 'gemini' and currentField is on Gemini-specific fields,
		// move to the next available field
		if (
			requestMethod !== 'gemini' &&
			(currentField === 'geminiThinkingEnabled' ||
				currentField === 'geminiThinkingBudget')
		) {
			setCurrentField('advancedModel');
		}
		// If requestMethod is not 'responses' and currentField is on Responses-specific fields,
		// move to the next available field
		if (
			requestMethod !== 'responses' &&
			(currentField === 'responsesReasoningEnabled' ||
				currentField === 'responsesReasoningEffort')
		) {
			setCurrentField('advancedModel');
		}
	}, [requestMethod, currentField]);

	// Auto-downgrade xhigh effort when unsupported (e.g., switching requestMethod or model)
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

	const loadProfilesAndConfig = () => {
		// Load profiles
		const loadedProfiles = getAllProfiles();
		setProfiles(loadedProfiles);

		// Load current config
		const config = getOpenAiConfig();
		setBaseUrl(config.baseUrl);
		setApiKey(config.apiKey);
		setRequestMethod(config.requestMethod || 'chat');
		setSystemPromptId(config.systemPromptId);
		setCustomHeadersSchemeId(config.customHeadersSchemeId);
		setAnthropicBeta(config.anthropicBeta || false);
		setAnthropicCacheTTL(config.anthropicCacheTTL || '5m');
		setEnableAutoCompress(config.enableAutoCompress !== false); // Default to true
		setShowThinking(config.showThinking !== false); // Default to true
		setThinkingEnabled(config.thinking?.type === 'enabled' || false);
		setThinkingBudgetTokens(config.thinking?.budget_tokens || 10000);
		setGeminiThinkingEnabled(config.geminiThinking?.enabled || false);
		setGeminiThinkingBudget(config.geminiThinking?.budget || 1024);
		setResponsesReasoningEnabled(config.responsesReasoning?.enabled || false);
		setResponsesReasoningEffort(config.responsesReasoning?.effort || 'high');
		setAdvancedModel(config.advancedModel || '');
		setBasicModel(config.basicModel || '');
		setMaxContextTokens(config.maxContextTokens || 4000);
		setMaxTokens(config.maxTokens || 4096);
		setToolResultTokenLimit(config.toolResultTokenLimit || 100000);
		setEditSimilarityThreshold(config.editSimilarityThreshold ?? 0.75);

		const systemPromptConfig = getSystemPromptConfig();
		setSystemPrompts(
			(systemPromptConfig?.prompts || []).map(p => ({id: p.id, name: p.name})),
		);
		setActiveSystemPromptId(systemPromptConfig?.active || '');

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

		// Temporarily save current config to use the latest baseUrl/apiKey
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
		if (currentField === 'toolResultTokenLimit')
			return toolResultTokenLimit.toString();
		if (currentField === 'editSimilarityThreshold')
			return editSimilarityThreshold.toString();
		if (currentField === 'thinkingBudgetTokens')
			return thinkingBudgetTokens.toString();
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

	const getSystemPromptSelectItems = () => {
		const activeLabel = activeSystemPromptId
			? t.configScreen.followGlobalWithParentheses.replace(
					'{name}',
					getSystemPromptNameById(activeSystemPromptId),
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

	const handleCreateProfile = () => {
		const cleaned = stripFocusArtifacts(newProfileName).trim();

		if (!cleaned) {
			setErrors([t.configScreen.profileNameEmpty]);
			return;
		}

		try {
			// Create new profile with current config
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
					showThinking,
					thinking: thinkingEnabled
						? {type: 'enabled' as const, budget_tokens: thinkingBudgetTokens}
						: undefined,
					advancedModel,
					basicModel,
					maxContextTokens,
					maxTokens,
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

	const handleDeleteProfile = () => {
		try {
			deleteProfile(activeProfile);
			// Important: Update activeProfile state BEFORE loading profiles
			// because deleteProfile switches to 'default' if the active profile is deleted
			const newActiveProfile = getActiveProfileName();
			setActiveProfile(newActiveProfile);
			loadProfilesAndConfig();
			setProfileMode('normal');
			setIsEditing(false);
			setErrors([]);
		} catch (err) {
			setErrors([
				err instanceof Error ? err.message : 'Failed to delete profile',
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

		// XHIGH 不再随模型变动而降级；仅在离开 responses 时由 useEffect 自动降级
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
				showThinking,
				advancedModel,
				basicModel,
				maxContextTokens,
				maxTokens,
				toolResultTokenLimit,
				editSimilarityThreshold,
			};

			// Save thinking configuration (always save to preserve settings)
			if (thinkingEnabled) {
				config.thinking = {
					type: 'enabled',
					budget_tokens: thinkingBudgetTokens,
				};
			} else {
				// Explicitly set to undefined to clear it when disabled
				config.thinking = undefined;
			}

			// Save Gemini thinking configuration
			if (geminiThinkingEnabled) {
				(config as any).geminiThinking = {
					enabled: true,
					budget: geminiThinkingBudget,
				};
			} else {
				(config as any).geminiThinking = undefined;
			}

			// Save Responses reasoning configuration (persist effort even when disabled)
			(config as any).responsesReasoning = {
				enabled: responsesReasoningEnabled,
				effort: responsesReasoningEffort,
			};

			// Save to main config
			await updateOpenAiConfig(config);

			// Also save to the current profile
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
						showThinking,
						thinking: thinkingEnabled
							? {type: 'enabled' as const, budget_tokens: thinkingBudgetTokens}
							: undefined,
						geminiThinking: geminiThinkingEnabled
							? {enabled: true, budget: geminiThinkingBudget}
							: undefined,
						responsesReasoning: {
							enabled: responsesReasoningEnabled,
							effort: responsesReasoningEffort,
						},
						advancedModel,
						basicModel,
						maxContextTokens,
						maxTokens,
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

	// Helper function to render a single field
	const renderField = (field: ConfigField) => {
		const isActive = field === currentField;
		const isCurrentlyEditing = isEditing && isActive;

		switch (field) {
			case 'profile':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.profile}
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{profiles.find(p => p.name === activeProfile)?.displayName ||
										activeProfile}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'baseUrl':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.baseUrl}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={baseUrl}
									onChange={value => setBaseUrl(stripFocusArtifacts(value))}
									placeholder="https://api.openai.com/v1"
								/>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{baseUrl || t.configScreen.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'apiKey':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.apiKey}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={apiKey}
									onChange={value => setApiKey(stripFocusArtifacts(value))}
									placeholder="sk-..."
									mask="*"
								/>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{apiKey
										? '*'.repeat(Math.min(apiKey.length, 20))
										: t.configScreen.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'requestMethod':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.requestMethod}
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{requestMethodOptions.find(opt => opt.value === requestMethod)
										?.label || t.configScreen.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'systemPromptId': {
				let display = t.configScreen.followGlobalNone;
				if (systemPromptId === '') {
					display = t.configScreen.notUse;
				} else if (systemPromptId) {
					display = getSystemPromptNameById(systemPromptId);
				} else if (activeSystemPromptId) {
					display = t.configScreen.followGlobal.replace(
						'{name}',
						getSystemPromptNameById(activeSystemPromptId),
					);
				}
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.systemPrompt}
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{display || t.configScreen.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);
			}

			case 'customHeadersSchemeId': {
				let display = t.configScreen.followGlobalNone;
				if (customHeadersSchemeId === '') {
					display = t.configScreen.notUse;
				} else if (customHeadersSchemeId) {
					display = getCustomHeadersSchemeNameById(customHeadersSchemeId);
				} else if (activeCustomHeadersSchemeId) {
					display = t.configScreen.followGlobal.replace(
						'{name}',
						getCustomHeadersSchemeNameById(activeCustomHeadersSchemeId),
					);
				}
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.customHeadersField}
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{display || t.configScreen.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);
			}

			case 'anthropicBeta':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.anthropicBeta}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{anthropicBeta
									? t.configScreen.enabled
									: t.configScreen.disabled}{' '}
								{t.configScreen.toggleHint}
							</Text>
						</Box>
					</Box>
				);

			case 'anthropicCacheTTL':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.anthropicCacheTTL}
						</Text>
						{isEditing && isActive ? (
							<Box marginLeft={3}>
								<ScrollableSelectInput
									items={[
										{label: t.configScreen.anthropicCacheTTL5m, value: '5m'},
										{label: t.configScreen.anthropicCacheTTL1h, value: '1h'},
									]}
									initialIndex={anthropicCacheTTL === '5m' ? 0 : 1}
									isFocused={true}
									onSelect={item => {
										setAnthropicCacheTTL(item.value as '5m' | '1h');
										setIsEditing(false);
									}}
								/>
							</Box>
						) : (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{anthropicCacheTTL === '5m'
										? t.configScreen.anthropicCacheTTL5m
										: t.configScreen.anthropicCacheTTL1h}{' '}
									{t.configScreen.toggleHint}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'enableAutoCompress':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.enableAutoCompress}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{enableAutoCompress
									? t.configScreen.enabled
									: t.configScreen.disabled}{' '}
								{t.configScreen.toggleHint}
							</Text>
						</Box>
					</Box>
				);

			case 'showThinking':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.showThinking}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{showThinking
									? t.configScreen.enabled
									: t.configScreen.disabled}{' '}
								{t.configScreen.toggleHint}
							</Text>
						</Box>
					</Box>
				);

			case 'thinkingEnabled':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.thinkingEnabled}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{thinkingEnabled
									? t.configScreen.enabled
									: t.configScreen.disabled}{' '}
								{t.configScreen.toggleHint}
							</Text>
						</Box>
					</Box>
				);

			case 'thinkingBudgetTokens':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.thinkingBudgetTokens}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									{t.configScreen.enterValue} {thinkingBudgetTokens}
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{thinkingBudgetTokens}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'geminiThinkingEnabled':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.geminiThinkingEnabled}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{geminiThinkingEnabled
									? t.configScreen.enabled
									: t.configScreen.disabled}{' '}
								{t.configScreen.toggleHint}
							</Text>
						</Box>
					</Box>
				);

			case 'geminiThinkingBudget':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.geminiThinkingBudget}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									{t.configScreen.enterValue} {geminiThinkingBudget}
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{geminiThinkingBudget}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'responsesReasoningEnabled':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.responsesReasoningEnabled}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{responsesReasoningEnabled
									? t.configScreen.enabled
									: t.configScreen.disabled}{' '}
								{t.configScreen.toggleHint}
							</Text>
						</Box>
					</Box>
				);

			case 'responsesReasoningEffort':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.responsesReasoningEffort}
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{responsesReasoningEffort.toUpperCase()}
								</Text>
							</Box>
						)}
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Select
									options={[
										{label: 'LOW', value: 'low'},
										{label: 'MEDIUM', value: 'medium'},
										{label: 'HIGH', value: 'high'},
										...(supportsXHigh
											? [{label: 'XHIGH', value: 'xhigh'}]
											: []),
									]}
									onChange={value => {
										setResponsesReasoningEffort(
											value as 'low' | 'medium' | 'high' | 'xhigh',
										);
										setIsEditing(false);
									}}
								/>
							</Box>
						)}
					</Box>
				);

			case 'advancedModel':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.advancedModel}
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{advancedModel || t.configScreen.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'basicModel':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.basicModel}
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{basicModel || t.configScreen.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'maxContextTokens':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.maxContextTokens}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									{t.configScreen.enterValue} {maxContextTokens}
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{maxContextTokens}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'maxTokens':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '> ' : '  '}
							{t.configScreen.maxTokens}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									{t.configScreen.enterValue} {maxTokens}
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>{maxTokens}</Text>
							</Box>
						)}
					</Box>
				);

			case 'toolResultTokenLimit':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '> ' : '  '}
							{t.configScreen.toolResultTokenLimit}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									{t.configScreen.enterValue} {toolResultTokenLimit}
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{toolResultTokenLimit}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'editSimilarityThreshold':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.configScreen.editSimilarityThreshold}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									{t.configScreen.enterValue}{' '}
									{editingThresholdValue || editSimilarityThreshold}
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{editSimilarityThreshold}
								</Text>
							</Box>
						)}
					</Box>
				);

			default:
				return null;
		}
	};

	useInput((rawInput, key) => {
		const input = stripFocusArtifacts(rawInput);

		if (!input && isFocusEventInput(rawInput)) {
			return;
		}

		if (isFocusEventInput(rawInput)) {
			return;
		}

		// Handle profile creation mode
		if (profileMode === 'creating') {
			if (key.return) {
				handleCreateProfile();
			} else if (key.escape) {
				setProfileMode('normal');
				setNewProfileName('');
				setErrors([]);
			}
			return;
		}

		// Handle profile deletion confirmation
		if (profileMode === 'deleting') {
			if (input === 'y' || input === 'Y') {
				handleDeleteProfile();
			} else if (input === 'n' || input === 'N' || key.escape) {
				setProfileMode('normal');
				setErrors([]);
			}
			return;
		}

		// Handle profile shortcuts (only when in normal profile mode)
		if (
			profileMode === 'normal' &&
			currentField === 'profile' &&
			(input === 'n' || input === 'N')
		) {
			// Handle profile creation (works in both normal and editing mode)
			setProfileMode('creating');
			setNewProfileName('');
			setIsEditing(false); // Exit Select editing mode
			return;
		}

		if (
			profileMode === 'normal' &&
			currentField === 'profile' &&
			(input === 'd' || input === 'D')
		) {
			// Handle profile deletion (works in both normal and editing mode)
			if (activeProfile === 'default') {
				setErrors([t.configScreen.cannotDeleteDefault]);
				setIsEditing(false);
				return;
			}
			setProfileMode('deleting');
			setIsEditing(false); // Exit Select editing mode
			return;
		}

		// Handle loading state
		if (loading) {
			if (key.escape) {
				setLoading(false);
			}
			return;
		}

		// Handle manual input mode
		if (manualInputMode) {
			if (key.return) {
				const cleaned = stripFocusArtifacts(manualInputValue).trim();
				if (cleaned) {
					if (currentField === 'advancedModel') {
						setAdvancedModel(cleaned);
					} else if (currentField === 'basicModel') {
						setBasicModel(cleaned);
					}
				}
				setManualInputMode(false);
				setManualInputValue('');
				setIsEditing(false);
				setSearchTerm('');
			} else if (key.escape) {
				setManualInputMode(false);
				setManualInputValue('');
			} else if (key.backspace || key.delete) {
				setManualInputValue(prev => prev.slice(0, -1));
			} else if (input && input.match(/[a-zA-Z0-9-_./:]/)) {
				setManualInputValue(prev => prev + stripFocusArtifacts(input));
			}
			return;
		}

		// Allow Escape key to exit Select component
		if (
			isEditing &&
			(currentField === 'profile' ||
				currentField === 'requestMethod' ||
				currentField === 'systemPromptId' ||
				currentField === 'customHeadersSchemeId' ||
				currentField === 'anthropicCacheTTL' ||
				currentField === 'advancedModel' ||
				currentField === 'basicModel' ||
				currentField === 'responsesReasoningEffort') &&
			key.escape
		) {
			setIsEditing(false);
			setSearchTerm('');
			// Force re-render to clear Select component artifacts
			forceUpdate(prev => prev + 1);
			return;
		}

		// Handle editing mode
		if (isEditing) {
			// For baseUrl and apiKey, TextInput component handles all input, just handle Return to exit
			if (currentField === 'baseUrl' || currentField === 'apiKey') {
				if (key.return) {
					setIsEditing(false);
				}
				return;
			}

			// Handle numeric input for token fields
			if (
				currentField === 'maxContextTokens' ||
				currentField === 'maxTokens' ||
				currentField === 'toolResultTokenLimit' ||
				currentField === 'thinkingBudgetTokens' ||
				currentField === 'geminiThinkingBudget' ||
				currentField === 'editSimilarityThreshold'
			) {
				// Handle decimal numbers for editSimilarityThreshold
				if (currentField === 'editSimilarityThreshold') {
					if (input && input.match(/[0-9.]/)) {
						const currentStr =
							editingThresholdValue || editSimilarityThreshold.toString();
						// Prevent multiple decimal points
						if (input === '.' && currentStr.includes('.')) {
							return;
						}
						const newStr = currentStr + input;
						// Only update display if it's a valid partial number
						if (
							newStr === '.' ||
							newStr === '0.' ||
							/^[0-9]*\.?[0-9]*$/.test(newStr)
						) {
							setEditingThresholdValue(newStr);
						}
					} else if (key.backspace || key.delete) {
						const currentStr =
							editingThresholdValue || editSimilarityThreshold.toString();
						const newStr = currentStr.slice(0, -1);
						setEditingThresholdValue(newStr);
					} else if (key.return) {
						const valueToSave =
							editingThresholdValue || editSimilarityThreshold.toString();
						const finalValue = parseFloat(valueToSave);
						if (!isNaN(finalValue) && finalValue >= 0.1 && finalValue <= 1) {
							setEditSimilarityThreshold(finalValue);
						} else if (finalValue < 0.1) {
							setEditSimilarityThreshold(0.1);
						} else {
							// Invalid input, keep original value
						}
						setEditingThresholdValue('');
						setIsEditing(false);
					}
					return;
				}

				if (input && input.match(/[0-9]/)) {
					const currentValue =
						currentField === 'maxContextTokens'
							? maxContextTokens
							: currentField === 'maxTokens'
							? maxTokens
							: currentField === 'toolResultTokenLimit'
							? toolResultTokenLimit
							: currentField === 'thinkingBudgetTokens'
							? thinkingBudgetTokens
							: geminiThinkingBudget;
					const newValue = parseInt(currentValue.toString() + input, 10);
					if (!isNaN(newValue)) {
						if (currentField === 'maxContextTokens') {
							setMaxContextTokens(newValue);
						} else if (currentField === 'maxTokens') {
							setMaxTokens(newValue);
						} else if (currentField === 'toolResultTokenLimit') {
							setToolResultTokenLimit(newValue);
						} else if (currentField === 'thinkingBudgetTokens') {
							setThinkingBudgetTokens(newValue);
						} else {
							setGeminiThinkingBudget(newValue);
						}
					}
				} else if (key.backspace || key.delete) {
					const currentValue =
						currentField === 'maxContextTokens'
							? maxContextTokens
							: currentField === 'maxTokens'
							? maxTokens
							: currentField === 'toolResultTokenLimit'
							? toolResultTokenLimit
							: currentField === 'thinkingBudgetTokens'
							? thinkingBudgetTokens
							: geminiThinkingBudget;
					const currentStr = currentValue.toString();
					const newStr = currentStr.slice(0, -1);
					const newValue = parseInt(newStr, 10);
					if (currentField === 'maxContextTokens') {
						setMaxContextTokens(!isNaN(newValue) ? newValue : 0);
					} else if (currentField === 'maxTokens') {
						setMaxTokens(!isNaN(newValue) ? newValue : 0);
					} else if (currentField === 'toolResultTokenLimit') {
						setToolResultTokenLimit(!isNaN(newValue) ? newValue : 0);
					} else if (currentField === 'thinkingBudgetTokens') {
						setThinkingBudgetTokens(!isNaN(newValue) ? newValue : 0);
					} else {
						setGeminiThinkingBudget(!isNaN(newValue) ? newValue : 0);
					}
				} else if (key.return) {
					const minValue =
						currentField === 'maxContextTokens'
							? 4000
							: currentField === 'maxTokens'
							? 100
							: currentField === 'toolResultTokenLimit'
							? 1000
							: currentField === 'thinkingBudgetTokens'
							? 1000
							: 1;
					const currentValue =
						currentField === 'maxContextTokens'
							? maxContextTokens
							: currentField === 'maxTokens'
							? maxTokens
							: currentField === 'toolResultTokenLimit'
							? toolResultTokenLimit
							: currentField === 'thinkingBudgetTokens'
							? thinkingBudgetTokens
							: geminiThinkingBudget;
					const finalValue = currentValue < minValue ? minValue : currentValue;
					if (currentField === 'maxContextTokens') {
						setMaxContextTokens(finalValue);
					} else if (currentField === 'maxTokens') {
						setMaxTokens(finalValue);
					} else if (currentField === 'toolResultTokenLimit') {
						setToolResultTokenLimit(finalValue);
					} else if (currentField === 'thinkingBudgetTokens') {
						setThinkingBudgetTokens(finalValue);
					} else {
						setGeminiThinkingBudget(finalValue);
					}
					setIsEditing(false);
				}
				return;
			}

			// Allow typing to filter for model selection
			if (input && input.match(/[a-zA-Z0-9-_.]/)) {
				setSearchTerm(prev => prev + input);
			} else if (key.backspace || key.delete) {
				setSearchTerm(prev => prev.slice(0, -1));
			}
			return;
		}

		// Handle save/exit globally
		if (input === 's' && (key.ctrl || key.meta)) {
			saveConfiguration().then(success => {
				if (success) {
					onSave();
				}
			});
		} else if (key.escape) {
			saveConfiguration().then(() => onBack());
		} else if (key.return) {
			if (isEditing) {
				setIsEditing(false);
			} else {
				// Enter edit mode
				if (currentField === 'anthropicBeta') {
					setAnthropicBeta(!anthropicBeta);
				} else if (currentField === 'anthropicCacheTTL') {
					setIsEditing(true);
				} else if (currentField === 'enableAutoCompress') {
					setEnableAutoCompress(!enableAutoCompress);
				} else if (currentField === 'showThinking') {
					setShowThinking(!showThinking);
				} else if (currentField === 'thinkingEnabled') {
					setThinkingEnabled(!thinkingEnabled);
				} else if (currentField === 'geminiThinkingEnabled') {
					setGeminiThinkingEnabled(!geminiThinkingEnabled);
				} else if (currentField === 'responsesReasoningEnabled') {
					setResponsesReasoningEnabled(!responsesReasoningEnabled);
				} else if (
					currentField === 'maxContextTokens' ||
					currentField === 'maxTokens' ||
					currentField === 'toolResultTokenLimit' ||
					currentField === 'thinkingBudgetTokens' ||
					currentField === 'geminiThinkingBudget'
				) {
					setIsEditing(true);
				} else if (currentField === 'editSimilarityThreshold') {
					setEditingThresholdValue('');
					setIsEditing(true);
				} else if (currentField === 'responsesReasoningEffort') {
					setIsEditing(true);
				} else if (
					currentField === 'advancedModel' ||
					currentField === 'basicModel'
				) {
					// Load models for model fields
					setLoadError(''); // Clear previous error
					loadModels()
						.then(() => {
							setIsEditing(true);
						})
						.catch(() => {
							// Error is already set in loadModels, just enter manual input mode
							setManualInputMode(true);
							setManualInputValue(getCurrentValue());
						});
				} else {
					setIsEditing(true);
				}
			}
		} else if (input === 'm' && !isEditing) {
			// Shortcut: press 'm' for manual input mode
			if (currentField === 'advancedModel' || currentField === 'basicModel') {
				setManualInputMode(true);
				setManualInputValue(getCurrentValue());
			}
		} else if (!isEditing && key.upArrow) {
			const fields = getAllFields();
			const currentIndex = fields.indexOf(currentField);
			// 向上导航:第一项 → 最后一项,其他 → 前一项 (标准循环导航)
			const nextIndex = currentIndex > 0 ? currentIndex - 1 : fields.length - 1;
			setCurrentField(fields[nextIndex]!);
		} else if (!isEditing && key.downArrow) {
			const fields = getAllFields();
			const currentIndex = fields.indexOf(currentField);
			// 向下导航:最后一项 → 第一项,其他 → 后一项 (标准循环导航)
			const nextIndex = currentIndex < fields.length - 1 ? currentIndex + 1 : 0;
			setCurrentField(fields[nextIndex]!);
		}
	});

	// Render profile creation mode
	if (profileMode === 'creating') {
		return (
			<Box flexDirection="column" padding={1}>
				{!inlineMode && (
					<Box
						marginBottom={1}
						borderStyle="double"
						borderColor={theme.colors.menuInfo}
						paddingX={2}
					>
						<Box flexDirection="column">
							<Gradient name="rainbow">
								{t.configScreen.createNewProfile}
							</Gradient>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.configScreen.enterProfileName}
							</Text>
						</Box>
					</Box>
				)}

				<Box flexDirection="column">
					<Text color={theme.colors.menuInfo}>Profile Name:</Text>
					<Box marginLeft={2}>
						<TextInput
							value={newProfileName}
							onChange={value => setNewProfileName(stripFocusArtifacts(value))}
							placeholder={t.configScreen.profileNamePlaceholder}
						/>
					</Box>
				</Box>

				{errors.length > 0 && (
					<Box marginTop={1}>
						<Text color={theme.colors.error}>{errors[0]}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Alert variant="info">{t.configScreen.createHint}</Alert>
				</Box>
			</Box>
		);
	}

	// Render profile deletion confirmation
	if (profileMode === 'deleting') {
		return (
			<Box flexDirection="column" padding={1}>
				{!inlineMode && (
					<Box
						marginBottom={1}
						borderStyle="double"
						borderColor={theme.colors.menuInfo}
						paddingX={2}
					>
						<Box flexDirection="column">
							<Gradient name="rainbow">{t.configScreen.deleteProfile}</Gradient>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.configScreen.confirmDelete}
							</Text>
						</Box>
					</Box>
				)}

				<Box flexDirection="column">
					<Text color={theme.colors.warning}>
						Are you sure you want to delete the profile &quot;{activeProfile}
						&quot;?
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.configScreen.deleteWarning}
					</Text>
				</Box>

				{errors.length > 0 && (
					<Box marginTop={1}>
						<Text color={theme.colors.error}>{errors[0]}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Alert variant="warning">{t.configScreen.confirmHint}</Alert>
				</Box>
			</Box>
		);
	}

	if (loading) {
		return (
			<Box flexDirection="column" padding={1}>
				{!inlineMode && (
					<Box
						marginBottom={1}
						borderStyle="double"
						borderColor={theme.colors.menuInfo}
						paddingX={2}
					>
						<Box flexDirection="column">
							<Gradient name="rainbow">{t.configScreen.title}</Gradient>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.configScreen.loadingMessage}
							</Text>
						</Box>
					</Box>
				)}

				<Box flexDirection="column">
					<Box>
						<Spinner type="dots" />
						<Text color={theme.colors.menuInfo}>
							{' '}
							{t.configScreen.fetchingModels}
						</Text>
					</Box>
					<Box marginLeft={2}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.configScreen.fetchingHint}
						</Text>
					</Box>
				</Box>

				<Box flexDirection="column" marginTop={1}>
					<Alert variant="info">{t.configScreen.loadingCancelHint}</Alert>
				</Box>
			</Box>
		);
	}

	if (manualInputMode) {
		return (
			<Box flexDirection="column" padding={1}>
				{!inlineMode && (
					<Box
						marginBottom={1}
						borderStyle="double"
						borderColor={theme.colors.menuInfo}
						paddingX={2}
					>
						<Box flexDirection="column">
							<Gradient name="rainbow">
								{t.configScreen.manualInputTitle}
							</Gradient>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.configScreen.manualInputSubtitle}
							</Text>
						</Box>
					</Box>
				)}

				{loadError && (
					<Box flexDirection="column" marginBottom={1}>
						<Text color={theme.colors.warning}>
							{t.configScreen.loadingError}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{loadError}
						</Text>
					</Box>
				)}

				<Box flexDirection="column">
					<Text color={theme.colors.menuInfo}>
						{currentField === 'advancedModel' && t.configScreen.advancedModel}
						{currentField === 'basicModel' && t.configScreen.basicModel}
					</Text>
					<Box marginLeft={2}>
						<Text color={theme.colors.menuSelected}>
							{`> ${manualInputValue}`}
							<Text color={theme.colors.menuNormal}>_</Text>
						</Text>
					</Box>
				</Box>

				<Box flexDirection="column" marginTop={1}>
					<Alert variant="info">{t.configScreen.manualInputHint}</Alert>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box
					marginBottom={1}
					borderStyle="double"
					borderColor={theme.colors.menuInfo}
					paddingX={2}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">{t.configScreen.title}</Gradient>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.configScreen.subtitle}
						</Text>
						{activeProfile && (
							<Text color={theme.colors.menuInfo} dimColor>
								{t.configScreen.activeProfile} {activeProfile}
							</Text>
						)}
					</Box>
				</Box>
			)}

			{/* Position indicator - always visible */}
			<Box marginBottom={1}>
				<Text color={theme.colors.warning} bold>
					{t.configScreen.settingsPosition} ({currentFieldIndex + 1}/
					{totalFields})
				</Text>
				{totalFields > MAX_VISIBLE_FIELDS && (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.configScreen.scrollHint}
						{hiddenAboveFieldsCount > 0 && (
							<>
								·{' '}
								{t.configScreen.moreAbove.replace(
									'{count}',
									hiddenAboveFieldsCount.toString(),
								)}
							</>
						)}
						{hiddenBelowFieldsCount > 0 && (
							<>
								·{' '}
								{t.configScreen.moreBelow.replace(
									'{count}',
									hiddenBelowFieldsCount.toString(),
								)}
							</>
						)}
					</Text>
				)}
			</Box>

			{/* When editing with Select, show simplified view */}
			{isEditing &&
			(currentField === 'profile' ||
				currentField === 'requestMethod' ||
				currentField === 'systemPromptId' ||
				currentField === 'customHeadersSchemeId' ||
				currentField === 'advancedModel' ||
				currentField === 'basicModel' ||
				currentField === 'responsesReasoningEffort') ? (
				<Box flexDirection="column">
					<Text color={theme.colors.menuSelected}>
						❯{' '}
						{currentField === 'profile' &&
							t.configScreen.profile.replace(':', '')}
						{currentField === 'requestMethod' &&
							t.configScreen.requestMethod.replace(':', '')}
						{currentField === 'advancedModel' &&
							t.configScreen.advancedModel.replace(':', '')}
						{currentField === 'basicModel' &&
							t.configScreen.basicModel.replace(':', '')}
						{currentField === 'responsesReasoningEffort' &&
							t.configScreen.responsesReasoningEffort.replace(':', '')}
						{currentField === 'systemPromptId' && t.configScreen.systemPrompt}
						{currentField === 'customHeadersSchemeId' &&
							t.configScreen.customHeadersField}
					</Text>
					<Box marginLeft={3} marginTop={1}>
						{currentField === 'profile' && (
							<Box flexDirection="column">
								{profiles.length > 1 && (
									<Text color={theme.colors.menuSecondary} dimColor>
										Scroll to see more profiles (↑↓)
									</Text>
								)}
								<ScrollableSelectInput
									items={profiles.map(p => ({
										label: p.isActive
											? `${p.displayName} \x1b[32m✓\x1b[0m`
											: p.displayName,
										value: p.name,
									}))}
									limit={5}
									initialIndex={Math.max(
										0,
										profiles.findIndex(p => p.name === activeProfile),
									)}
									isFocused={true}
									onSelect={item => {
										switchProfile(item.value);
										loadProfilesAndConfig();
										setIsEditing(false);
										setErrors([]);
									}}
								/>
								<Box flexDirection="row" marginTop={1}>
									<Box marginRight={2}>
										<Text color={theme.colors.menuSelected}>
											{t.configScreen.newProfile}
										</Text>
										<Text color={theme.colors.menuSecondary}> (n)</Text>
									</Box>
									<Box>
										<Text color={theme.colors.error}>
											{t.configScreen.deleteProfileShort}
										</Text>
										<Text color={theme.colors.menuSecondary}> (d)</Text>
									</Box>
								</Box>
							</Box>
						)}
						{currentField === 'requestMethod' && (
							<ScrollableSelectInput
								items={requestMethodOptions}
								initialIndex={requestMethodOptions.findIndex(
									opt => opt.value === requestMethod,
								)}
								isFocused={true}
								onSelect={item => {
									setRequestMethod(item.value as RequestMethod);
									setIsEditing(false);
								}}
							/>
						)}
						{currentField === 'systemPromptId' &&
							(() => {
								const items = getSystemPromptSelectItems();
								const selected = getSystemPromptSelectedValue();
								return (
									<ScrollableSelectInput
										items={items}
										limit={10}
										initialIndex={Math.max(
											0,
											items.findIndex(opt => opt.value === selected),
										)}
										isFocused={true}
										onSelect={item => {
											applySystemPromptSelectValue(item.value);
											setIsEditing(false);
										}}
									/>
								);
							})()}
						{currentField === 'customHeadersSchemeId' &&
							(() => {
								const items = getCustomHeadersSchemeSelectItems();
								const selected = getCustomHeadersSchemeSelectedValue();
								return (
									<ScrollableSelectInput
										items={items}
										limit={10}
										initialIndex={Math.max(
											0,
											items.findIndex(opt => opt.value === selected),
										)}
										isFocused={true}
										onSelect={item => {
											applyCustomHeadersSchemeSelectValue(item.value);
											setIsEditing(false);
										}}
									/>
								);
							})()}
						{(currentField === 'advancedModel' ||
							currentField === 'basicModel') && (
							<Box flexDirection="column">
								{searchTerm && (
									<Text color={theme.colors.menuInfo}>
										Filter: {searchTerm}
									</Text>
								)}
								<ScrollableSelectInput
									items={getCurrentOptions()}
									limit={10}
									disableNumberShortcuts={true}
									initialIndex={Math.max(
										0,
										getCurrentOptions().findIndex(
											opt => opt.value === getCurrentValue(),
										),
									)}
									isFocused={true}
									onSelect={item => {
										handleModelChange(item.value);
									}}
								/>
							</Box>
						)}
						{currentField === 'responsesReasoningEffort' && (
							<ScrollableSelectInput
								items={[
									{label: 'LOW', value: 'low'},
									{label: 'MEDIUM', value: 'medium'},
									{label: 'HIGH', value: 'high'},
									...(supportsXHigh ? [{label: 'XHIGH', value: 'xhigh'}] : []),
								]}
								initialIndex={[
									{label: 'LOW', value: 'low'},
									{label: 'MEDIUM', value: 'medium'},
									{label: 'HIGH', value: 'high'},
									...(supportsXHigh ? [{label: 'XHIGH', value: 'xhigh'}] : []),
								].findIndex(opt => opt.value === responsesReasoningEffort)}
								isFocused={true}
								onSelect={item => {
									// If xhigh selected but unsupported, force reset to high
									const nextEffort = item.value as
										| 'low'
										| 'medium'
										| 'high'
										| 'xhigh';
									setResponsesReasoningEffort(
										nextEffort === 'xhigh' && !supportsXHigh
											? 'high'
											: nextEffort,
									);
									setIsEditing(false);
								}}
							/>
						)}
					</Box>
				</Box>
			) : (
				<Box flexDirection="column">
					{/* Scrollable field list */}
					{fieldsDisplayWindow.items.map(field => renderField(field))}
				</Box>
			)}

			{errors.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color={theme.colors.error} bold>
						{t.configScreen.errors}
					</Text>
					{errors.map((error, index) => (
						<Text key={index} color={theme.colors.error}>
							• {error}
						</Text>
					))}
				</Box>
			)}

			{/* Only show navigation hints when not in Select editing mode */}
			{!(
				isEditing &&
				(currentField === 'profile' ||
					currentField === 'requestMethod' ||
					currentField === 'systemPromptId' ||
					currentField === 'customHeadersSchemeId' ||
					currentField === 'advancedModel' ||
					currentField === 'basicModel' ||
					currentField === 'responsesReasoningEffort')
			) && (
				<Box flexDirection="column" marginTop={1}>
					{isEditing ? (
						<Alert variant="info">
							{currentField === 'maxContextTokens' ||
							currentField === 'maxTokens'
								? t.configScreen.editingHintNumeric
								: t.configScreen.editingHintGeneral}
						</Alert>
					) : (
						<Alert variant="info">{t.configScreen.navigationHint}</Alert>
					)}
				</Box>
			)}
		</Box>
	);
}
