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
	inlineMode?: boolean;
};

type ModelField = 'advancedModel' | 'basicModel' | 'maxContextTokens' | 'maxTokens' | 'compactBaseUrl' | 'compactApiKey' | 'compactModelName';

export default function ModelConfigScreen({ onBack, onSave, inlineMode = false }: Props) {
	const [advancedModel, setAdvancedModel] = useState('');
	const [basicModel, setBasicModel] = useState('');
	const [maxContextTokens, setMaxContextTokens] = useState(4000);
	const [maxTokens, setMaxTokens] = useState(4096);
	const [compactBaseUrl, setCompactBaseUrl] = useState('');
	const [compactApiKey, setCompactApiKey] = useState('');
	const [compactModelName, setCompactModelName] = useState('');
	const [currentField, setCurrentField] = useState<ModelField>('advancedModel');
	const [isEditing, setIsEditing] = useState(false);
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(false);
	const [baseUrlMissing, setBaseUrlMissing] = useState(false);
	const [searchTerm, setSearchTerm] = useState('');
	const [manualInputMode, setManualInputMode] = useState(false);
	const [manualInputValue, setManualInputValue] = useState('');

	useEffect(() => {
		const config = getOpenAiConfig();
		setAdvancedModel(config.advancedModel || '');
		setBasicModel(config.basicModel || '');
		setMaxContextTokens(config.maxContextTokens || 4000);
		setMaxTokens(config.maxTokens || 4096);
		setCompactBaseUrl(config.compactModel?.baseUrl || '');
		setCompactApiKey(config.compactModel?.apiKey || '');
		setCompactModelName(config.compactModel?.modelName || '');

		if (!config.baseUrl) {
			setBaseUrlMissing(true);
			return;
		}
	}, []);

	const loadModels = async () => {
		setLoading(true);
		try {
			const fetchedModels = await fetchAvailableModels();
			setModels(fetchedModels);
		} catch (err) {
			// 加载失败时抛出错误,由调用方处理
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

		// 添加手动输入选项
		return [
			{ label: 'Manual Input (Enter model name)', value: '__MANUAL_INPUT__' },
			...modelOptions,
		];
	};

	const getCurrentValue = () => {
		if (currentField === 'advancedModel') return advancedModel;
		if (currentField === 'basicModel') return basicModel;
		if (currentField === 'maxContextTokens') return maxContextTokens.toString();
		if (currentField === 'maxTokens') return maxTokens.toString();
		if (currentField === 'compactBaseUrl') return compactBaseUrl;
		if (currentField === 'compactApiKey') return compactApiKey;
		if (currentField === 'compactModelName') return compactModelName;
		return '';
	};

	const handleModelChange = (value: string) => {
		// 如果选择了手动输入选项
		if (value === '__MANUAL_INPUT__') {
			setManualInputMode(true);
			setManualInputValue('');
			return;
		}

		if (currentField === 'advancedModel') {
			setAdvancedModel(value);
		} else if (currentField === 'basicModel') {
			setBasicModel(value);
		} else if (currentField === 'maxContextTokens') {
			const numValue = parseInt(value, 10);
			if (!isNaN(numValue) && numValue > 0) {
				setMaxContextTokens(numValue);
			}
		} else if (currentField === 'maxTokens') {
			const numValue = parseInt(value, 10);
			if (!isNaN(numValue) && numValue > 0) {
				setMaxTokens(numValue);
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

		// 处理手动输入模式
		if (manualInputMode) {
			if (key.return) {
				// 确认输入
				if (manualInputValue.trim()) {
					if (currentField === 'advancedModel') {
						setAdvancedModel(manualInputValue.trim());
					} else if (currentField === 'basicModel') {
						setBasicModel(manualInputValue.trim());
					}
				}
				setManualInputMode(false);
				setManualInputValue('');
				setIsEditing(false);
				setSearchTerm('');
			} else if (key.escape) {
				// 取消输入
				setManualInputMode(false);
				setManualInputValue('');
			} else if (key.backspace || key.delete) {
				setManualInputValue(prev => prev.slice(0, -1));
			} else if (input && input.match(/[a-zA-Z0-9-_./:]/)) {
				setManualInputValue(prev => prev + input);
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
			} else if (currentField === 'maxTokens') {
				// Handle numeric input for maxTokens
				if (input && input.match(/[0-9]/)) {
					const newValue = parseInt(maxTokens.toString() + input, 10);
					if (!isNaN(newValue)) {
						setMaxTokens(newValue);
					}
				} else if (key.backspace || key.delete) {
					const currentStr = maxTokens.toString();
					const newStr = currentStr.slice(0, -1);
					const newValue = parseInt(newStr, 10);
					if (!isNaN(newValue)) {
						setMaxTokens(newValue);
					} else {
						setMaxTokens(0);
					}
				} else if (key.return) {
					// Save value, but enforce minimum of 100
					const finalValue = maxTokens < 100 ? 100 : maxTokens;
					setMaxTokens(finalValue);
					setIsEditing(false);
				}
			} else if (currentField === 'compactBaseUrl' || currentField === 'compactApiKey' || currentField === 'compactModelName') {
				// Handle text input for compact model fields
				if (key.return) {
					setIsEditing(false);
				} else if (key.backspace || key.delete) {
					if (currentField === 'compactBaseUrl') {
						setCompactBaseUrl(prev => prev.slice(0, -1));
					} else if (currentField === 'compactApiKey') {
						setCompactApiKey(prev => prev.slice(0, -1));
					} else if (currentField === 'compactModelName') {
						setCompactModelName(prev => prev.slice(0, -1));
					}
				} else if (input && input.match(/[a-zA-Z0-9-_./:]/)) {
					if (currentField === 'compactBaseUrl') {
						setCompactBaseUrl(prev => prev + input);
					} else if (currentField === 'compactApiKey') {
						setCompactApiKey(prev => prev + input);
					} else if (currentField === 'compactModelName') {
						setCompactModelName(prev => prev + input);
					}
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
				maxTokens,
			};
			// 只有当所有字段都填写时才保存 compactModel
			if (compactBaseUrl && compactApiKey && compactModelName) {
				config.compactModel = {
					baseUrl: compactBaseUrl,
					apiKey: compactApiKey,
					modelName: compactModelName,
				};
			}
			updateOpenAiConfig(config);
			onSave();
		} else if (key.escape) {
			const config: Partial<ApiConfig> = {
				advancedModel,
				basicModel,
				maxContextTokens,
				maxTokens,
			};
			// 只有当所有字段都填写时才保存 compactModel
			if (compactBaseUrl && compactApiKey && compactModelName) {
				config.compactModel = {
					baseUrl: compactBaseUrl,
					apiKey: compactApiKey,
					modelName: compactModelName,
				};
			}
			updateOpenAiConfig(config);
			onBack();
		} else if (key.return) {
			// Load models first for model fields, or enter edit mode directly for maxContextTokens/maxTokens and compact fields
			setSearchTerm(''); // Reset search when entering edit mode
			const isCompactField = currentField === 'compactBaseUrl' || currentField === 'compactApiKey' || currentField === 'compactModelName';
			if (currentField === 'maxContextTokens' || currentField === 'maxTokens' || isCompactField) {
				setIsEditing(true);
			} else {
				loadModels().then(() => {
					setIsEditing(true);
				}).catch(() => {
					// 如果加载模型失败，直接进入手动输入模式
					setManualInputMode(true);
					setManualInputValue(getCurrentValue());
				});
			}
		} else if (input === 'm') {
			// 快捷键：按 'm' 直接进入手动输入模式
			const isCompactField = currentField === 'compactBaseUrl' || currentField === 'compactApiKey' || currentField === 'compactModelName';
			if (currentField !== 'maxContextTokens' && currentField !== 'maxTokens' && !isCompactField) {
				setManualInputMode(true);
				setManualInputValue(getCurrentValue());
			}
		} else if (key.upArrow) {
			if (currentField === 'basicModel') {
				setCurrentField('advancedModel');
			} else if (currentField === 'maxContextTokens') {
				setCurrentField('basicModel');
			} else if (currentField === 'maxTokens') {
				setCurrentField('maxContextTokens');
			} else if (currentField === 'compactBaseUrl') {
				setCurrentField('maxTokens');
			} else if (currentField === 'compactApiKey') {
				setCurrentField('compactBaseUrl');
			} else if (currentField === 'compactModelName') {
				setCurrentField('compactApiKey');
			}
		} else if (key.downArrow) {
			if (currentField === 'advancedModel') {
				setCurrentField('basicModel');
			} else if (currentField === 'basicModel') {
				setCurrentField('maxContextTokens');
			} else if (currentField === 'maxContextTokens') {
				setCurrentField('maxTokens');
			} else if (currentField === 'maxTokens') {
				setCurrentField('compactBaseUrl');
			} else if (currentField === 'compactBaseUrl') {
				setCurrentField('compactApiKey');
			} else if (currentField === 'compactApiKey') {
				setCurrentField('compactModelName');
			}
		}
	});

	if (baseUrlMissing) {
		return (
			<Box flexDirection="column" padding={1}>
				{!inlineMode && (
					<Box marginBottom={1} borderStyle="double" borderColor={"cyan"} paddingX={1} paddingY={0}>
						<Box flexDirection="column">
							<Gradient name='rainbow'>
								Model Configuration
							</Gradient>
							<Text color="gray" dimColor>
								Configure AI models for different tasks
							</Text>
						</Box>
					</Box>
				)}

				<Box marginBottom={1}>
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
				{!inlineMode && (
					<Box marginBottom={1} borderStyle="double" paddingX={1} paddingY={0}>
						<Box flexDirection="column">
							<Gradient name="rainbow">
								Model Configuration
							</Gradient>
							<Text color="gray" dimColor>
								Loading available models...
							</Text>
						</Box>
					</Box>
				)}
			</Box>
		);
	}

	// 手动输入模式的界面
	if (manualInputMode) {
		return (
			<Box flexDirection="column" padding={1}>
				{!inlineMode && (
					<Box marginBottom={1} borderStyle="double" borderColor={"cyan"} paddingX={1} paddingY={0}>
						<Box flexDirection="column">
							<Gradient name='rainbow'>
								Manual Input Model
							</Gradient>
							<Text color="gray" dimColor>
								Enter model name manually
							</Text>
						</Box>
					</Box>
				)}

				<Box flexDirection="column" marginBottom={1}>
					<Text color="cyan">
						{currentField === 'advancedModel' ? 'Advanced Model' : 'Basic Model'}:
					</Text>
					<Box marginLeft={2}>
						<Text color="green">
							{`> ${manualInputValue}`}<Text color="white">_</Text>
						</Text>
					</Box>
				</Box>

				<Box flexDirection="column">
					<Alert variant="info">
						Type model name (e.g., gpt-4o, claude-3-5-sonnet-20241022)
					</Alert>
					<Alert variant="info">
						Press Enter to confirm, Esc to cancel
					</Alert>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box marginBottom={1} borderStyle="double" borderColor={"cyan"} paddingX={1} paddingY={0}>
					<Box flexDirection="column">
						<Gradient name='rainbow'>
							Model Configuration
						</Gradient>
						<Text color="gray" dimColor>
							Configure AI models for different tasks
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column">
				<Box>
					<Box flexDirection="column">
						<Text color={currentField === 'advancedModel' ? 'green' : 'white'}>
							{currentField === 'advancedModel' ? '❯ ' : '  '}Advanced Model (Main Work):
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

				<Box>
					<Box flexDirection="column">
						<Text color={currentField === 'basicModel' ? 'green' : 'white'}>
							{currentField === 'basicModel' ? '❯ ' : '  '}Basic Model (Summary & Analysis):
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

				<Box>
					<Box flexDirection="column">
						<Text color={currentField === 'maxContextTokens' ? 'green' : 'white'}>
							{currentField === 'maxContextTokens' ? '❯ ' : '  '}Max Context Tokens (Auto-compress when reached):
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

				<Box>
					<Box flexDirection="column">
						<Text color={currentField === 'maxTokens' ? 'green' : 'white'}>
							{currentField === 'maxTokens' ? '❯ ' : '  '}Max Tokens (Max tokens for single response):
						</Text>
						{currentField === 'maxTokens' && isEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">
									Enter value: {maxTokens}
								</Text>
							</Box>
						)}
						{(!isEditing || currentField !== 'maxTokens') && (
							<Box marginLeft={3}>
								<Text color="gray">{maxTokens}</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginTop={1}>
					<Text color="cyan" bold>Compact Model (Context Compression):</Text>
				</Box>

				<Box>
					<Box flexDirection="column">
						<Text color={currentField === 'compactBaseUrl' ? 'green' : 'white'}>
							{currentField === 'compactBaseUrl' ? '❯ ' : '  '}Base URL:
						</Text>
						{currentField === 'compactBaseUrl' && isEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">
									{compactBaseUrl}<Text color="white">_</Text>
								</Text>
							</Box>
						)}
						{(!isEditing || currentField !== 'compactBaseUrl') && (
							<Box marginLeft={3}>
								<Text color="gray">{compactBaseUrl || 'Not set'}</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box>
					<Box flexDirection="column">
						<Text color={currentField === 'compactApiKey' ? 'green' : 'white'}>
							{currentField === 'compactApiKey' ? '❯ ' : '  '}API Key:
						</Text>
						{currentField === 'compactApiKey' && isEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">
									{compactApiKey.replace(/./g, '*')}<Text color="white">_</Text>
								</Text>
							</Box>
						)}
						{(!isEditing || currentField !== 'compactApiKey') && (
							<Box marginLeft={3}>
								<Text color="gray">{compactApiKey ? compactApiKey.replace(/./g, '*') : 'Not set'}</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box>
					<Box flexDirection="column">
						<Text color={currentField === 'compactModelName' ? 'green' : 'white'}>
							{currentField === 'compactModelName' ? '❯ ' : '  '}Model Name:
						</Text>
						{currentField === 'compactModelName' && isEditing && (
							<Box marginLeft={3}>
								<Text color="cyan">
									{compactModelName}<Text color="white">_</Text>
								</Text>
							</Box>
						)}
						{(!isEditing || currentField !== 'compactModelName') && (
							<Box marginLeft={3}>
								<Text color="gray">{compactModelName || 'Not set'}</Text>
							</Box>
						)}
					</Box>
				</Box>
			</Box>

			<Box flexDirection="column" marginTop={1}>
				{isEditing ? (
					<>
						<Alert variant="info">
							Editing mode: Type to filter models, ↑↓ to select, Enter to confirm
						</Alert>
					</>
				) : (
					<>
						<Alert variant="info">
							Use ↑↓ to navigate, Enter to edit, M for manual input, Ctrl+S or Esc to save
						</Alert>
					</>
				)}
			</Box>
		</Box>
	);
}