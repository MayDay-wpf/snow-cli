import React, {useState} from 'react';
import {Box, Text} from 'ink';
import WelcomeScreen from './components/WelcomeScreen.js';
import ApiConfigScreen from './components/ApiConfigScreen.js';

type Props = {
	version?: string;
};

export default function App({version}: Props) {
	const [currentView, setCurrentView] = useState<
		'welcome' | 'chat' | 'settings' | 'config'
	>('welcome');

	const handleMenuSelect = (value: string) => {
		if (value === 'chat' || value === 'settings' || value === 'config') {
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
					<Box flexDirection="column">
						<Text color="green">Starting conversation...</Text>
						<Text color="gray">
							Chat functionality would be implemented here
						</Text>
					</Box>
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
			default:
				return (
					<WelcomeScreen version={version} onMenuSelect={handleMenuSelect} />
				);
		}
	};

	return <Box flexDirection="column">{renderView()}</Box>;
}
