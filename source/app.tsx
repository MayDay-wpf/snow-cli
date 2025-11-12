import React, {useState, useEffect} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import WelcomeScreen from './ui/pages/WelcomeScreen.js';
import MCPConfigScreen from './ui/pages/MCPConfigScreen.js';
import SystemPromptConfigScreen from './ui/pages/SystemPromptConfigScreen.js';
import CustomHeadersScreen from './ui/pages/CustomHeadersScreen.js';
import ChatScreen from './ui/pages/ChatScreen.js';
import HeadlessModeScreen from './ui/pages/HeadlessModeScreen.js';
import {
	useGlobalExit,
	ExitNotification as ExitNotificationType,
} from './hooks/useGlobalExit.js';
import {onNavigate} from './hooks/useGlobalNavigation.js';
import {useTerminalSize} from './hooks/useTerminalSize.js';
import {I18nProvider} from './i18n/index.js';

type Props = {
	version?: string;
	skipWelcome?: boolean;
	headlessPrompt?: string;
};

export default function App({version, skipWelcome, headlessPrompt}: Props) {
	// If headless prompt is provided, use headless mode
	if (headlessPrompt) {
		return (
			<HeadlessModeScreen
				prompt={headlessPrompt}
				onComplete={() => process.exit(0)}
			/>
		);
	}

	const [currentView, setCurrentView] = useState<
		'welcome' | 'chat' | 'settings' | 'mcp' | 'systemprompt' | 'customheaders'
	>(skipWelcome ? 'chat' : 'welcome');

	// Add a key to force remount ChatScreen when returning from welcome screen
	// This ensures configuration changes are picked up
	const [chatScreenKey, setChatScreenKey] = useState(0);

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
			// When navigating to welcome from chat (e.g., /home command),
			// increment key so next time chat is entered, it remounts with fresh config
			if (event.destination === 'welcome' && currentView === 'chat') {
				setChatScreenKey(prev => prev + 1);
			}
			setCurrentView(event.destination);
		});
		return unsubscribe;
	}, [currentView]);

	const handleMenuSelect = (value: string) => {
		if (
			value === 'chat' ||
			value === 'settings' ||
			value === 'mcp' ||
			value === 'systemprompt' ||
			value === 'customheaders'
		) {
			// When entering chat from welcome screen, increment key to force remount
			// This ensures any configuration changes are picked up
			if (value === 'chat' && currentView === 'welcome') {
				setChatScreenKey(prev => prev + 1);
			}
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
				return <ChatScreen key={chatScreenKey} skipWelcome={skipWelcome} />;
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
					<SystemPromptConfigScreen onBack={() => setCurrentView('welcome')} />
				);
			case 'customheaders':
				return <CustomHeadersScreen onBack={() => setCurrentView('welcome')} />;
			default:
				return (
					<WelcomeScreen version={version} onMenuSelect={handleMenuSelect} />
				);
		}
	};

	return (
		<I18nProvider>
			<Box flexDirection="column" width={terminalWidth}>
				{renderView()}
				{exitNotification.show && (
					<Box paddingX={1} flexShrink={0}>
						<Alert variant="warning">{exitNotification.message}</Alert>
					</Box>
				)}
			</Box>
		</I18nProvider>
	);
}
