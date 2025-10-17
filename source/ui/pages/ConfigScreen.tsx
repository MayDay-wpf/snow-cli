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

type Props = {
	onBack: () => void;
	onSave: () => void;
	inlineMode?: boolean;
};

type ConfigField =
	| 'baseUrl'
	| 'apiKey'
	| 'requestMethod'
	| 'anthropicBeta'
	| 'advancedModel'
	| 'basicModel'
	| 'maxContextTokens'
	| 'maxTokens'
	| 'compactModelName';

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
	// API settings
	const [baseUrl, setBaseUrl] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [requestMethod, setRequestMethod] = useState<RequestMethod>('chat');
	const [anthropicBeta, setAnthropicBeta] = useState(false);

	// Model settings
	const [advancedModel, setAdvancedModel] = useState('');
	const [basicModel, setBasicModel] = useState('');
	const [maxContextTokens, setMaxContextTokens] = useState(4000);
	const [maxTokens, setMaxTokens] = useState(4096);
	const [compactModelName, setCompactModelName] = useState('');

	// UI state
	const [currentField, setCurrentField] = useState<ConfigField>('baseUrl');
	const [errors, setErrors] = useState<string[]>([]);
	const [isEditing, setIsEditing] = useState(false);
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(false);
	const [loadError, setLoadError] = useState<string>('');
	const [searchTerm, setSearchTerm] = useState('');
	const [manualInputMode, setManualInputMode] = useState(false);
	const [manualInputValue, setManualInputValue] = useState('');

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

	useEffect(() => {
		const config = getOpenAiConfig();
		setBaseUrl(config.baseUrl);
		setApiKey(config.apiKey);
		setRequestMethod(config.requestMethod || 'chat');
		setAnthropicBeta(config.anthropicBeta || false);
		setAdvancedModel(config.advancedModel || '');
		setBasicModel(config.basicModel || '');
		setMaxContextTokens(config.maxContextTokens || 4000);
		setMaxTokens(config.maxTokens || 4096);
		setCompactModelName(config.compactModel?.modelName || '');
	}, []);

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
		if (currentField === 'baseUrl') return baseUrl;
		if (currentField === 'apiKey') return apiKey;
		if (currentField === 'advancedModel') return advancedModel;
		if (currentField === 'basicModel') return basicModel;
		if (currentField === 'maxContextTokens') return maxContextTokens.toString();
		if (currentField === 'maxTokens') return maxTokens.toString();
		if (currentField === 'compactModelName') return compactModelName;
		return '';
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

			// Only save compactModel if modelName is provided (uses same baseUrl/apiKey)
			if (compactModelName) {
				config.compactModel = {
					modelName: compactModelName,
				};
			}

			updateOpenAiConfig(config);
			setErrors([]);
			return true;
		} else {
			setErrors(validationErrors);
			return false;
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
			(currentField === 'requestMethod' ||
				currentField === 'advancedModel' ||
				currentField === 'basicModel' ||
				currentField === 'compactModelName') &&
			key.escape
		) {
			setIsEditing(false);
			setSearchTerm('');
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
			if (currentField === 'maxContextTokens' || currentField === 'maxTokens') {
				if (input && input.match(/[0-9]/)) {
					const currentValue =
						currentField === 'maxContextTokens' ? maxContextTokens : maxTokens;
					const newValue = parseInt(currentValue.toString() + input, 10);
					if (!isNaN(newValue)) {
						if (currentField === 'maxContextTokens') {
							setMaxContextTokens(newValue);
						} else {
							setMaxTokens(newValue);
						}
					}
				} else if (key.backspace || key.delete) {
					const currentValue =
						currentField === 'maxContextTokens' ? maxContextTokens : maxTokens;
					const currentStr = currentValue.toString();
					const newStr = currentStr.slice(0, -1);
					const newValue = parseInt(newStr, 10);
					if (currentField === 'maxContextTokens') {
						setMaxContextTokens(!isNaN(newValue) ? newValue : 0);
					} else {
						setMaxTokens(!isNaN(newValue) ? newValue : 0);
					}
				} else if (key.return) {
					const minValue = currentField === 'maxContextTokens' ? 4000 : 100;
					const currentValue =
						currentField === 'maxContextTokens' ? maxContextTokens : maxTokens;
					const finalValue = currentValue < minValue ? minValue : currentValue;
					if (currentField === 'maxContextTokens') {
						setMaxContextTokens(finalValue);
					} else {
						setMaxTokens(finalValue);
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
				} else if (
					currentField === 'maxContextTokens' ||
					currentField === 'maxTokens'
				) {
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
			const fields: ConfigField[] = [
				'baseUrl',
				'apiKey',
				'requestMethod',
				'anthropicBeta',
				'advancedModel',
				'basicModel',
				'maxContextTokens',
				'maxTokens',
				'compactModelName',
			];
			const currentIndex = fields.indexOf(currentField);
			if (currentIndex > 0) {
				setCurrentField(fields[currentIndex - 1]!);
			}
		} else if (!isEditing && key.downArrow) {
			const fields: ConfigField[] = [
				'baseUrl',
				'apiKey',
				'requestMethod',
				'anthropicBeta',
				'advancedModel',
				'basicModel',
				'maxContextTokens',
				'maxTokens',
				'compactModelName',
			];
			const currentIndex = fields.indexOf(currentField);
			if (currentIndex < fields.length - 1) {
				setCurrentField(fields[currentIndex + 1]!);
			}
		}
	});

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
					</Box>
				</Box>
			)}

			<Box flexDirection="column">
				{/* API Configuration Section */}
				<Text color="cyan" bold>
					API Settings:
				</Text>

				<Box flexDirection="column">
					<Text color={currentField === 'baseUrl' ? 'green' : 'white'}>
						{currentField === 'baseUrl' ? '❯ ' : '  '}Base URL:
					</Text>
					{currentField === 'baseUrl' && isEditing && (
						<Box marginLeft={3}>
							<TextInput
								value={baseUrl}
								onChange={value => setBaseUrl(stripFocusArtifacts(value))}
								placeholder="https://api.openai.com/v1"
							/>
						</Box>
					)}
					{(!isEditing || currentField !== 'baseUrl') && (
						<Box marginLeft={3}>
							<Text color="gray">{baseUrl || 'Not set'}</Text>
						</Box>
					)}
				</Box>

				<Box flexDirection="column">
					<Text color={currentField === 'apiKey' ? 'green' : 'white'}>
						{currentField === 'apiKey' ? '❯ ' : '  '}API Key:
					</Text>
					{currentField === 'apiKey' && isEditing && (
						<Box marginLeft={3}>
							<TextInput
								value={apiKey}
								onChange={value => setApiKey(stripFocusArtifacts(value))}
								placeholder="sk-..."
								mask="*"
							/>
						</Box>
					)}
					{(!isEditing || currentField !== 'apiKey') && (
						<Box marginLeft={3}>
							<Text color="gray">
								{apiKey ? '*'.repeat(Math.min(apiKey.length, 20)) : 'Not set'}
							</Text>
						</Box>
					)}
				</Box>

				<Box flexDirection="column">
					<Text color={currentField === 'requestMethod' ? 'green' : 'white'}>
						{currentField === 'requestMethod' ? '❯ ' : '  '}Request Method:
					</Text>
					{currentField === 'requestMethod' && isEditing && (
						<Box marginLeft={3}>
							<Select
								options={requestMethodOptions}
								defaultValue={requestMethod}
								onChange={value => {
									setRequestMethod(value as RequestMethod);
									setIsEditing(false);
								}}
							/>
						</Box>
					)}
					{(!isEditing || currentField !== 'requestMethod') && (
						<Box marginLeft={3}>
							<Text color="gray">
								{requestMethodOptions.find(opt => opt.value === requestMethod)
									?.label || 'Not set'}
							</Text>
						</Box>
					)}
				</Box>

				<Box flexDirection="column" marginBottom={1}>
					<Text color={currentField === 'anthropicBeta' ? 'green' : 'white'}>
						{currentField === 'anthropicBeta' ? '❯ ' : '  '}Anthropic Beta (for
						Claude API):
					</Text>
					<Box marginLeft={3}>
						<Text color="gray">
							{anthropicBeta ? '☑ Enabled' : '☐ Disabled'} (Press Enter to
							toggle)
						</Text>
					</Box>
				</Box>

				{/* Model Configuration Section */}
				<Text color="cyan" bold>
					Model Settings:
				</Text>

				<Box flexDirection="column">
					<Text color={currentField === 'advancedModel' ? 'green' : 'white'}>
						{currentField === 'advancedModel' ? '❯ ' : '  '}Advanced Model (Main
						Work):
					</Text>
					{currentField === 'advancedModel' && isEditing && (
						<Box marginLeft={3}>
							<Box flexDirection="column">
								{searchTerm && <Text color="cyan">Filter: {searchTerm}</Text>}
								<Select
									options={getCurrentOptions()}
									defaultValue={getCurrentValue()}
									onChange={handleModelChange}
								/>
							</Box>
						</Box>
					)}
					{(!isEditing || currentField !== 'advancedModel') && (
						<Box marginLeft={3}>
							<Text color="gray">{advancedModel || 'Not set'}</Text>
						</Box>
					)}
				</Box>

				<Box flexDirection="column">
					<Text color={currentField === 'basicModel' ? 'green' : 'white'}>
						{currentField === 'basicModel' ? '❯ ' : '  '}Basic Model (Summary &
						Analysis):
					</Text>
					{currentField === 'basicModel' && isEditing && (
						<Box marginLeft={3}>
							<Box flexDirection="column">
								{searchTerm && <Text color="cyan">Filter: {searchTerm}</Text>}
								<Select
									options={getCurrentOptions()}
									defaultValue={getCurrentValue()}
									onChange={handleModelChange}
								/>
							</Box>
						</Box>
					)}
					{(!isEditing || currentField !== 'basicModel') && (
						<Box marginLeft={3}>
							<Text color="gray">{basicModel || 'Not set'}</Text>
						</Box>
					)}
				</Box>

				<Box flexDirection="column">
					<Text color={currentField === 'maxContextTokens' ? 'green' : 'white'}>
						{currentField === 'maxContextTokens' ? '❯ ' : '  '}Max Context
						Tokens (Auto-compress when reached):
					</Text>
					{currentField === 'maxContextTokens' && isEditing && (
						<Box marginLeft={3}>
							<Text color="cyan">Enter value: {maxContextTokens}</Text>
						</Box>
					)}
					{(!isEditing || currentField !== 'maxContextTokens') && (
						<Box marginLeft={3}>
							<Text color="gray">{maxContextTokens}</Text>
						</Box>
					)}
				</Box>

				<Box flexDirection="column" marginBottom={1}>
					<Text color={currentField === 'maxTokens' ? 'green' : 'white'}>
						{currentField === 'maxTokens' ? '❯ ' : '  '}Max Tokens (Max tokens
						for single response):
					</Text>
					{currentField === 'maxTokens' && isEditing && (
						<Box marginLeft={3}>
							<Text color="cyan">Enter value: {maxTokens}</Text>
						</Box>
					)}
					{(!isEditing || currentField !== 'maxTokens') && (
						<Box marginLeft={3}>
							<Text color="gray">{maxTokens}</Text>
						</Box>
					)}
				</Box>

				{/* Compact Model Section */}
				<Text color="cyan" bold>
					Compact Model (Context Compression):
				</Text>

				<Box flexDirection="column">
					<Text color={currentField === 'compactModelName' ? 'green' : 'white'}>
						{currentField === 'compactModelName' ? '❯ ' : '  '}Model Name (uses
						same API credentials):
					</Text>
					{currentField === 'compactModelName' && isEditing && (
						<Box marginLeft={3}>
							<Box flexDirection="column">
								{searchTerm && <Text color="cyan">Filter: {searchTerm}</Text>}
								<Select
									options={getCurrentOptions()}
									defaultValue={getCurrentValue()}
									onChange={handleModelChange}
								/>
							</Box>
						</Box>
					)}
					{(!isEditing || currentField !== 'compactModelName') && (
						<Box marginLeft={3}>
							<Text color="gray">{compactModelName || 'Not set'}</Text>
						</Box>
					)}
				</Box>
			</Box>

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

			<Box flexDirection="column" marginTop={1}>
				{isEditing ? (
					<>
						<Alert variant="info">
							Editing mode:{' '}
							{currentField === 'advancedModel' ||
							currentField === 'basicModel' ||
							currentField === 'compactModelName'
								? 'Type to filter, ↑↓ to select, Enter to confirm'
								: 'Press Enter to save and exit editing'}
						</Alert>
					</>
				) : (
					<>
						<Alert variant="info">
							Use ↑↓ to navigate, Enter to edit, M for manual input, Ctrl+S or
							Esc to save
						</Alert>
					</>
				)}
			</Box>
		</Box>
	);
}
