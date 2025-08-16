import React, {useEffect} from 'react';
import {Box} from 'ink';
import WelcomeScreen from './components/WelcomeScreen.js';

type Props = {
	version?: string;
};

export default function App({version}: Props) {
	useEffect(() => {
		// Clear terminal on startup
		process.stdout.write('\x1Bc');
	}, []);

	return (
		<Box flexDirection="column">
			<WelcomeScreen version={version} />
		</Box>
	);
}
