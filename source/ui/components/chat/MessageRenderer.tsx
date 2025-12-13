import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {type Message} from './MessageList.js';
import MarkdownRenderer from '../common/MarkdownRenderer.js';
import DiffViewer from '../tools/DiffViewer.js';
import ToolResultPreview from '../tools/ToolResultPreview.js';
import {HookErrorDisplay} from '../special/HookErrorDisplay.js';

type Props = {
	message: Message;
	index: number;
	isLastMessage: boolean;
	filteredMessages: Message[];
	terminalWidth: number;
};

export default function MessageRenderer({
	message,
	index,
	isLastMessage,
	filteredMessages,
	terminalWidth,
}: Props) {
	const {theme} = useTheme();

	// Helper function to remove ANSI escape codes
	const removeAnsiCodes = (text: string): string => {
		return text.replace(/\x1b\[[0-9;]*m/g, '');
	};

	// Determine tool message type and color
	let toolStatusColor: string = 'cyan';

	// Check if this message is part of a parallel group
	const isInParallelGroup =
		message.parallelGroup !== undefined && message.parallelGroup !== null;

	// Check if this is a time-consuming tool (has toolPending or starts with ⚡)
	// Time-consuming tools should not show parallel group indicators
	const isTimeConsumingTool =
		message.toolPending ||
		(message.role === 'assistant' &&
			(message.content.startsWith('⚡') || message.content.includes('⚇⚡')));

	// Only show parallel group indicators for non-time-consuming tools
	const shouldShowParallelIndicator = isInParallelGroup && !isTimeConsumingTool;

	const isFirstInGroup =
		shouldShowParallelIndicator &&
		(index === 0 ||
			filteredMessages[index - 1]?.parallelGroup !== message.parallelGroup ||
			// Previous message is time-consuming tool, so this is the first non-time-consuming one
			filteredMessages[index - 1]?.toolPending ||
			filteredMessages[index - 1]?.content.startsWith('⚡'));

	// Check if this is the last message in the parallel group
	// Only show end indicator if:
	// 1. This is truly the last message, OR
	// 2. Next message has a DIFFERENT non-null parallelGroup (not just undefined)
	const nextMessage = filteredMessages[index + 1];
	const nextHasDifferentGroup =
		nextMessage &&
		nextMessage.parallelGroup !== undefined &&
		nextMessage.parallelGroup !== null &&
		nextMessage.parallelGroup !== message.parallelGroup;
	const isLastInGroup =
		shouldShowParallelIndicator && (!nextMessage || nextHasDifferentGroup);

	if (message.role === 'assistant' || message.role === 'subagent') {
		if (message.content.startsWith('⚡') || message.content.includes('⚇⚡')) {
			toolStatusColor = 'yellowBright';
		} else if (
			message.content.startsWith('✓') ||
			message.content.includes('⚇✓')
		) {
			toolStatusColor = 'green';
		} else if (
			message.content.startsWith('✗') ||
			message.content.includes('⚇✗')
		) {
			toolStatusColor = 'red';
		} else {
			toolStatusColor = message.role === 'subagent' ? 'magenta' : 'blue';
		}
	}

	return (
		<Box
			key={`msg-${index}`}
			marginTop={index > 0 && !shouldShowParallelIndicator ? 1 : 0}
			marginBottom={isLastMessage ? 1 : 0}
			paddingX={1}
			flexDirection="column"
			width={terminalWidth}
		>
			{/* Plain output - no icons or prefixes */}
			{message.plainOutput ? (
				<Text color={message.role === 'user' ? 'white' : toolStatusColor}>
					{removeAnsiCodes(message.content)}
				</Text>
			) : (
				<>
					{/* Show parallel group indicator */}
					{isFirstInGroup && (
						<Box marginBottom={0}>
							<Text color={theme.colors.menuInfo} dimColor>
								┌─ Parallel execution
							</Text>
						</Box>
					)}

					<Box>
						<Text
							color={
								message.role === 'user'
									? 'green'
									: message.role === 'command'
									? theme.colors.menuSecondary
									: toolStatusColor
							}
							bold
						>
							{shouldShowParallelIndicator && !isFirstInGroup ? '│' : ''}
							{message.role === 'user'
								? '𖨆 '
								: message.role === 'command'
								? '⌘'
								: '❆'}
						</Text>
						<Box marginLeft={1} flexDirection="column">
							{message.role === 'command' ? (
								<>
									{!message.hideCommandName && (
										<Text color={theme.colors.menuSecondary} dimColor>
											└─ {message.commandName}
										</Text>
									)}
									{message.content && (
										<Text color="white">
											{removeAnsiCodes(message.content)}
										</Text>
									)}
								</>
							) : (
								<>
									{message.plainOutput ? (
										<Text
											color={
												message.role === 'user' ? 'white' : toolStatusColor
											}
											backgroundColor={
												message.role === 'user'
													? theme.colors.border
													: undefined
											}
										>
											{removeAnsiCodes(message.content || ' ')}
										</Text>
									) : (
										(() => {
											// Check if message has hookError field
											if (message.hookError) {
												return <HookErrorDisplay details={message.hookError} />;
											}

											// Check if content is a hook-error JSON
											try {
												const parsed = JSON.parse(message.content);
												if (parsed.type === 'hook-error') {
													return (
														<HookErrorDisplay
															details={{
																type: 'error',
																exitCode: parsed.exitCode,
																command: parsed.command,
																output: parsed.output,
																error: '',
															}}
														/>
													);
												}
											} catch {
												// Not JSON, continue with normal rendering
											}

											// For tool messages (with status icons), render as plain text with color
											// instead of using MarkdownRenderer which ignores the toolStatusColor
											const hasToolStatusIcon =
												message.content.includes('⚇⚡') ||
												message.content.includes('⚇✓') ||
												message.content.includes('⚇✗') ||
												message.content.startsWith('⚡') ||
												message.content.startsWith('✓') ||
												message.content.startsWith('✗');

											if (
												hasToolStatusIcon &&
												(message.role === 'assistant' ||
													message.role === 'subagent')
											) {
												return (
													<Text color={toolStatusColor}>
														{removeAnsiCodes(message.content || ' ')}
													</Text>
												);
											}

											return (
												<MarkdownRenderer content={message.content || ' '} />
											);
										})()
									)}
									{/* Show sub-agent token usage */}
									{message.subAgentUsage &&
										(() => {
											const formatTokens = (num: number) => {
												if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
												return num.toString();
											};

											return (
												<Text color={theme.colors.menuSecondary} dimColor>
													└─ Usage: In=
													{formatTokens(message.subAgentUsage.inputTokens)},
													Out=
													{formatTokens(message.subAgentUsage.outputTokens)}
													{message.subAgentUsage.cacheReadInputTokens
														? `, Cache Read=${formatTokens(
																message.subAgentUsage.cacheReadInputTokens,
														  )}`
														: ''}
													{message.subAgentUsage.cacheCreationInputTokens
														? `, Cache Create=${formatTokens(
																message.subAgentUsage.cacheCreationInputTokens,
														  )}`
														: ''}
												</Text>
											);
										})()}
									{message.toolDisplay &&
										message.toolDisplay.args.length > 0 &&
										// Hide tool arguments for sub-agent internal tools
										!message.subAgentInternal && (
											<Box flexDirection="column">
												{message.toolDisplay.args.map((arg, argIndex) => (
													<Text
														key={argIndex}
														color={theme.colors.menuSecondary}
														dimColor
													>
														{arg.isLast ? '└─' : '├─'} {arg.key}: {arg.value}
													</Text>
												))}
											</Box>
										)}
									{message.toolCall &&
										message.toolCall.name === 'filesystem-create' &&
										message.toolCall.arguments.content && (
											<Box marginTop={1}>
												<DiffViewer
													newContent={message.toolCall.arguments.content}
													filename={message.toolCall.arguments.path}
												/>
											</Box>
										)}
									{message.toolCall &&
										message.toolCall.name === 'filesystem-edit' &&
										message.toolCall.arguments.oldContent &&
										message.toolCall.arguments.newContent && (
											<Box marginTop={1}>
												<DiffViewer
													oldContent={message.toolCall.arguments.oldContent}
													newContent={message.toolCall.arguments.newContent}
													filename={message.toolCall.arguments.filename}
													completeOldContent={
														message.toolCall.arguments.completeOldContent
													}
													completeNewContent={
														message.toolCall.arguments.completeNewContent
													}
													startLineNumber={
														message.toolCall.arguments.contextStartLine
													}
												/>
											</Box>
										)}
									{message.toolCall &&
										message.toolCall.name === 'filesystem-edit_search' &&
										message.toolCall.arguments.oldContent &&
										message.toolCall.arguments.newContent && (
											<Box marginTop={1}>
												<DiffViewer
													oldContent={message.toolCall.arguments.oldContent}
													newContent={message.toolCall.arguments.newContent}
													filename={message.toolCall.arguments.filename}
													completeOldContent={
														message.toolCall.arguments.completeOldContent
													}
													completeNewContent={
														message.toolCall.arguments.completeNewContent
													}
													startLineNumber={
														message.toolCall.arguments.contextStartLine
													}
												/>
											</Box>
										)}
									{/* Show batch edit results */}
									{message.toolCall &&
										(message.toolCall.name === 'filesystem-edit' ||
											message.toolCall.name === 'filesystem-edit_search') &&
										message.toolCall.arguments.isBatch &&
										message.toolCall.arguments.batchResults &&
										Array.isArray(message.toolCall.arguments.batchResults) && (
											<Box marginTop={1} flexDirection="column">
												{message.toolCall.arguments.batchResults.map(
													(fileResult: any, index: number) => {
														if (
															fileResult.success &&
															fileResult.oldContent &&
															fileResult.newContent
														) {
															return (
																<Box
																	key={index}
																	flexDirection="column"
																	marginBottom={1}
																>
																	<Text bold color="cyan">
																		{`File ${index + 1}: ${fileResult.path}`}
																	</Text>
																	<DiffViewer
																		oldContent={fileResult.oldContent}
																		newContent={fileResult.newContent}
																		filename={fileResult.path}
																		completeOldContent={
																			fileResult.completeOldContent
																		}
																		completeNewContent={
																			fileResult.completeNewContent
																		}
																		startLineNumber={
																			fileResult.contextStartLine
																		}
																	/>
																</Box>
															);
														}
														return null;
													},
												)}
											</Box>
										)}
									{/* Show tool result preview for successful tool executions */}
									{(message.content.startsWith('✓') ||
										message.content.includes('⚇✓')) &&
										message.toolResult &&
										// 只在没有 diff 数据时显示预览（有 diff 的工具会用 DiffViewer 显示）
										!(
											message.toolCall &&
											(message.toolCall.arguments?.oldContent ||
												message.toolCall.arguments?.batchResults)
										) && (
											<ToolResultPreview
												toolName={
													(message.content || '')
														.replace(/^✓\s*/, '') // Remove leading ✓
														.replace(/^⚇✓\s*/, '') // Remove leading ⚇✓
														.replace(/.*⚇✓\s*/, '') // Remove any prefix before ⚇✓
														.replace(/\x1b\[[0-9;]*m/g, '') // Remove ANSI color codes
														.split('\n')[0]
														?.trim() || ''
												}
												result={message.toolResult}
												maxLines={5}
												isSubAgentInternal={
													message.role === 'subagent' ||
													message.subAgentInternal === true
												}
											/>
										)}

									{message.files && message.files.length > 0 && (
										<Box flexDirection="column">
											{message.files.map((file, fileIndex) => (
												<Text
													key={fileIndex}
													color={theme.colors.menuSecondary}
													dimColor
												>
													└─ {file.path}
													{file.exists
														? ` (total line ${file.lineCount})`
														: ' (file not found)'}
												</Text>
											))}
										</Box>
									)}
									{/* Images for user messages */}
									{message.role === 'user' &&
										message.images &&
										message.images.length > 0 && (
											<Box marginTop={1} flexDirection="column">
												{message.images.map((_image, imageIndex) => (
													<Text
														key={imageIndex}
														color={theme.colors.menuSecondary}
														dimColor
													>
														└─ [image #{imageIndex + 1}]
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

					{/* Show parallel group end indicator */}
					{!message.plainOutput && isLastInGroup && (
						<Box marginTop={0}>
							<Text color={theme.colors.menuInfo} dimColor>
								└─ End parallel execution
							</Text>
						</Box>
					)}
				</>
			)}
		</Box>
	);
}
