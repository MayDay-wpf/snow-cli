import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Alert } from '@inkjs/ui';
import WelcomeScreen from './ui/pages/WelcomeScreen.js';
import ApiConfigScreen from './ui/pages/ApiConfigScreen.js';
import ModelConfigScreen from './ui/pages/ModelConfigScreen.js';
import MCPConfigScreen from './ui/pages/MCPConfigScreen.js';
import ChatScreen from './ui/pages/ChatScreen.js';
import { useGlobalExit, ExitNotification as ExitNotificationType } from './hooks/useGlobalExit.js';

type Props = {
	version?: string;
};

export default function App({ version }: Props) {
	const [currentView, setCurrentView] = useState<
		'welcome' | 'chat' | 'settings' | 'config' | 'models' | 'mcp'
	>('welcome');

	const [exitNotification, setExitNotification] = useState<ExitNotificationType>({
		show: false,
		message: ''
	});

	// Global exit handler
	useGlobalExit(setExitNotification);

	const handleMenuSelect = (value: string) => {
		if (value === 'chat' || value === 'settings' || value === 'config' || value === 'models' || value === 'mcp') {
			setCurrentView(value);
		} else if (value === 'exit') {
			process.exit(0);
		}
	};

	const renderView = () => {
		switch (currentView) {
			case 'welcome':
				return (
					<WelcomeScreen version={version} onMenuSelect={handleMenuSelect} />
				);
			case 'chat':
				return (
					<ChatScreen />
				);
			case 'settings':
				return (
					<Box flexDirection="column">
						<Text color="blue">Settings</Text>
						<Text color="gray">
							Settings interface would be implemented here
						</Text>
					</Box>
				);
			case 'config':
				return (
					<ApiConfigScreen
						onBack={() => setCurrentView('welcome')}
						onSave={() => setCurrentView('welcome')}
					/>
				);
			case 'models':
				return (
					<ModelConfigScreen
						onBack={() => setCurrentView('welcome')}
						onSave={() => setCurrentView('welcome')}
					/>
				);
			case 'mcp':
				return (
					<MCPConfigScreen
						onBack={() => setCurrentView('welcome')}
						onSave={() => setCurrentView('welcome')}
					/>
				);
			default:
				return (
					<WelcomeScreen version={version} onMenuSelect={handleMenuSelect} />
				);
		}
	};

	return (
		<Box flexDirection="column">
			{renderView()}
			{exitNotification.show && (
				<Box padding={1}>
					<Alert variant="warning">
						{exitNotification.message}
					</Alert>
				</Box>
			)}
		</Box>
	);
}
