import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import Gradient from 'ink-gradient';
import {Select, Alert, Spinner} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getOpenAiConfig,
	updateOpenAiConfig,
	validateApiConfig,
	type RequestMethod,
	type ApiConfig,
} from '../../utils/apiConfig.js';
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
} from '../../utils/configManager.js';

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
	| 'anthropicBeta'
	| 'thinkingEnabled'
	| 'thinkingBudgetTokens'
	| 'geminiThinkingEnabled'
	| 'geminiThinkingBudget'
	| 'responsesReasoningEnabled'
	| 'responsesReasoningEffort'
	| 'advancedModel'
	| 'basicModel'
	| 'compactModelName'
	| 'maxContextTokens'
	| 'maxTokens';

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
	// Profile management
	const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
	const [activeProfile, setActiveProfile] = useState('');
	const [profileMode, setProfileMode] = useState<ProfileMode>('normal');
	const [newProfileName, setNewProfileName] = useState('');

	// API settings
	const [baseUrl, setBaseUrl] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [requestMethod, setRequestMethod] = useState<RequestMethod>('chat');
	const [anthropicBeta, setAnthropicBeta] = useState(false);
	const [thinkingEnabled, setThinkingEnabled] = useState(false);
	const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState(10000);
	const [geminiThinkingEnabled, setGeminiThinkingEnabled] = useState(false);
	const [geminiThinkingBudget, setGeminiThinkingBudget] = useState(1024);
	const [responsesReasoningEnabled, setResponsesReasoningEnabled] = useState(false);
	const [responsesReasoningEffort, setResponsesReasoningEffort] = useState<'low' | 'medium' | 'high'>('high');

	// Model settings
	const [advancedModel, setAdvancedModel] = useState('');
	const [basicModel, setBasicModel] = useState('');
	const [maxContextTokens, setMaxContextTokens] = useState(4000);
	const [maxTokens, setMaxTokens] = useState(4096);
	const [compactModelName, setCompactModelName] = useState('');

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
	const [, forceUpdate] = useState(0);

	// Scrolling configuration
	const MAX_VISIBLE_FIELDS = 8;

	const requestMethodOptions = [
		{
			label: 'Chat Completions - Modern chat API (GPT-4, GPT-3.5-turbo)',
			value: 'chat' as RequestMethod,
		},
		{
			label: 'Responses - New responses API (2025, with built-in tools)',
			value: 'responses' as RequestMethod,
		},
		{
			label: 'Gemini - Google Gemini API',
			value: 'gemini' as RequestMethod,
		},
		{
			label: 'Anthropic - Claude API',
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
			...(requestMethod === 'anthropic'
				? [
						'anthropicBeta' as ConfigField,
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
			'compactModelName',
			'maxContextTokens',
			'maxTokens',
		];
	};

	// Get current field index and total count
	const allFields = getAllFields();
	const currentFieldIndex = allFields.indexOf(currentField);
	const totalFields = allFields.length;

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

	const loadProfilesAndConfig = () => {
		// Load profiles
		const loadedProfiles = getAllProfiles();
		setProfiles(loadedProfiles);

		// Load current config
		const config = getOpenAiConfig();
		setBaseUrl(config.baseUrl);
		setApiKey(config.apiKey);
		setRequestMethod(config.requestMethod || 'chat');
		setAnthropicBeta(config.anthropicBeta || false);
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
		setCompactModelName(config.compactModel?.modelName || '');
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
		updateOpenAiConfig(tempConfig);

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
			{label: 'Manual Input (Enter model name)', value: '__MANUAL_INPUT__'},
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
		if (currentField === 'thinkingBudgetTokens')
			return thinkingBudgetTokens.toString();
		if (currentField === 'geminiThinkingBudget')
			return geminiThinkingBudget.toString();
		if (currentField === 'responsesReasoningEffort') return responsesReasoningEffort;
		if (currentField === 'compactModelName') return compactModelName;
		return '';
	};

	const handleCreateProfile = () => {
		const cleaned = stripFocusArtifacts(newProfileName).trim();

		if (!cleaned) {
			setErrors(['Profile name cannot be empty']);
			return;
		}

		try {
			// Create new profile with current config
			const currentConfig = {
				snowcfg: {
					baseUrl,
					apiKey,
					requestMethod,
					anthropicBeta,
					thinking: thinkingEnabled
						? {type: 'enabled' as const, budget_tokens: thinkingBudgetTokens}
						: undefined,
					advancedModel,
					basicModel,
					maxContextTokens,
					maxTokens,
					compactModel: compactModelName
						? {modelName: compactModelName}
						: undefined,
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
		} else if (currentField === 'compactModelName') {
			setCompactModelName(value);
		}
		setIsEditing(false);
		setSearchTerm('');
	};

	const saveConfiguration = () => {
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
				anthropicBeta,
				advancedModel,
				basicModel,
				maxContextTokens,
				maxTokens,
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

			// Save Responses reasoning configuration
			if (responsesReasoningEnabled) {
				(config as any).responsesReasoning = {
					enabled: true,
					effort: responsesReasoningEffort,
				};
			} else {
				(config as any).responsesReasoning = undefined;
			}

			// Only save compactModel if modelName is provided (uses same baseUrl/apiKey)
			if (compactModelName) {
				config.compactModel = {
					modelName: compactModelName,
				};
			}

			// Save to main config
			updateOpenAiConfig(config);

			// Also save to the current profile
			try {
				const fullConfig = {
					snowcfg: {
						baseUrl,
						apiKey,
						requestMethod,
						anthropicBeta,
						thinking: thinkingEnabled
							? {type: 'enabled' as const, budget_tokens: thinkingBudgetTokens}
							: undefined,
						geminiThinking: geminiThinkingEnabled
							? {enabled: true, budget: geminiThinkingBudget}
							: undefined,
						responsesReasoning: responsesReasoningEnabled
							? {enabled: true, effort: responsesReasoningEffort}
							: undefined,
						advancedModel,
						basicModel,
						maxContextTokens,
						maxTokens,
						compactModel: compactModelName
							? {modelName: compactModelName}
							: undefined,
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
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Profile:
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">
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
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Base URL:
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
								<Text color="gray">{baseUrl || 'Not set'}</Text>
							</Box>
						)}
					</Box>
				);

			case 'apiKey':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}API Key:
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
								<Text color="gray">
									{apiKey ? '*'.repeat(Math.min(apiKey.length, 20)) : 'Not set'}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'requestMethod':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Request Method:
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">
									{requestMethodOptions.find(opt => opt.value === requestMethod)
										?.label || 'Not set'}
								</Text>
							</Box>
						)}
					</Box>
				);

			case 'anthropicBeta':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Anthropic Beta:
						</Text>
						<Box marginLeft={3}>
							<Text color="gray">
								{anthropicBeta ? '☒ Enabled' : '☐ Disabled'} (Press Enter to
								toggle)
							</Text>
						</Box>
					</Box>
				);

			case 'thinkingEnabled':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Thinking Enabled:
						</Text>
						<Box marginLeft={3}>
							<Text color="gray">
								{thinkingEnabled ? '☒ Enabled' : '☐ Disabled'} (Press Enter to
								toggle)
							</Text>
						</Box>
					</Box>
				);

			case 'thinkingBudgetTokens':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Thinking Budget Tokens:
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">Enter value: {thinkingBudgetTokens}</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">{thinkingBudgetTokens}</Text>
							</Box>
						)}
					</Box>
				);

			case 'geminiThinkingEnabled':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Gemini Thinking Enabled:
						</Text>
						<Box marginLeft={3}>
							<Text color="gray">
								{geminiThinkingEnabled ? '☒ Enabled' : '☐ Disabled'} (Press Enter to
								toggle)
							</Text>
						</Box>
					</Box>
				);

			case 'geminiThinkingBudget':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Gemini Thinking Budget:
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">Enter value: {geminiThinkingBudget}</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">{geminiThinkingBudget}</Text>
							</Box>
						)}
					</Box>
				);

			case 'responsesReasoningEnabled':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Responses Reasoning Enabled:
						</Text>
						<Box marginLeft={3}>
							<Text color="gray">
								{responsesReasoningEnabled ? '☒ Enabled' : '☐ Disabled'} (Press Enter to
								toggle)
							</Text>
						</Box>
					</Box>
				);

			case 'responsesReasoningEffort':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Responses Reasoning Effort:
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">{responsesReasoningEffort.toUpperCase()}</Text>
							</Box>
						)}
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Select
									options={[
										{label: 'Low', value: 'low'},
										{label: 'Medium', value: 'medium'},
										{label: 'High', value: 'high'},
									]}
									defaultValue={responsesReasoningEffort}
									onChange={value => {
										setResponsesReasoningEffort(value as 'low' | 'medium' | 'high');
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
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Advanced Model:
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">{advancedModel || 'Not set'}</Text>
							</Box>
						)}
					</Box>
				);

			case 'basicModel':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Basic Model:
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">{basicModel || 'Not set'}</Text>
							</Box>
						)}
					</Box>
				);

			case 'compactModelName':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Compact Model:
						</Text>
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">{compactModelName || 'Not set'}</Text>
							</Box>
						)}
					</Box>
				);

			case 'maxContextTokens':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Max Context Tokens:
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">Enter value: {maxContextTokens}</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">{maxContextTokens}</Text>
							</Box>
						)}
					</Box>
				);

			case 'maxTokens':
				return (
					<Box key={field} flexDirection="column">
						<Text color={isActive ? 'green' : 'white'}>
							{isActive ? '❯ ' : '  '}Max Tokens:
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">Enter value: {maxTokens}</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color="gray">{maxTokens}</Text>
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
				setErrors(['Cannot delete the default profile']);
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
					} else if (currentField === 'compactModelName') {
						setCompactModelName(cleaned);
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
				currentField === 'advancedModel' ||
				currentField === 'basicModel' ||
				currentField === 'compactModelName' ||
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
				currentField === 'thinkingBudgetTokens' ||
				currentField === 'geminiThinkingBudget'
			) {
				if (input && input.match(/[0-9]/)) {
					const currentValue =
						currentField === 'maxContextTokens'
							? maxContextTokens
							: currentField === 'maxTokens'
							? maxTokens
							: currentField === 'thinkingBudgetTokens'
							? thinkingBudgetTokens
							: geminiThinkingBudget;
					const newValue = parseInt(currentValue.toString() + input, 10);
					if (!isNaN(newValue)) {
						if (currentField === 'maxContextTokens') {
							setMaxContextTokens(newValue);
						} else if (currentField === 'maxTokens') {
							setMaxTokens(newValue);
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
							: currentField === 'thinkingBudgetTokens'
							? 1000
							: 1;
					const currentValue =
						currentField === 'maxContextTokens'
							? maxContextTokens
							: currentField === 'maxTokens'
							? maxTokens
							: currentField === 'thinkingBudgetTokens'
							? thinkingBudgetTokens
							: geminiThinkingBudget;
					const finalValue = currentValue < minValue ? minValue : currentValue;
					if (currentField === 'maxContextTokens') {
						setMaxContextTokens(finalValue);
					} else if (currentField === 'maxTokens') {
						setMaxTokens(finalValue);
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
			if (saveConfiguration()) {
				onSave();
			}
		} else if (key.escape) {
			saveConfiguration();
			onBack();
		} else if (key.return) {
			if (isEditing) {
				setIsEditing(false);
			} else {
				// Enter edit mode
				if (currentField === 'anthropicBeta') {
					setAnthropicBeta(!anthropicBeta);
				} else if (currentField === 'thinkingEnabled') {
					setThinkingEnabled(!thinkingEnabled);
				} else if (currentField === 'geminiThinkingEnabled') {
					setGeminiThinkingEnabled(!geminiThinkingEnabled);
				} else if (currentField === 'responsesReasoningEnabled') {
					setResponsesReasoningEnabled(!responsesReasoningEnabled);
				} else if (
					currentField === 'maxContextTokens' ||
					currentField === 'maxTokens' ||
					currentField === 'thinkingBudgetTokens' ||
					currentField === 'geminiThinkingBudget'
				) {
					setIsEditing(true);
				} else if (currentField === 'responsesReasoningEffort') {
					setIsEditing(true);
				} else if (
					currentField === 'advancedModel' ||
					currentField === 'basicModel' ||
					currentField === 'compactModelName'
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
			if (
				currentField === 'advancedModel' ||
				currentField === 'basicModel' ||
				currentField === 'compactModelName'
			) {
				setManualInputMode(true);
				setManualInputValue(getCurrentValue());
			}
		} else if (!isEditing && key.upArrow) {
			const fields = getAllFields();
			const currentIndex = fields.indexOf(currentField);
			if (currentIndex > 0) {
				setCurrentField(fields[currentIndex - 1]!);
			}
		} else if (!isEditing && key.downArrow) {
			const fields = getAllFields();
			const currentIndex = fields.indexOf(currentField);
			if (currentIndex < fields.length - 1) {
				setCurrentField(fields[currentIndex + 1]!);
			}
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
						borderColor={'cyan'}
						paddingX={2}
					>
						<Box flexDirection="column">
							<Gradient name="rainbow">Create New Profile</Gradient>
							<Text color="gray" dimColor>
								Enter a name for the new configuration profile
							</Text>
						</Box>
					</Box>
				)}

				<Box flexDirection="column">
					<Text color="cyan">Profile Name:</Text>
					<Box marginLeft={2}>
						<TextInput
							value={newProfileName}
							onChange={value => setNewProfileName(stripFocusArtifacts(value))}
							placeholder="e.g., work, personal, test"
						/>
					</Box>
				</Box>

				{errors.length > 0 && (
					<Box marginTop={1}>
						<Text color="red">{errors[0]}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Alert variant="info">Press Enter to create, Esc to cancel</Alert>
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
						borderColor={'cyan'}
						paddingX={2}
					>
						<Box flexDirection="column">
							<Gradient name="rainbow">Delete Profile</Gradient>
							<Text color="gray" dimColor>
								Confirm profile deletion
							</Text>
						</Box>
					</Box>
				)}

				<Box flexDirection="column">
					<Text color="yellow">
						Are you sure you want to delete the profile &quot;{activeProfile}
						&quot;?
					</Text>
					<Text color="gray" dimColor>
						This action cannot be undone. You will be switched to the default
						profile.
					</Text>
				</Box>

				{errors.length > 0 && (
					<Box marginTop={1}>
						<Text color="red">{errors[0]}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Alert variant="warning">
						Press Y to confirm, N or Esc to cancel
					</Alert>
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
						borderColor={'cyan'}
						paddingX={2}
					>
						<Box flexDirection="column">
							<Gradient name="rainbow">API & Model Configuration</Gradient>
							<Text color="gray" dimColor>
								Loading available models...
							</Text>
						</Box>
					</Box>
				)}

				<Box flexDirection="column">
					<Box>
						<Spinner type="dots" />
						<Text color="cyan"> Fetching models from API...</Text>
					</Box>
					<Box marginLeft={2}>
						<Text color="gray" dimColor>
							This may take a few seconds depending on your network connection
						</Text>
					</Box>
				</Box>

				<Box flexDirection="column" marginTop={1}>
					<Alert variant="info">
						Press Esc to cancel and return to configuration
					</Alert>
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
						borderColor={'cyan'}
						paddingX={2}
					>
						<Box flexDirection="column">
							<Gradient name="rainbow">Manual Input Model</Gradient>
							<Text color="gray" dimColor>
								Enter model name manually
							</Text>
						</Box>
					</Box>
				)}

				{loadError && (
					<Box flexDirection="column" marginBottom={1}>
						<Text color="yellow">⚠ Failed to load models from API</Text>
						<Text color="gray" dimColor>
							{loadError}
						</Text>
					</Box>
				)}

				<Box flexDirection="column">
					<Text color="cyan">
						{currentField === 'advancedModel' && 'Advanced Model'}
						{currentField === 'basicModel' && 'Basic Model'}
						{currentField === 'compactModelName' && 'Compact Model'}:
					</Text>
					<Box marginLeft={2}>
						<Text color="green">
							{`> ${manualInputValue}`}
							<Text color="white">_</Text>
						</Text>
					</Box>
				</Box>

				<Box flexDirection="column" marginTop={1}>
					<Alert variant="info">Press Enter to confirm, Esc to cancel</Alert>
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
					borderColor={'cyan'}
					paddingX={2}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">API & Model Configuration</Gradient>
						<Text color="gray" dimColor>
							Configure your API settings and AI models
						</Text>
						{activeProfile && (
							<Text color="cyan" dimColor>
								Active Profile: {activeProfile}
							</Text>
						)}
					</Box>
				</Box>
			)}

			{/* Position indicator - always visible */}
			<Box marginBottom={1}>
				<Text color="yellow" bold>
					Settings ({currentFieldIndex + 1}/{totalFields})
				</Text>
				{totalFields > MAX_VISIBLE_FIELDS && (
					<Text color="gray" dimColor>
						{' '}
						· ↑↓ to scroll
					</Text>
				)}
			</Box>

			{/* When editing with Select, show simplified view */}
			{isEditing &&
			(currentField === 'profile' ||
				currentField === 'requestMethod' ||
				currentField === 'advancedModel' ||
				currentField === 'basicModel' ||
				currentField === 'compactModelName' ||
				currentField === 'responsesReasoningEffort') ? (
				<Box flexDirection="column">
					<Text color="green">
						❯ {currentField === 'profile' && 'Profile'}
						{currentField === 'requestMethod' && 'Request Method'}
						{currentField === 'advancedModel' && 'Advanced Model'}
						{currentField === 'basicModel' && 'Basic Model'}
						{currentField === 'compactModelName' && 'Compact Model'}
						{currentField === 'responsesReasoningEffort' && 'Responses Reasoning Effort'}:
					</Text>
					<Box marginLeft={3} marginTop={1}>
						{currentField === 'profile' && (
							<Box flexDirection="column">
								{profiles.length > 1 && (
									<Text color="gray" dimColor>
										Scroll to see more profiles (↑↓)
									</Text>
								)}
								<Select
									options={profiles.map(p => ({
										label: `${p.displayName}${p.isActive ? ' (Active)' : ''}`,
										value: p.name,
									}))}
									defaultValue={activeProfile}
									onChange={value => {
										switchProfile(value);
										loadProfilesAndConfig();
										setIsEditing(false);
										setErrors([]);
									}}
								/>
								<Box flexDirection="row" marginTop={1}>
									<Box marginRight={2}>
										<Text color="green">+ New</Text>
										<Text color="gray"> (n)</Text>
									</Box>
									<Box>
										<Text color="red">🆇 Delete</Text>
										<Text color="gray"> (d)</Text>
									</Box>
								</Box>
							</Box>
						)}
						{currentField === 'requestMethod' && (
							<Select
								options={requestMethodOptions}
								defaultValue={requestMethod}
								onChange={value => {
									setRequestMethod(value as RequestMethod);
									setIsEditing(false);
								}}
							/>
						)}
						{(currentField === 'advancedModel' ||
							currentField === 'basicModel' ||
							currentField === 'compactModelName') && (
							<Box flexDirection="column">
								{searchTerm && <Text color="cyan">Filter: {searchTerm}</Text>}
								<Select
									options={getCurrentOptions()}
									defaultValue={getCurrentValue()}
									onChange={handleModelChange}
								/>
							</Box>
						)}
						{currentField === 'responsesReasoningEffort' && (
							<Select
								options={[
									{label: 'Low', value: 'low'},
									{label: 'Medium', value: 'medium'},
									{label: 'High', value: 'high'},
								]}
								defaultValue={responsesReasoningEffort}
								onChange={value => {
									setResponsesReasoningEffort(value as 'low' | 'medium' | 'high');
									setIsEditing(false);
								}}
							/>
						)}
					</Box>
					<Box marginTop={1}>
						<Alert variant="info">
							{(currentField === 'advancedModel' ||
								currentField === 'basicModel' ||
								currentField === 'compactModelName') &&
								'Type to filter, ↑↓ to select, Enter to confirm, Esc to cancel'}
							{currentField === 'responsesReasoningEffort' &&
								'↑↓ to select, Enter to confirm, Esc to cancel'}
							{currentField === 'profile' &&
								'↑↓ to select profile, N to create new, D to delete, Enter to confirm, Esc to cancel'}
							{currentField === 'requestMethod' &&
								'↑↓ to select, Enter to confirm, Esc to cancel'}
						</Alert>
					</Box>
				</Box>
			) : (
				<Box flexDirection="column">
					{/* Scrollable field list */}
					{(() => {
						// Calculate visible window
						if (allFields.length <= MAX_VISIBLE_FIELDS) {
							// Show all fields if less than max
							return allFields.map(field => renderField(field));
						}

						// Calculate scroll window
						const halfWindow = Math.floor(MAX_VISIBLE_FIELDS / 2);
						let startIndex = Math.max(0, currentFieldIndex - halfWindow);
						let endIndex = Math.min(
							allFields.length,
							startIndex + MAX_VISIBLE_FIELDS,
						);

						// Adjust if we're near the end
						if (endIndex - startIndex < MAX_VISIBLE_FIELDS) {
							startIndex = Math.max(0, endIndex - MAX_VISIBLE_FIELDS);
						}

						const visibleFields = allFields.slice(startIndex, endIndex);
						return visibleFields.map(field => renderField(field));
					})()}
				</Box>
			)}

			{errors.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color="red" bold>
						Errors:
					</Text>
					{errors.map((error, index) => (
						<Text key={index} color="red">
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
					currentField === 'advancedModel' ||
					currentField === 'basicModel' ||
					currentField === 'compactModelName' ||
					currentField === 'responsesReasoningEffort')
			) && (
				<Box flexDirection="column" marginTop={1}>
					{isEditing ? (
						<Alert variant="info">
							Editing mode:{' '}
							{currentField === 'maxContextTokens' ||
							currentField === 'maxTokens'
								? 'Type to edit, Enter to save'
								: 'Press Enter to save and exit editing'}
						</Alert>
					) : (
						<Alert variant="info">
							{currentField === 'profile'
								? 'Use ↑↓ to navigate, N to create new profile, D to delete profile, Ctrl+S or Esc to save'
								: 'Use ↑↓ to navigate, Enter to edit, M for manual input, Ctrl+S or Esc to save'}
						</Alert>
					)}
				</Box>
			)}
		</Box>
	);
}
