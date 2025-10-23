import React from 'react';
import { Box, Text } from 'ink';

interface Props {
	pendingMessages: string[];
}

export default function PendingMessages({ pendingMessages }: Props) {
	if (pendingMessages.length === 0) {
		return null;
	}

	return (
		<Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
			<Text color="yellow" bold>
				⬑ Pending Messages ({pendingMessages.length})
			</Text>
			{pendingMessages.map((message, index) => (
				<Box key={index} marginLeft={1} marginY={0}>
					<Text color="blue" bold>
						{index + 1}.
					</Text>
					<Box marginLeft={1}>
						<Text color="gray">
							{message.length > 60 ? `${message.substring(0, 60)}...` : message}
						</Text>
					</Box>
				</Box>
			))}
			<Text color="yellow" dimColor>
				Will be sent after tool execution completes
			</Text>
		</Box>
	);
}