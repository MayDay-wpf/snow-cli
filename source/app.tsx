import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import { Alert } from '@inkjs/ui';
import WelcomeScreen from './ui/pages/WelcomeScreen.js';
import ApiConfigScreen from './ui/pages/ApiConfigScreen.js';
import ModelConfigScreen from './ui/pages/ModelConfigScreen.js';
import MCPConfigScreen from './ui/pages/MCPConfigScreen.js';
import ChatScreen from './ui/pages/ChatScreen.js';
import { useGlobalExit, ExitNotification as ExitNotificationType } from './hooks/useGlobalExit.js';
import { onNavigate } from './hooks/useGlobalNavigation.js';

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

	// Terminal resize handling - force re-render on resize
	const { stdout } = useStdout();
	const [terminalSize, setTerminalSize] = useState({ columns: stdout?.columns || 80, rows: stdout?.rows || 24 });

	// Global exit handler
	useGlobalExit(setExitNotification);

	// Global navigation handler
	useEffect(() => {
		const unsubscribe = onNavigate((event) => {
			setCurrentView(event.destination);
		});
		return unsubscribe;
	}, []);

	// Terminal resize listener with debounce
	useEffect(() => {
		if (!stdout) return;

		let resizeTimeout: NodeJS.Timeout;
		const handleResize = () => {
			// Debounce resize events - wait for resize to stabilize
			clearTimeout(resizeTimeout);
			resizeTimeout = setTimeout(() => {
				// Clear screen before re-render
				stdout.write('\x1Bc'); // Full reset
				setTerminalSize({ columns: stdout.columns, rows: stdout.rows });
			}, 100); // 100ms debounce
		};

		stdout.on('resize', handleResize);

		return () => {
			stdout.off('resize', handleResize);
			clearTimeout(resizeTimeout);
		};
	}, [stdout]);

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
		<Box flexDirection="column" key={`term-${terminalSize.columns}x${terminalSize.rows}`}>
			{renderView()}
			{exitNotification.show && (
				<Box paddingX={1}>
					<Alert variant="warning">
						{exitNotification.message}
					</Alert>
				</Box>
			)}
		</Box>
	);
}
