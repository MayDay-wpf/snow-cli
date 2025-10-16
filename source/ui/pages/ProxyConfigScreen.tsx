import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Gradient from 'ink-gradient';
import { Alert } from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getProxyConfig,
	updateProxyConfig,
	type ProxyConfig,
} from '../../utils/apiConfig.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
	inlineMode?: boolean;
};

export default function ProxyConfigScreen({ onBack, onSave, inlineMode = false }: Props) {
	const [enabled, setEnabled] = useState(false);
	const [port, setPort] = useState('7890');
	const [currentField, setCurrentField] = useState<'enabled' | 'port'>('enabled');
	const [errors, setErrors] = useState<string[]>([]);
	const [isEditing, setIsEditing] = useState(false);

	useEffect(() => {
		const config = getProxyConfig();
		setEnabled(config.enabled);
		setPort(config.port.toString());
	}, []);

	const validateConfig = (): string[] => {
		const validationErrors: string[] = [];
		const portNum = parseInt(port, 10);

		if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
			validationErrors.push('Port must be a number between 1 and 65535');
		}

		return validationErrors;
	};

	const saveConfig = () => {
		const validationErrors = validateConfig();
		if (validationErrors.length === 0) {
			const config: ProxyConfig = {
				enabled,
				port: parseInt(port, 10),
			};
			updateProxyConfig(config);
			setErrors([]);
			return true;
		} else {
			setErrors(validationErrors);
			return false;
		}
	};

	useInput((input, key) => {
		// Handle save/exit globally
		if (input === 's' && (key.ctrl || key.meta)) {
			if (saveConfig()) {
				onSave();
			}
		} else if (key.escape) {
			saveConfig(); // Try to save even on escape
			onBack();
		} else if (key.return) {
			if (isEditing) {
				// Exit edit mode, return to navigation
				setIsEditing(false);
			} else {
				// Enter edit mode for current field (toggle for checkbox)
				if (currentField === 'enabled') {
					setEnabled(!enabled);
				} else {
					setIsEditing(true);
				}
			}
		} else if (!isEditing && key.upArrow) {
			if (currentField === 'port') {
				setCurrentField('enabled');
			}
		} else if (!isEditing && key.downArrow) {
			if (currentField === 'enabled') {
				setCurrentField('port');
			}
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box marginBottom={2} borderStyle="double" borderColor={"cyan"} paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Gradient name="rainbow">
							Proxy Configuration
						</Gradient>
						<Text color="gray" dimColor>
							Configure system proxy for web search and fetch
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column" marginBottom={2}>
				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'enabled' ? 'green' : 'white'}>
							{currentField === 'enabled' ? '❯ ' : '  '}Enable Proxy:
						</Text>
						<Box marginLeft={3}>
							<Text color="gray">
								{enabled ? '☑ Enabled' : '☐ Disabled'} (Press Enter to toggle)
							</Text>
						</Box>
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text color={currentField === 'port' ? 'green' : 'white'}>
							{currentField === 'port' ? '❯ ' : '  '}Proxy Port:
						</Text>
						{currentField === 'port' && isEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={port}
									onChange={setPort}
									placeholder="7890"
								/>
							</Box>
						)}
						{(!isEditing || currentField !== 'port') && (
							<Box marginLeft={3}>
								<Text color="gray">{port || 'Not set'}</Text>
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
							Use ↑↓ to navigate between fields, press Enter to edit/toggle,
							and press Ctrl+S or Esc to save and return
						</Alert>
					</>
				)}
			</Box>

			<Box flexDirection="column" marginTop={1}>
				<Alert variant="info">
					Proxy will be used for websearch tools (DuckDuckGo search and page fetch).
					Default port is 7890. Make sure your proxy server is running on http://127.0.0.1:[port]
				</Alert>
			</Box>
		</Box>
	);
}
