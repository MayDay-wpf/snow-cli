import React from 'react';
import { Box, Text } from 'ink';

export interface Message {
	role: 'user' | 'assistant' | 'command';
	content: string;
	streaming?: boolean;
	discontinued?: boolean;
	commandName?: string;
}

interface Props {
	messages: Message[];
	animationFrame: number;
	maxMessages?: number;
}

export default function MessageList({ messages, animationFrame, maxMessages = 6 }: Props) {
	if (messages.length === 0) {
		return null;
	}

	return (
		<Box marginBottom={1} flexDirection="column" paddingX={1} paddingY={1}>
			{messages.slice(-maxMessages).map((message, index) => (
				<Box key={index} marginLeft={1}>
					<Text color={
						message.role === 'user' ? 'blue' : 
						message.role === 'command' ? 'gray' :
						message.streaming ? (['#FF6EBF', 'green', 'blue', 'cyan', '#B588F8'][animationFrame] as any) : 'cyan'
					} bold>
						{message.role === 'user' ? '⛇' : message.role === 'command' ? '⌘' : '❆'}
					</Text>
					<Box marginLeft={1} marginBottom={1} flexDirection="column">
						{message.role === 'command' ? (
							<Text color="gray">
								└─ {message.commandName}
							</Text>
						) : (
							<>
								<Text color={message.role === 'user' ? 'gray' : ''}>
									{message.content}
								</Text>
								{message.discontinued && (
									<Text color="red" bold>
										└─ user discontinue
									</Text>
								)}
							</>
						)}
					</Box>
				</Box>
			))}
		</Box>
	);
}