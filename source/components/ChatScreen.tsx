import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import ChatInput from './ChatInput.js';

type Props = {
	onBack: () => void;
};

export default function ChatScreen({ onBack }: Props) {
	const [messages, setMessages] = useState<string[]>([]);

	const handleMessageSubmit = (message: string) => {
		setMessages(prev => [...prev, message]);
	};

	useInput((_, key) => {
		if (key.escape) {
			onBack();
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={2} borderStyle="round" paddingX={2} paddingY={1}>
				<Box flexDirection="column">
					<Text color="green" bold>
						Tips & Quick Commands:
					</Text>
					<Text color="white">
						• Ask for code explanations and debugging help
					</Text>
					<Text color="white">
						• Request code reviews and optimization suggestions
					</Text>
					<Text color="white">
						• Get help with specific programming languages
					</Text>
					<Text color="white">
						• Ask about best practices and design patterns
					</Text>
					<Text color="yellow" dimColor>
						Pro tip: Be specific about your programming context for better help
					</Text>
				</Box>
			</Box>

			{messages.length > 0 && (
				<Box marginBottom={2} flexDirection="column">
					<Text color="blue" bold>
						Recent Messages:
					</Text>
					{messages.slice(-3).map((message, index) => (
						<Box key={index} marginLeft={2}>
							<Text color="gray">
								• {message}
							</Text>
						</Box>
					))}
				</Box>
			)}

			<Box marginBottom={2}>
				<ChatInput
					onSubmit={handleMessageSubmit}
					placeholder="Ask me anything about coding..."
				/>
			</Box>
		</Box>
	);
}