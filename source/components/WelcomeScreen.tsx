import React, {useMemo} from 'react';
import {Box, Text, Newline} from 'ink';
import figlet from 'figlet';
import gradient from 'gradient-string';

type Props = {
	version?: string;
};

export default function WelcomeScreen({version = '1.0.0'}: Props) {
	const logo = useMemo(() => {
		try {
			const ascii = figlet.textSync('>AIBOT', {
				font: 'ANSI Shadow',
				horizontalLayout: 'default',
				verticalLayout: 'default',
			});
			
			// Apply gradient coloring similar to the image
			const gradientText = gradient(['#00CED1', '#4169E1', '#8A2BE2'])(ascii);
			return gradientText;
		} catch {
			return 'AI BOT CLI';
		}
	}, []);

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text>{logo}</Text>
			</Box>

			<Box marginBottom={2}>
				<Text color="gray" dimColor>
					Intelligent Command Line Assistant
				</Text>
			</Box>
			<Newline />

			<Box justifyContent="space-between">
				<Text color="magenta" dimColor>
					Version {version}
				</Text>
				<Text color="gray" dimColor>
					Press Ctrl+C to exit
				</Text>
			</Box>
		</Box>
	);
}