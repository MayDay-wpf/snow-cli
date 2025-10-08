import React, { memo } from 'react';
import { Box, Text } from 'ink';
import { SelectedFile } from '../../utils/fileUtils.js';
import MarkdownRenderer from './MarkdownRenderer.js';

export interface Message {
	role: 'user' | 'assistant' | 'command';
	content: string;
	streaming?: boolean;
	discontinued?: boolean;
	commandName?: string;
	showTodoTree?: boolean;
	files?: SelectedFile[];
	images?: Array<{
		type: 'image';
		data: string;
		mimeType: string;
	}>;
	systemInfo?: {
		platform: string;
		shell: string;
		workingDirectory: string;
	};
	toolCall?: {
		name: string;
		arguments: any;
	};
	toolDisplay?: {
		toolName: string;
		args: Array<{key: string; value: string; isLast: boolean}>;
	};
	toolResult?: string; // Raw JSON string from tool execution for preview
	toolCallId?: string; // Tool call ID for updating message in place
	toolPending?: boolean; // Whether the tool is still executing
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
		<Box marginBottom={1} flexDirection="column" overflow="hidden">
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
									<MarkdownRenderer
										content={message.content || ' '}
										color={message.role === 'user' ? 'gray' : undefined}
									/>
									{(message.systemInfo || message.files || message.images) && (
										<Box marginTop={1} flexDirection="column">
											{message.systemInfo && (
												<>
													<Text color="gray" dimColor>
														└─ Platform: {message.systemInfo.platform}
													</Text>
													<Text color="gray" dimColor>
														└─ Shell: {message.systemInfo.shell}
													</Text>
													<Text color="gray" dimColor>
														└─ Working Directory: {message.systemInfo.workingDirectory}
													</Text>
												</>
											)}
											{message.files && message.files.length > 0 && (
												<>
													{message.files.map((file, fileIndex) => (
														<Text key={fileIndex} color="gray" dimColor>
															{file.isImage
																? `└─ [image #{fileIndex + 1}] ${file.path}`
																: `└─ Read \`${file.path}\`${file.exists ? ` (total line ${file.lineCount})` : ' (file not found)'}`
															}
														</Text>
													))}
												</>
											)}
											{message.images && message.images.length > 0 && (
												<>
													{message.images.map((_image, imageIndex) => (
														<Text key={imageIndex} color="gray" dimColor>
															└─ [image #{imageIndex + 1}]
														</Text>
													))}
												</>
											)}
										</Box>
									)}
									{/* Show terminal execution result */}
									{message.toolCall && message.toolCall.name === 'terminal-execute' && message.toolCall.arguments.command && (
										<Box marginTop={1} flexDirection="column">
											<Text color="gray" dimColor>└─ Command: <Text color="white">{message.toolCall.arguments.command}</Text></Text>
											<Text color="gray" dimColor>└─ Exit Code: <Text color={message.toolCall.arguments.exitCode === 0 ? 'green' : 'red'}>{message.toolCall.arguments.exitCode}</Text></Text>
											{message.toolCall.arguments.stdout && message.toolCall.arguments.stdout.trim().length > 0 && (
												<Box flexDirection="column" marginTop={1}>
													<Text color="green" dimColor>└─ stdout:</Text>
													<Box paddingLeft={2}>
														<Text color="white">{message.toolCall.arguments.stdout.trim().split('\n').slice(0, 20).join('\n')}</Text>
														{message.toolCall.arguments.stdout.trim().split('\n').length > 20 && (
															<Text color="gray" dimColor>... (output truncated)</Text>
														)}
													</Box>
												</Box>
											)}
											{message.toolCall.arguments.stderr && message.toolCall.arguments.stderr.trim().length > 0 && (
												<Box flexDirection="column" marginTop={1}>
													<Text color="red" dimColor>└─ stderr:</Text>
													<Box paddingLeft={2}>
														<Text color="red">{message.toolCall.arguments.stderr.trim().split('\n').slice(0, 10).join('\n')}</Text>
														{message.toolCall.arguments.stderr.trim().split('\n').length > 10 && (
															<Text color="gray" dimColor>... (output truncated)</Text>
														)}
													</Box>
												</Box>
											)}
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
