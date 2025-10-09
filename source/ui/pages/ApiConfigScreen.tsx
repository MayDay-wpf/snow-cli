import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Gradient from 'ink-gradient';
import { Select, Alert } from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getOpenAiConfig,
	updateOpenAiConfig,
	validateApiConfig,
	type RequestMethod,
} from '../../utils/apiConfig.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
};

export default function ApiConfigScreen({ onBack, onSave }: Props) {
	const [baseUrl, setBaseUrl] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [requestMethod, setRequestMethod] = useState<RequestMethod>('chat');
	const [anthropicBeta, setAnthropicBeta] = useState(false);
	const [currentField, setCurrentField] = useState<'baseUrl' | 'apiKey' | 'requestMethod' | 'anthropicBeta'>(
		'baseUrl',
	);
	const [errors, setErrors] = useState<string[]>([]);
	const [isEditing, setIsEditing] = useState(false);

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
			label: 'Gemini - Google Gemini API (Hajimi =^W^=)',
			value: 'gemini' as RequestMethod,
		},
		{
			label: 'Anthropic - Claude API (Claude 4.5 Sonnet, etc. Birth)',
			value: 'anthropic' as RequestMethod,
		},
	];

	useEffect(() => {
		const config = getOpenAiConfig();
		setBaseUrl(config.baseUrl);
		setApiKey(config.apiKey);
		setRequestMethod(config.requestMethod || 'chat');
		setAnthropicBeta(config.anthropicBeta || false);
	}, []);

	useInput((input, key) => {
		// Allow Escape key to exit Select component without changes
		if (isEditing && currentField === 'requestMethod' && key.escape) {
			setIsEditing(false);
			return;
		}

		// Don't handle other input when Select component is active
		if (isEditing && currentField === 'requestMethod') {
			return;
		}

		// Handle save/exit globally
		if (input === 's' && (key.ctrl || key.meta)) {
			const validationErrors = validateApiConfig({ baseUrl, apiKey, requestMethod });
			if (validationErrors.length === 0) {
				updateOpenAiConfig({ baseUrl, apiKey, requestMethod, anthropicBeta });
				setErrors([]);
				onSave();
			} else {
				setErrors(validationErrors);
			}
		} else if (key.escape) {
			const validationErrors = validateApiConfig({ baseUrl, apiKey, requestMethod });
			if (validationErrors.length === 0) {
				updateOpenAiConfig({ baseUrl, apiKey, requestMethod, anthropicBeta });
				setErrors([]);
			}
			onBack();
		} else if (key.return) {
			if (isEditing) {
				// Exit edit mode, return to navigation
				setIsEditing(false);
			} else {
				// Enter edit mode for current field (toggle for checkbox)
				if (currentField === 'anthropicBeta') {
					setAnthropicBeta(!anthropicBeta);
				} else {
					setIsEditing(true);
				}
			}
		} else if (!isEditing && key.upArrow) {
			if (currentField === 'apiKey') {
				setCurrentField('baseUrl');
			} else if (currentField === 'requestMethod') {
				setCurrentField('apiKey');
			} else if (currentField === 'anthropicBeta') {
				setCurrentField('requestMethod');
			}
		} else if (!isEditing && key.downArrow) {
			if (currentField === 'baseUrl') {
				setCurrentField('apiKey');
			} else if (currentField === 'apiKey') {
				setCurrentField('requestMethod');
			} else if (currentField === 'requestMethod') {
				setCurrentField('anthropicBeta');
			}
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={2} borderStyle="double" borderColor={"cyan"} paddingX={2} paddingY={1}>
				<Box flexDirection="column">
					<Gradient name="rainbow">
						OpenAI API Configuration
					</Gradient>
					<Text color="gray" dimColor>
						Configure your OpenAI API settings
					</Text>
				</Box>
			</Box>

			<Box flexDirection="column" marginBottom={2}>
				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'baseUrl' ? 'green' : 'white'}>
							{currentField === 'baseUrl' ? '➣ ' : '  '}Base URL:
						</Text>
						{currentField === 'baseUrl' && isEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={baseUrl}
									onChange={setBaseUrl}
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
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'apiKey' ? 'green' : 'white'}>
							{currentField === 'apiKey' ? '➣ ' : '  '}API Key:
						</Text>
						{currentField === 'apiKey' && isEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={apiKey}
									onChange={setApiKey}
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
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'requestMethod' ? 'green' : 'white'}>
							{currentField === 'requestMethod' ? '➣ ' : '  '}Request Method:
						</Text>
						{currentField === 'requestMethod' && isEditing && (
							<Box marginLeft={3}>
								<Select
									options={requestMethodOptions}
									defaultValue={requestMethod}
									onChange={(value) => {
										setRequestMethod(value as RequestMethod);
										setIsEditing(false); // Auto exit edit mode after selection
									}}
								/>
							</Box>
						)}
						{(!isEditing || currentField !== 'requestMethod') && (
							<Box marginLeft={3}>
								<Text color="gray">
									{requestMethodOptions.find(opt => opt.value === requestMethod)?.label || 'Not set'}
								</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'anthropicBeta' ? 'green' : 'white'}>
							{currentField === 'anthropicBeta' ? '➣ ' : '  '}Anthropic Beta (for Claude API):
						</Text>
						<Box marginLeft={3}>
							<Text color="gray">
								{anthropicBeta ? '☑ Enabled' : '☐ Disabled'} (Press Enter to toggle)
							</Text>
						</Box>
					</Box>
				</Box>
			</Box>

			{errors.length > 0 && (
				<Box flexDirection="column" marginBottom={2}>
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

			<Box flexDirection="column">
				{isEditing ? (
					<>
						<Alert variant="info">
							Editing mode: Press Enter to save and exit editing 
							(Make your changes and press Enter when done)
						</Alert>
					</>
				) : (
					<>
						<Alert variant="info">
							Use ↑↓ to navigate between fields, press Enter to edit, 
							and press Ctrl+S or Esc to save and return
						</Alert>
					</>
				)}
			</Box>
		</Box>
	);
}
