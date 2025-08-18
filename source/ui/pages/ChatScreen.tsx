import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import ChatInput from '../components/ChatInput.js';

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
			<Box marginBottom={2} borderColor={'cyan'} borderStyle="round" paddingX={2} paddingY={1}>
				<Box flexDirection="column">
					<Text color="white" bold>
						<Text color="cyan">❄ </Text>
						Welcome to the AI Coding!:
					</Text>
					<Text color="gray" dimColor>
						• Ask for code explanations and debugging help
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