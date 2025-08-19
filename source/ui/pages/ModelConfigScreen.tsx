import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Gradient from 'ink-gradient';
import { Select, Alert } from '@inkjs/ui';
import { fetchAvailableModels, filterModels, type Model } from '../../api/models.js';
import {
	getOpenAiConfig,
	updateOpenAiConfig,
	type ApiConfig,
} from '../../utils/apiConfig.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
};

type ModelField = 'advancedModel' | 'basicModel' | 'maxContextTokens';

export default function ModelConfigScreen({ onBack, onSave }: Props) {
	const [advancedModel, setAdvancedModel] = useState('');
	const [basicModel, setBasicModel] = useState('');
	const [maxContextTokens, setMaxContextTokens] = useState(4000);
	const [currentField, setCurrentField] = useState<ModelField>('advancedModel');
	const [isEditing, setIsEditing] = useState(false);
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [baseUrlMissing, setBaseUrlMissing] = useState(false);
	const [searchTerm, setSearchTerm] = useState('');

	useEffect(() => {
		const config = getOpenAiConfig();
		setAdvancedModel(config.advancedModel || '');
		setBasicModel(config.basicModel || '');
		setMaxContextTokens(config.maxContextTokens || 4000);

		if (!config.baseUrl) {
			setBaseUrlMissing(true);
			return;
		}
	}, []);

	const loadModels = async () => {
		setLoading(true);
		setError('');
		try {
			const fetchedModels = await fetchAvailableModels();
			setModels(fetchedModels);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load models');
		} finally {
			setLoading(false);
		}
	};

	const getCurrentOptions = () => {
		const filteredModels = filterModels(models, searchTerm);
		return filteredModels.map(model => ({
			label: model.id,
			value: model.id,
		}));
	};

	const getCurrentValue = () => {
		if (currentField === 'advancedModel') return advancedModel;
		if (currentField === 'basicModel') return basicModel;
		return maxContextTokens.toString();
	};

	const handleModelChange = (value: string) => {
		if (currentField === 'advancedModel') {
			setAdvancedModel(value);
		} else if (currentField === 'basicModel') {
			setBasicModel(value);
		} else if (currentField === 'maxContextTokens') {
			const numValue = parseInt(value, 10);
			if (!isNaN(numValue) && numValue > 0) {
				setMaxContextTokens(numValue);
			}
		}
		setIsEditing(false);
		setSearchTerm(''); // Reset search when selection is made
	};

	useInput((input, key) => {
		if (baseUrlMissing) {
			if (key.escape) {
				onBack();
			}
			return;
		}

		// Don't handle input when Select component is active
		if (isEditing) {
			if (currentField === 'maxContextTokens') {
				// Handle numeric input for maxContextTokens
				if (input && input.match(/[0-9]/)) {
					const newValue = parseInt(maxContextTokens.toString() + input, 10);
					if (!isNaN(newValue)) {
						setMaxContextTokens(newValue);
					}
				} else if (key.backspace || key.delete) {
					const currentStr = maxContextTokens.toString();
					const newStr = currentStr.slice(0, -1);
					const newValue = parseInt(newStr, 10);
					if (!isNaN(newValue)) {
						setMaxContextTokens(newValue);
					} else {
						setMaxContextTokens(0);
					}
				} else if (key.return) {
					// Save value, but enforce minimum of 4000
					const finalValue = maxContextTokens < 4000 ? 4000 : maxContextTokens;
					setMaxContextTokens(finalValue);
					setIsEditing(false);
				}
			} else {
				// Allow typing to filter in edit mode for model selection
				if (input && input.match(/[a-zA-Z0-9-_.]/)) {
					setSearchTerm(prev => prev + input);
				} else if (key.backspace || key.delete) {
					setSearchTerm(prev => prev.slice(0, -1));
				}
			}
			return;
		}

		// Handle save/exit globally
		if (input === 's' && (key.ctrl || key.meta)) {
			const config: Partial<ApiConfig> = {
				advancedModel,
				basicModel,
				maxContextTokens,
			};
			updateOpenAiConfig(config);
			onSave();
		} else if (key.escape) {
			const config: Partial<ApiConfig> = {
				advancedModel,
				basicModel,
				maxContextTokens,
			};
			updateOpenAiConfig(config);
			onBack();
		} else if (key.return) {
			// Load models first for model fields, or enter edit mode directly for maxContextTokens
			setSearchTerm(''); // Reset search when entering edit mode
			if (currentField === 'maxContextTokens') {
				setIsEditing(true);
			} else {
				loadModels().then(() => {
					setIsEditing(true);
				});
			}
		} else if (key.upArrow) {
			if (currentField === 'basicModel') {
				setCurrentField('advancedModel');
			} else if (currentField === 'maxContextTokens') {
				setCurrentField('basicModel');
			}
		} else if (key.downArrow) {
			if (currentField === 'advancedModel') {
				setCurrentField('basicModel');
			} else if (currentField === 'basicModel') {
				setCurrentField('maxContextTokens');
			}
		}
	});

	if (baseUrlMissing) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={2} borderStyle="double" borderColor={"cyan"} paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Gradient name='rainbow'>
							Model Configuration
						</Gradient>
						<Text color="gray" dimColor>
							Configure AI models for different tasks
						</Text>
					</Box>
				</Box>

				<Box marginBottom={2}>
					<Alert variant="error">
						Base URL not configured. Please configure API settings first before setting up models.
					</Alert>
				</Box>

				<Box flexDirection="column">
					<Alert variant="info">
						Press Esc to return to main menu
					</Alert>
				</Box>
			</Box>
		);
	}

	if (loading) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={2} borderStyle="double" paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Gradient name="rainbow">
							Model Configuration
						</Gradient>
						<Text color="gray" dimColor>
							Loading available models...
						</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={2} borderStyle="double" borderColor={"red"} paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Gradient name='rainbow'>
							Model Configuration
						</Gradient>
						<Text color="gray" dimColor>
							Configure AI models for different tasks
						</Text>
					</Box>
				</Box>

				<Box marginBottom={2}>
					<Alert variant="error">
						{error}
					</Alert>
				</Box>

				<Box flexDirection="column">
					<Alert variant="info">
						Press Esc to return to main menu
					</Alert>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={2} borderStyle="double" borderColor={"cyan"} paddingX={2} paddingY={1}>
				<Box flexDirection="column">
					<Gradient name='rainbow'>
						Model Configuration
					</Gradient>
					<Text color="gray" dimColor>
						Configure AI models for different tasks
					</Text>
				</Box>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'advancedModel' ? 'green' : 'white'}>
							{currentField === 'advancedModel' ? '➣ ' : '  '}Advanced Model (Main Work):
						</Text>
						{currentField === 'advancedModel' && isEditing && (
							<Box marginLeft={3}>
								{loading ? (
									<Text color="yellow">Loading models...</Text>
								) : (
									<Box flexDirection="column">
										{searchTerm && (
											<Text color="cyan">Filter: {searchTerm}</Text>
										)}
										<Select
											options={getCurrentOptions()}
											defaultValue={getCurrentValue()}
											onChange={handleModelChange}
										/>
									</Box>
								)}
							</Box>
						)}
						{(!isEditing || currentField !== 'advancedModel') && (
							<Box marginLeft={3}>
								<Text color="gray">{advancedModel || 'Not set'}</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'basicModel' ? 'green' : 'white'}>
							{currentField === 'basicModel' ? '➣ ' : '  '}Basic Model (Summary & Analysis):
						</Text>
						{currentField === 'basicModel' && isEditing && (
							<Box marginLeft={3}>
								{loading ? (
									<Text color="yellow">Loading models...</Text>
								) : (
									<Box flexDirection="column">
										{searchTerm && (
											<Text color="cyan">Filter: {searchTerm}</Text>
										)}
										<Select
											options={getCurrentOptions()}
											defaultValue={getCurrentValue()}
											onChange={handleModelChange}
										/>
									</Box>
								)}
							</Box>
						)}
						{(!isEditing || currentField !== 'basicModel') && (
							<Box marginLeft={3}>
								<Text color="gray">{basicModel || 'Not set'}</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'maxContextTokens' ? 'green' : 'white'}>
							{currentField === 'maxContextTokens' ? '➣ ' : '  '}Max Context Tokens (Auto-compress when reached):
						</Text>
						{currentField === 'maxContextTokens' && isEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">
									Enter value: {maxContextTokens}
								</Text>
							</Box>
						)}
						{(!isEditing || currentField !== 'maxContextTokens') && (
							<Box marginLeft={3}>
								<Text color="gray">{maxContextTokens}</Text>
							</Box>
						)}
					</Box>
				</Box>
			</Box>

			<Box flexDirection="column">
				{isEditing ? (
					<>
						<Alert variant="info">
							Editing mode: Type to filter models, ↑↓ to select, Enter to confirm
						</Alert>
					</>
				) : (
					<>
						<Alert variant="info">
							Use ↑↓ to navigate, Enter to edit, Ctrl+S or Esc to save
						</Alert>
					</>
				)}
			</Box>
		</Box>
	);
}