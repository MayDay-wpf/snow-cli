import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import WelcomeScreen from './ui/pages/WelcomeScreen.js';
import MCPConfigScreen from './ui/pages/MCPConfigScreen.js';
import SystemPromptConfigScreen from './ui/pages/SystemPromptConfigScreen.js';
import CustomHeadersScreen from './ui/pages/CustomHeadersScreen.js';
import ChatScreen from './ui/pages/ChatScreen.js';
import {
	useGlobalExit,
	ExitNotification as ExitNotificationType,
} from './hooks/useGlobalExit.js';
import {onNavigate} from './hooks/useGlobalNavigation.js';
import {useTerminalSize} from './hooks/useTerminalSize.js';

type Props = {
	version?: string;
	skipWelcome?: boolean;
};

export default function App({version, skipWelcome}: Props) {
	const [currentView, setCurrentView] = useState<
		'welcome' | 'chat' | 'settings' | 'mcp' | 'systemprompt' | 'customheaders'
	>(skipWelcome ? 'chat' : 'welcome');

	const [exitNotification, setExitNotification] =
		useState<ExitNotificationType>({
			show: false,
			message: '',
		});

	// Get terminal size for proper width calculation
	const {columns: terminalWidth} = useTerminalSize();

	// Global exit handler
	useGlobalExit(setExitNotification);

	// Global navigation handler
	useEffect(() => {
		const unsubscribe = onNavigate(event => {
			setCurrentView(event.destination);
		});
		return unsubscribe;
	}, []);

	const handleMenuSelect = (value: string) => {
		if (
			value === 'chat' ||
			value === 'settings' ||
			value === 'mcp' ||
			value === 'systemprompt' ||
			value === 'customheaders'
		) {
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
				return <ChatScreen skipWelcome={skipWelcome} />;
			case 'settings':
				return (
					<Box flexDirection="column">
						<Text color="blue">Settings</Text>
						<Text color="gray">
							Settings interface would be implemented here
						</Text>
					</Box>
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
		<Box flexDirection="column" width={terminalWidth}>
			{renderView()}
			{exitNotification.show && (
				<Box paddingX={1} flexShrink={0}>
					<Alert variant="warning">{exitNotification.message}</Alert>
				</Box>
			)}
		</Box>
	);
}
