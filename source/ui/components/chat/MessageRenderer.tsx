import React from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {type Message} from './MessageList.js';
import MarkdownRenderer from '../common/MarkdownRenderer.js';
import DiffViewer from '../tools/DiffViewer.js';
import ToolResultPreview from '../tools/ToolResultPreview.js';
import {HookErrorDisplay} from '../special/HookErrorDisplay.js';
import {maskSkillInjectedText} from '../../../utils/ui/skillMask.js';

/**
 * Clean thinking content by removing XML-like tags
 * Some third-party APIs may include <think></think> or <thinking></thinking> tags
 */
function cleanThinkingContent(content: string): string {
	return content.replace(/\s*<\/?think(?:ing)?>\s*/gi, '').trim();
}

type Props = {
	message: Message;
	index: number;
	filteredMessages: Message[];
	terminalWidth: number;
	showThinking?: boolean;
};

export default function MessageRenderer({
	message,
	index,
	filteredMessages,
	terminalWidth,
	showThinking = true,
}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();

	// If showThinking is false and message only has thinking content (no actual content),
	// don't render anything to avoid showing empty ❆ icon
	if (
		!showThinking &&
		message.thinking &&
		!message.content &&
		!message.toolCall &&
		!message.toolResult &&
		!message.terminalResult &&
		!message.discontinued &&
		!message.hookError
	) {
		return null;
	}

	// Helper function to remove ANSI escape codes
	const removeAnsiCodes = (text: string): string => {
		return text.replace(/\x1b\[[0-9;]*m/g, '');
	};

	const getDisplayContent = (content: string): string => {
		// 只做视觉隐藏：保留原始 message.content 用于请求体/持久化。
		return maskSkillInjectedText(removeAnsiCodes(content || '')).displayText;
	};

	const formatUserBubbleText = (text: string): string => {
		const normalized = text.length > 0 ? text : ' ';
		return normalized
			.split('\n')
			.map(line => ` ${line || ' '} `)
			.join('\n');
	};

	// Determine tool message type and color
	let toolStatusColor: string = 'cyan';

	// Check if this message is part of a parallel group
	const isInParallelGroup =
		message.parallelGroup !== undefined && message.parallelGroup !== null;

	// Check if this is a time-consuming tool (has toolPending or status is pending)
	// Time-consuming tools should not show parallel group indicators
	const isTimeConsumingTool =
		message.toolPending || message.messageStatus === 'pending';

	// Only show parallel group indicators for non-time-consuming tools
	const shouldShowParallelIndicator = isInParallelGroup && !isTimeConsumingTool;

	const isFirstInGroup =
		shouldShowParallelIndicator &&
		(index === 0 ||
			filteredMessages[index - 1]?.parallelGroup !== message.parallelGroup ||
			// Previous message is time-consuming tool, so this is the first non-time-consuming one
			filteredMessages[index - 1]?.toolPending ||
			filteredMessages[index - 1]?.messageStatus === 'pending');

	// Check if this is the last message in the parallel group
	// Show end indicator if next message is not in the same parallel group
	const nextMessage = filteredMessages[index + 1];
	const nextInSameGroup =
		nextMessage &&
		nextMessage.parallelGroup !== undefined &&
		nextMessage.parallelGroup !== null &&
		nextMessage.parallelGroup === message.parallelGroup;
	const isLastInGroup = shouldShowParallelIndicator && !nextInSameGroup;

	if (message.role === 'assistant' || message.role === 'subagent') {
		// 优先使用结构化状态字段（用于持久化/恢复时避免硬编码匹配颜色）
		if (message.messageStatus === 'pending') {
			toolStatusColor = 'yellowBright';
		} else if (message.messageStatus === 'success') {
			toolStatusColor = 'green';
		} else if (message.messageStatus === 'error') {
			toolStatusColor = 'red';
		} else {
			// subAgentInternal 消息使用 cyan，其他 subagent 消息使用 magenta
			if (message.role === 'subagent' && message.subAgentInternal === true) {
				toolStatusColor = 'cyan';
			} else {
				toolStatusColor = message.role === 'subagent' ? 'magenta' : 'blue';
			}
		}
	}

	return (
		<Box
			key={`msg-${index}`}
			marginTop={0}
			marginBottom={1}
			paddingX={1}
			flexDirection="column"
			width={terminalWidth}
		>
			{/* Plain output - no icons or prefixes */}
			{message.plainOutput ? (
				<Text color={message.role === 'user' ? 'white' : toolStatusColor}>
					{getDisplayContent(message.content)}
				</Text>
			) : (
				<>
					{/* Show parallel group indicator */}
					{isFirstInGroup && (
						<Box marginBottom={0}>
							<Text color={theme.colors.menuInfo} dimColor>
								{t.chatScreen.parallelStart}
							</Text>
						</Box>
					)}

				<Box>
					<Text
						color={
							message.role === 'user'
								? message.subAgentDirected
									? 'magenta'
									: 'green'
								: message.role === 'command'
								? theme.colors.menuSecondary
								: toolStatusColor
						}
						bold
					>
						{shouldShowParallelIndicator && !isFirstInGroup ? '│' : ''}
						{message.role === 'user'
							? message.subAgentDirected
								? '»'
								: '❯'
							: message.role === 'command'
							? '⌘'
							: '❆'}
					</Text>
					<Box marginLeft={1} flexDirection="column">
						{/* Show target sub-agent tree for directed messages */}
						{message.role === 'user' &&
							message.subAgentDirected &&
							message.subAgentDirected.targets.length > 0 && (
								<Box flexDirection="column">
									{message.subAgentDirected.targets.map(
										(target, ti, arr) => {
											const isLast = ti === arr.length - 1;
											const branch = isLast ? '└─' : '├─';
											return (
												<Box key={ti}>
													<Text color="magenta" dimColor>
														{branch}{' '}
													</Text>
													<Text color="magenta">
														{target.agentName}
													</Text>
													{target.promptSnippet ? (
														<Text color="gray" dimColor>
															{' '}
															{target.promptSnippet}
														</Text>
													) : null}
												</Box>
											);
										},
									)}
								</Box>
							)}
						{message.role === 'command' ? (
								<>
									{!message.hideCommandName && (
										<Text color={theme.colors.menuSecondary} dimColor>
											└─ {message.commandName}
										</Text>
									)}
									{message.content && (
										<Text color="white">
											{getDisplayContent(message.content)}
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

											// For tool messages with status, render as plain text with color
											// instead of using MarkdownRenderer which ignores the toolStatusColor
											const hasToolStatus = message.messageStatus !== undefined;
											const isSubAgentInternal =
												message.subAgentInternal === true;

											if (
												(hasToolStatus || isSubAgentInternal) &&
												(message.role === 'assistant' ||
													message.role === 'subagent')
											) {
												// Parse content to separate title and tool tree
												const content = message.content || ' ';
												const lines = content.split('\n');
												const titleLine = lines[0] || '';
												const treeLines = lines.slice(1);

												// Calculate context usage bar for sub-agent messages
												const ctxUsage = message.subAgentContextUsage;
												const showCtxBar = ctxUsage && ctxUsage.percentage > 0;

												return (
													<>
														<Text color={toolStatusColor}>
															{removeAnsiCodes(titleLine)}
														</Text>
														{treeLines.length > 0 && (
															<Text color={theme.colors.menuSecondary}>
																{treeLines
																	.map(line => removeAnsiCodes(line || ''))
																	.join('\n')}
															</Text>
														)}
														{showCtxBar && (() => {
															const pct = ctxUsage.percentage;
															const barWidth = 10;
															const filled = Math.round((pct / 100) * barWidth);
															const empty = barWidth - filled;
															const bar = '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
															const barColor =
																pct >= 80 ? 'red' : pct >= 65 ? 'yellow' : pct >= 50 ? 'cyan' : 'gray';
															return (
																<Text color={barColor} dimColor>
																	{'└─ Context: '}{pct}{'% '}{bar}
																</Text>
															);
														})()}
													</>
												);
											}

											return (
												<>
													{message.thinking && showThinking && (
														<Box
															flexDirection="column"
															marginBottom={message.content ? 1 : 0}
														>
															<Text
																color={theme.colors.menuSecondary}
																dimColor
																italic
															>
																{cleanThinkingContent(message.thinking)}
															</Text>
														</Box>
													)}
													{message.role === 'user' ? (
														<Text
															color="white"
															backgroundColor={
																theme.colors.userMessageBackground
															}
														>
															{formatUserBubbleText(
																getDisplayContent(message.content),
															)}
														</Text>
													) : message.content ? (
														<MarkdownRenderer
															content={getDisplayContent(message.content)}
														/>
													) : null}
												</>
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
								{/* Sub-agent context usage progress bar is rendered inside the
								   subAgentInternal IIFE path above (line ~287). Do NOT duplicate here. */}
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
									{message.messageStatus === 'success' &&
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
											{t.chatScreen.discontinuedMessage}
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
								{t.chatScreen.parallelEnd}
							</Text>
						</Box>
					)}
				</>
			)}
		</Box>
	);
}
