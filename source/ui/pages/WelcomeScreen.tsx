import React, { useState, useMemo, useCallback } from 'react';
import { Box, Text } from 'ink';
import { Alert } from '@inkjs/ui';
import Gradient from 'ink-gradient';
import Menu from '../components/Menu.js';

type Props = {
	version?: string;
	onMenuSelect?: (value: string) => void;
};

export default function WelcomeScreen({
	version = '1.0.0',
	onMenuSelect,
}: Props) {
	const [infoText, setInfoText] = useState('Start a new chat conversation');

	const menuOptions = useMemo(() => [
		{
			label: 'Start',
			value: 'chat',
			infoText: 'Start a new chat conversation',
			clearTerminal: true
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
			label: 'System Prompt Settings',
			value: 'systemprompt',
			infoText: 'Configure custom system prompt (overrides default)',
		},
		{
			label: 'Custom Headers Settings',
			value: 'customheaders',
			infoText: 'Configure custom HTTP headers for API requests',
		},
		{
			label: 'MCP Settings',
			value: 'mcp',
			infoText: 'Configure Model Context Protocol servers',
		},
		{
			label: 'Exit',
			value: 'exit',
			color: 'rgb(232, 131, 136)',
			infoText: 'Exit the application',
		}
	], []);

	const handleSelectionChange = useCallback((newInfoText: string) => {
		setInfoText(newInfoText);
	}, []);

	return (
		<Box flexDirection="column" padding={1}>
			<Box borderStyle="double" paddingX={1} paddingY={1} borderColor={'cyan'}>
				<Box flexDirection="column">
					<Text color="white" bold>
						<Text color="cyan">❆ </Text>
						<Gradient name="rainbow">SNOW AI CLI</Gradient>
					</Text>
					<Text color="gray" dimColor>
						Intelligent Command Line Assistant
					</Text>
					<Text color="magenta" dimColor>
						Version {version}
					</Text>

					{onMenuSelect && (
						<Box>
							<Menu
								options={menuOptions}
								onSelect={onMenuSelect}
								onSelectionChange={handleSelectionChange}
							/>
						</Box>
					)}
					<Alert variant='info'>
						{infoText}
					</Alert>
				</Box>
			</Box>
		</Box >
	);
}
