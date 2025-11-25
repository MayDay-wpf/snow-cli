import React, {useState, useEffect, Suspense} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';

// Lazy load all page components to improve startup time
// Only load components when they are actually needed
const WelcomeScreen = React.lazy(() => import('./ui/pages/WelcomeScreen.js'));
const ChatScreen = React.lazy(() => import('./ui/pages/ChatScreen.js'));
const HeadlessModeScreen = React.lazy(
	() => import('./ui/pages/HeadlessModeScreen.js'),
);
const MCPConfigScreen = React.lazy(
	() => import('./ui/pages/MCPConfigScreen.js'),
);
const SystemPromptConfigScreen = React.lazy(
	() => import('./ui/pages/SystemPromptConfigScreen.js'),
);
const CustomHeadersScreen = React.lazy(
	() => import('./ui/pages/CustomHeadersScreen.js'),
);

import {
	useGlobalExit,
	ExitNotification as ExitNotificationType,
} from './hooks/integration/useGlobalExit.js';
import {onNavigate} from './hooks/integration/useGlobalNavigation.js';
import {useTerminalSize} from './hooks/ui/useTerminalSize.js';
import {I18nProvider} from './i18n/index.js';
import {ThemeProvider} from './ui/contexts/ThemeContext.js';

type Props = {
	version?: string;
	skipWelcome?: boolean;
	autoResume?: boolean;
	headlessPrompt?: string;
	enableYolo?: boolean;
};

// Inner component that uses I18n context
function AppContent({
	version,
	skipWelcome,
	autoResume,
	enableYolo,
}: {
	version?: string;
	skipWelcome?: boolean;
	autoResume?: boolean;
	enableYolo?: boolean;
}) {
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

	// Global exit handler (must be inside I18nProvider)
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
		const loadingFallback = null;

		switch (currentView) {
			case 'welcome':
				return (
					<Suspense fallback={loadingFallback}>
						<WelcomeScreen version={version} onMenuSelect={handleMenuSelect} />
					</Suspense>
				);
			case 'chat':
				return (
					<Suspense fallback={loadingFallback}>
						<ChatScreen
							key={chatScreenKey}
							autoResume={autoResume}
							enableYolo={enableYolo}
						/>
					</Suspense>
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
			case 'mcp':
				return (
					<Suspense fallback={loadingFallback}>
						<MCPConfigScreen
							onBack={() => setCurrentView('welcome')}
							onSave={() => setCurrentView('welcome')}
						/>
					</Suspense>
				);
			case 'systemprompt':
				return (
					<Suspense fallback={loadingFallback}>
						<SystemPromptConfigScreen
							onBack={() => setCurrentView('welcome')}
						/>
					</Suspense>
				);
			case 'customheaders':
				return (
					<Suspense fallback={loadingFallback}>
						<CustomHeadersScreen onBack={() => setCurrentView('welcome')} />
					</Suspense>
				);
			default:
				return (
					<Suspense fallback={loadingFallback}>
						<WelcomeScreen version={version} onMenuSelect={handleMenuSelect} />
					</Suspense>
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

export default function App({
	version,
	skipWelcome,
	autoResume,
	headlessPrompt,
	enableYolo,
}: Props) {
	// If headless prompt is provided, use headless mode
	// Wrap in I18nProvider since HeadlessModeScreen might use hooks that depend on it
	if (headlessPrompt) {
		const loadingFallback = null;

		return (
			<I18nProvider>
				<ThemeProvider>
					<Suspense fallback={loadingFallback}>
						<HeadlessModeScreen
							prompt={headlessPrompt}
							onComplete={() => process.exit(0)}
						/>
					</Suspense>
				</ThemeProvider>
			</I18nProvider>
		);
	}

	return (
		<I18nProvider>
			<ThemeProvider>
				<AppContent
					version={version}
					skipWelcome={skipWelcome}
					autoResume={autoResume}
					enableYolo={enableYolo}
				/>
			</ThemeProvider>
		</I18nProvider>
	);
}
