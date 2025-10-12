import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Alert } from '@inkjs/ui';
import WelcomeScreen from './ui/pages/WelcomeScreen.js';
import ApiConfigScreen from './ui/pages/ApiConfigScreen.js';
import ModelConfigScreen from './ui/pages/ModelConfigScreen.js';
import MCPConfigScreen from './ui/pages/MCPConfigScreen.js';
import SystemPromptConfigScreen from './ui/pages/SystemPromptConfigScreen.js';
import CustomHeadersScreen from './ui/pages/CustomHeadersScreen.js';
import ChatScreen from './ui/pages/ChatScreen.js';
import { useGlobalExit, ExitNotification as ExitNotificationType } from './hooks/useGlobalExit.js';
import { onNavigate } from './hooks/useGlobalNavigation.js';

type Props = {
	version?: string;
};

export default function App({ version }: Props) {
	const [currentView, setCurrentView] = useState<
		'welcome' | 'chat' | 'settings' | 'config' | 'models' | 'mcp' | 'systemprompt' | 'customheaders'
	>('welcome');

	const [exitNotification, setExitNotification] = useState<ExitNotificationType>({
		show: false,
		message: ''
	});

	// Global exit handler
	useGlobalExit(setExitNotification);

	// Global navigation handler
	useEffect(() => {
		const unsubscribe = onNavigate((event) => {
			setCurrentView(event.destination);
		});
		return unsubscribe;
	}, []);

	const handleMenuSelect = (value: string) => {
		if (value === 'chat' || value === 'settings' || value === 'config' || value === 'models' || value === 'mcp' || value === 'systemprompt' || value === 'customheaders') {
			setCurrentView(value);
		} else if (value === 'exit') {
			process.exit(0);
		}
	};

	const renderView = () => {
		switch (currentView) {
			case 'welcome':
				return (
					<WelcomeScreen
						version={version}
						onMenuSelect={handleMenuSelect}
					/>
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
			case 'systemprompt':
				return (
					<SystemPromptConfigScreen
						onBack={() => setCurrentView('welcome')}
						onSave={() => setCurrentView('welcome')}
					/>
				);
			case 'customheaders':
				return (
					<CustomHeadersScreen
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
		<Box flexDirection="column" height="100%">
			<Box flexGrow={1} flexShrink={1} minHeight={0}>
				{renderView()}
			</Box>
			{exitNotification.show && (
				<Box paddingX={1} flexShrink={0}>
					<Alert variant="warning">
						{exitNotification.message}
					</Alert>
				</Box>
			)}
		</Box>
	);
}
