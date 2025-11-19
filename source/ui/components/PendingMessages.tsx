import React from 'react';
import { Box, Text } from 'ink';
import { useTheme } from '../contexts/ThemeContext.js';

interface PendingMessage {
	text: string;
	images?: Array<{data: string; mimeType: string}>;
}

interface Props {
	pendingMessages: PendingMessage[];
}

export default function PendingMessages({ pendingMessages }: Props) {
	const { theme } = useTheme();

	if (pendingMessages.length === 0) {
		return null;
	}

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={theme.colors.warning} paddingX={1}>
			<Text color={theme.colors.warning} bold>
				⬑ Pending Messages ({pendingMessages.length})
			</Text>
			{pendingMessages.map((message, index) => (
				<Box key={index} marginLeft={1} marginY={0} flexDirection="column">
					<Box>
						<Text color="blue" bold>
							{index + 1}.
						</Text>
						<Box marginLeft={1}>
							<Text color={theme.colors.menuSecondary}>
								{message.text.length > 60 ? `${message.text.substring(0, 60)}...` : message.text}
							</Text>
						</Box>
					</Box>
					{message.images && message.images.length > 0 && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary} dimColor>
								└─ {message.images.length} image{message.images.length > 1 ? 's' : ''} attached
							</Text>
						</Box>
					)}
				</Box>
			))}
			<Text color={theme.colors.warning} dimColor>
				Will be sent after tool execution completes
			</Text>
		</Box>
	);
}