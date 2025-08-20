import React from 'react';
import { Box, Text } from 'ink';
import { SelectedFile } from '../../utils/fileUtils.js';

export interface Message {
	role: 'user' | 'assistant' | 'command';
	content: string;
	streaming?: boolean;
	discontinued?: boolean;
	commandName?: string;
	files?: SelectedFile[];
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
		<Box marginBottom={1} flexDirection="column">
			{messages.slice(-maxMessages).map((message, index) => (
				<Box key={index}>
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
								{message.files && message.files.length > 0 && (
									<Box marginTop={1} flexDirection="column">
										{message.files.map((file, fileIndex) => (
											<Text key={fileIndex} color="blue">
												└─ Read `{file.path}`{file.exists ? ` (total line ${file.lineCount})` : ' (file not found)'}
											</Text>
										))}
									</Box>
								)}
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