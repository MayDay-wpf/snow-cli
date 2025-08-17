import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {
	getOpenAiConfig,
	updateOpenAiConfig,
	validateApiConfig,
} from '../utils/apiConfig.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
};

export default function ApiConfigScreen({onBack, onSave}: Props) {
	const [baseUrl, setBaseUrl] = useState('');
	const [apiKey, setApiKey] = useState('');
	const [currentField, setCurrentField] = useState<'baseUrl' | 'apiKey'>(
		'baseUrl',
	);
	const [errors, setErrors] = useState<string[]>([]);

	useEffect(() => {
		const config = getOpenAiConfig();
		setBaseUrl(config.baseUrl);
		setApiKey(config.apiKey);
	}, []);

	useInput((input, key) => {
		if (key.upArrow && currentField === 'apiKey') {
			setCurrentField('baseUrl');
		} else if (key.downArrow && currentField === 'baseUrl') {
			setCurrentField('apiKey');
		} else if (input === 's' && (key.ctrl || key.meta)) {
			const validationErrors = validateApiConfig({baseUrl, apiKey});
			if (validationErrors.length === 0) {
				updateOpenAiConfig({baseUrl, apiKey});
				setErrors([]);
				onSave();
			} else {
				setErrors(validationErrors);
			}
		} else if (key.escape) {
			const validationErrors = validateApiConfig({baseUrl, apiKey});
			if (validationErrors.length === 0) {
				updateOpenAiConfig({baseUrl, apiKey});
				setErrors([]);
			}
			onBack();
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={2} borderStyle="round" paddingX={2} paddingY={1}>
				<Box flexDirection="column">
					<Text color="cyan" bold>
						OpenAI API Configuration
					</Text>
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
						{currentField === 'baseUrl' && (
							<Box marginLeft={3}>
								<TextInput
									value={baseUrl}
									onChange={setBaseUrl}
									placeholder="https://api.openai.com/v1"
								/>
							</Box>
						)}
						{currentField !== 'baseUrl' && (
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
						{currentField === 'apiKey' && (
							<Box marginLeft={3}>
								<TextInput
									value={apiKey}
									onChange={setApiKey}
									placeholder="sk-..."
									mask="*"
								/>
							</Box>
						)}
						{currentField !== 'apiKey' && (
							<Box marginLeft={3}>
								<Text color="gray">
									{apiKey ? '*'.repeat(Math.min(apiKey.length, 20)) : 'Not set'}
								</Text>
							</Box>
						)}
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
				<Text color="cyan">Use ↑↓ to navigate between fields</Text>
				<Text color="gray" dimColor>
					Press Ctrl+S or Esc to save and go back
				</Text>
			</Box>
		</Box>
	);
}
