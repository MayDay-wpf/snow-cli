import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Alert } from '@inkjs/ui';
import Menu from '../ui/Menu.js';

type Props = {
	version?: string;
	onMenuSelect?: (value: string) => void;
};

export default function WelcomeScreen({
	version = '1.0.0',
	onMenuSelect,
}: Props) {
	const [infoText, setInfoText] = useState('Start a new chat conversation');

	const menuOptions = [
		{
			label: 'Start',
			value: 'chat',
			infoText: 'Start a new chat conversation'
		},
		{
			label: 'API Settings',
			value: 'config',
			infoText: 'Configure OpenAI API settings',
		},
		{
			label: 'Model Settings',
			value: 'models',
			infoText: 'Configure AI models for different tasks',
		},
		{
			label: 'Exit',
			value: 'exit',
			color: 'rgb(232, 131, 136)',
			infoText: 'Exit the application',
		}
	];

	const handleSelectionChange = (newInfoText: string) => {
		setInfoText(newInfoText);
	};

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={2} borderStyle="round" paddingX={2} paddingY={1} borderColor={'cyan'}>
				<Box flexDirection="column">
					<Text color="cyan" bold>
						A I B O T P R O
					</Text>
					<Text color="blue">C L I</Text>
					<Text color="gray" dimColor>
						Intelligent Command Line Assistant
					</Text>
					<Text color="magenta" dimColor>
						Version {version}
					</Text>
				</Box>
			</Box>

			{onMenuSelect && (
				<Box marginBottom={2}>
					<Menu
						options={menuOptions}
						onSelect={onMenuSelect}
						onSelectionChange={handleSelectionChange}
					/>
				</Box>
			)}

			<Box justifyContent="space-between">
				<Alert variant='info'>
					{infoText}
				</Alert>
			</Box>
		</Box >
	);
}
