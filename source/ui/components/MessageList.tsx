import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { SelectedFile } from '../../utils/fileUtils.js';

export interface Message {
	role: 'user' | 'assistant' | 'command';
	content: string;
	streaming?: boolean;
	discontinued?: boolean;
	commandName?: string;
	files?: SelectedFile[];
	renderedLines?: string[];
}

interface Props {
	messages: Message[];
	animationFrame: number;
	maxMessages?: number;
}

const STREAM_COLORS = ['#FF6EBF', 'green', 'blue', 'cyan', '#B588F8'] as const;

const MessageList = memo(({ messages, animationFrame, maxMessages = 6 }: Props) => {
	if (messages.length === 0) {
		return null;
	}

	return (
		<Box marginBottom={1} flexDirection="column">
			{messages.slice(-maxMessages).map((message, index) => {
				const iconColor =
					message.role === 'user'
						? 'green'
						: message.role === 'command'
							? 'gray'
							: message.streaming
								? (STREAM_COLORS[animationFrame] as any)
								: 'cyan';

				return (
					<Box key={index}>
						<Text color={iconColor} bold>
							{message.role === 'user' ? '⛇' : message.role === 'command' ? '⌘' : '❆'}
						</Text>
						<Box marginLeft={1} marginBottom={1} flexDirection="column">
							{message.role === 'command' ? (
								<Text color="gray">└─ {message.commandName}</Text>
							) : (
								<>
									{getDisplayLines(message).map((line, lineIndex) => (
										<Text
											key={lineIndex}
											color={message.role === 'user' ? 'gray' : undefined}
										>
												{line}
										</Text>
									))}
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
										<Text color="red" bold>└─ user discontinue</Text>
									)}
								</>
							)}
						</Box>
					</Box>
				);
			})}
		</Box>
	);
}, (prevProps, nextProps) => {
	const hasStreamingMessage = nextProps.messages.some(m => m.streaming);

	if (hasStreamingMessage) {
		return prevProps.messages === nextProps.messages && prevProps.animationFrame === nextProps.animationFrame;
	}

	return prevProps.messages === nextProps.messages;
});

MessageList.displayName = 'MessageList';

export default MessageList;

function getDisplayLines(message: Message): string[] {
	const source = message.renderedLines?.length
		? message.renderedLines
		: message.content === ''
			? ['']
			: message.content.split('\n');

	return source.map(line => {
		const normalized = message.renderedLines
			? line.replace(/\r?\n$/, '')
			: line.replace(/\r/g, '');
		return normalized === '' ? ' ' : normalized;
	});
}
