import React, { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import MCPInfoPanel from './MCPInfoPanel.js';

type Props = {
	onClose: () => void;
	panelKey: number;
};

export default function MCPInfoScreen({ onClose, panelKey }: Props) {
	useEffect(() => {
		process.stdout.write('\x1B[?1049h');
		process.stdout.write('\x1B[2J');
		process.stdout.write('\x1B[H');
		return () => {
			process.stdout.write('\x1B[2J');
			process.stdout.write('\x1B[?1049l');
		};
	}, []);

	useInput((_, key) => {
		if (key.escape) {
			onClose();
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1} borderStyle="double" paddingX={2} paddingY={1} borderColor={'cyan'}>
				<Box flexDirection="column">
					<Text color="white" bold>
						<Text color="cyan">❆ </Text>
						MCP Services Overview
					</Text>
					<Text color="gray" dimColor>
						Press ESC to return to the chat
					</Text>
				</Box>
			</Box>
			<MCPInfoPanel key={panelKey} />
		</Box>
	);
}
