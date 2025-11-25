import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {SelectedFile} from '../../utils/core/fileUtils.js';
import MarkdownRenderer from './MarkdownRenderer.js';

export interface Message {
	role: 'user' | 'assistant' | 'command' | 'subagent';
	content: string;
	streaming?: boolean;
	discontinued?: boolean;
	commandName?: string;
	hideCommandName?: boolean; // Don't show command name prefix for output chunks
	plainOutput?: boolean; // Don't show any prefix/icon, just plain text
	files?: SelectedFile[];
	images?: Array<{
		type: 'image';
		data: string;
		mimeType: string;
	}>;
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
	isExecuting?: boolean; // Whether a custom command is executing in terminal
	terminalResult?: {
		stdout?: string;
		stderr?: string;
		exitCode?: number;
		command?: string;
	};
	subAgent?: {
		agentId: string;
		agentName: string;
		isComplete?: boolean;
	};
	subAgentInternal?: boolean; // Mark internal sub-agent messages to filter from API requests
	subAgentUsage?: {
		inputTokens: number;
		outputTokens: number;
		cacheCreationInputTokens?: number;
		cacheReadInputTokens?: number;
	};
	parallelGroup?: string; // Group ID for parallel tool execution (same ID = executed together)
}

interface Props {
	messages: Message[];
	animationFrame: number;
	maxMessages?: number;
}

const STREAM_COLORS = ['#FF6EBF', 'green', 'blue', 'cyan', '#B588F8'] as const;

const MessageList = memo(
	({messages, animationFrame, maxMessages = 6}: Props) => {
		if (messages.length === 0) {
			return null;
		}

		return (
			<Box flexDirection="column" overflow="hidden">
				{messages.slice(-maxMessages).map((message, index) => {
					const iconColor =
						message.role === 'user'
							? 'green'
							: message.role === 'command'
							? 'gray'
							: message.role === 'subagent'
							? 'magenta'
							: message.streaming
							? (STREAM_COLORS[animationFrame] as any)
							: 'cyan';

					return (
						<Box key={index}>
							<Text color={iconColor} bold>
								{message.role === 'user'
									? '⛇'
									: message.role === 'command'
									? '⌘'
									: message.role === 'subagent'
									? '◈'
									: '❆'}
							</Text>
							<Box marginLeft={1} flexDirection="column">
								{message.role === 'command' ? (
									<Text color="gray">└─ {message.commandName}</Text>
								) : message.role === 'subagent' ? (
									<>
										<Text color="magenta" dimColor>
											└─ Sub-Agent: {message.subAgent?.agentName}
											{message.subAgent?.isComplete ? ' ✓' : ' ...'}
										</Text>
										<Box marginLeft={2}>
											<Text color="gray">{message.content || ' '}</Text>
										</Box>
									</>
								) : (
									<>
										{message.role === 'user' ? (
											<Text color="white" backgroundColor="#4a4a4a">
												{message.content || ' '}
											</Text>
										) : (
											<MarkdownRenderer content={message.content || ' '} />
										)}
										{(message.files || message.images) && (
											<Box flexDirection="column">
												{message.files && message.files.length > 0 && (
													<>
														{message.files.map((file, fileIndex) => (
															<Text key={fileIndex} color="gray" dimColor>
																{file.isImage
																	? `└─ [image #{fileIndex + 1}] ${file.path}`
																	: `└─ Read \`${file.path}\`${
																			file.exists
																				? ` (total line ${file.lineCount})`
																				: ' (file not found)'
																	  }`}
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
										{message.toolCall &&
											message.toolCall.name === 'terminal-execute' &&
											message.toolCall.arguments.command && (
												<Box marginTop={1} flexDirection="column">
													<Text color="gray" dimColor>
														└─ Command:{' '}
														<Text color="white">
															{message.toolCall.arguments.command}
														</Text>
													</Text>
													<Text color="gray" dimColor>
														└─ Exit Code:{' '}
														<Text
															color={
																message.toolCall.arguments.exitCode === 0
																	? 'green'
																	: 'red'
															}
														>
															{message.toolCall.arguments.exitCode}
														</Text>
													</Text>
													{message.toolCall.arguments.stdout &&
														message.toolCall.arguments.stdout.trim().length >
															0 && (
															<Box flexDirection="column" marginTop={1}>
																<Text color="green" dimColor>
																	└─ stdout:
																</Text>
																<Box paddingLeft={2}>
																	<Text color="white">
																		{message.toolCall.arguments.stdout
																			.trim()
																			.split('\n')
																			.slice(0, 20)
																			.join('\n')}
																	</Text>
																	{message.toolCall.arguments.stdout
																		.trim()
																		.split('\n').length > 20 && (
																		<Text color="gray" dimColor>
																			... (output truncated)
																		</Text>
																	)}
																</Box>
															</Box>
														)}
													{message.toolCall.arguments.stderr &&
														message.toolCall.arguments.stderr.trim().length >
															0 && (
															<Box flexDirection="column" marginTop={1}>
																<Text color="red" dimColor>
																	└─ stderr:
																</Text>
																<Box paddingLeft={2}>
																	<Text color="red">
																		{message.toolCall.arguments.stderr
																			.trim()
																			.split('\n')
																			.slice(0, 10)
																			.join('\n')}
																	</Text>
																	{message.toolCall.arguments.stderr
																		.trim()
																		.split('\n').length > 10 && (
																		<Text color="gray" dimColor>
																			... (output truncated)
																		</Text>
																	)}
																</Box>
															</Box>
														)}
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
					);
				})}
			</Box>
		);
	},
	(prevProps, nextProps) => {
		const hasStreamingMessage = nextProps.messages.some(m => m.streaming);

		if (hasStreamingMessage) {
			return (
				prevProps.messages === nextProps.messages &&
				prevProps.animationFrame === nextProps.animationFrame
			);
		}

		return prevProps.messages === nextProps.messages;
	},
);

MessageList.displayName = 'MessageList';

export default MessageList;
