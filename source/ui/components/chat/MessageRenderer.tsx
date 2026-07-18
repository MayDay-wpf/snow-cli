import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {type Message} from './MessageList.js';
import MarkdownRenderer from '../common/MarkdownRenderer.js';
import DiffViewer from '../tools/DiffViewer.js';
import ToolResultPreview from '../tools/ToolResultPreview.js';
import {getToolResultSummary} from '../tools/ToolResultPreview.js';
import {HookErrorDisplay} from '../special/HookErrorDisplay.js';
import {maskSkillInjectedText} from '../../../utils/ui/skillMask.js';
import {maskGitLineText} from '../../../utils/ui/gitLineMask.js';
import {maskHookInjectedText} from '../../../utils/ui/hookInjectMask.js';
import {toCodePoints, visualWidth} from '../../../utils/core/textUtils.js';
import {getCompressionSummaryDisplay} from '../../../utils/ui/compressionSummaryDisplay.js';
import type {ThinkDisplayMode} from '../../../utils/config/themeConfig.js';
import {getToolStatusIcon} from '../special/toolIcons.js';

/**
 * Clean thinking content by removing XML-like tags
 * Some third-party APIs may include </think> or <thinking></thinking> tags
 */
function cleanThinkingContent(content: string): string {
	return content.replace(/\s*<\/?think(?:ing)?>\s*/gi, '').trim();
}

/**
 * Compact thinking content for display in compact mode.
 * Keeps head + tail of the full text with ellipsis in the middle.
 */
function compactThinkingContent(content: string, maxLength = 200): string {
	const trimmed = content.trim();
	if (trimmed.length <= maxLength) {
		return trimmed;
	}
	const ellipsis = '......';
	const keepLength = maxLength - ellipsis.length;
	const headLength = Math.ceil(keepLength / 2);
	const tailLength = Math.floor(keepLength / 2);
	const head = trimmed.slice(0, headLength).trimEnd();
	const tail = trimmed.slice(-tailLength).trimStart();
	return `${head}${ellipsis}${tail}`;
}

type Props = {
	message: Message;
	terminalWidth: number;
	isFirstInGroup?: boolean;
	isLastInGroup?: boolean;
	showThinking?: boolean;
	toolDisplayMode?: 'full' | 'compact' | 'hidden';
	thinkDisplayMode?: ThinkDisplayMode;
};

function MessageRendererImpl({
	message,
	terminalWidth,
	isFirstInGroup = false,
	isLastInGroup = false,
	showThinking = true,
	toolDisplayMode = 'full',
	thinkDisplayMode = 'compact',
}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();

	// Sub-agent: hide persisted content/thinking messages, only show tools and diffs
	if (message.subAgentContent === true) {
		return null;
	}

	if (message.streamingLine) {
		if (message.isThinkingLine && !showThinking) return null;

		const showIcon =
			message.isFirstStreamLine ||
			(message.isFirstContentLine === true && !showThinking);

		return (
			<Box paddingX={1} width={terminalWidth} marginBottom={0}>
				<Text color="blue" bold>
					{showIcon ? '❆' : ' '}
				</Text>
				<Box marginLeft={1} flexDirection="column">
					{message.isThinkingLine ? (
						<Text color={theme.colors.menuSecondary} dimColor italic>
							{message.content || ' '}
						</Text>
					) : (
						<MarkdownRenderer content={message.content || ' '} />
					)}
				</Box>
			</Box>
		);
	}

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

	// toolDisplayMode 'hidden': completely hide tool call messages
	// (messages with toolStatus that are not streaming lines or user messages)
	if (
		toolDisplayMode === 'hidden' &&
		message.messageStatus !== undefined &&
		(message.role === 'assistant' || message.role === 'subagent') &&
		!message.streaming
	) {
		return null;
	}
	// Helper function to remove ANSI escape codes
	const removeAnsiCodes = (text: string): string => {
		return text.replace(/\x1b\[[0-9;]*m/g, '');
	};

	const getMessageToolName = (titleLine: string): string => {
		const structuredName = message.toolCall?.name;
		if (structuredName) {
			return structuredName;
		}
		if (message.toolDisplay?.toolName) {
			return message.toolDisplay.toolName;
		}

		const statusIcon = message.messageStatus
			? getToolStatusIcon(message.messageStatus)
			: '';
		const withoutStatus =
			statusIcon && titleLine.startsWith(statusIcon)
				? titleLine.slice(statusIcon.length).trimStart()
				: titleLine;

		// 去掉 category icon（如 ⌘ / 单字符符号），保留工具标签
		const parts = withoutStatus.split(/\s+/);
		if (
			parts.length >= 2 &&
			parts[0] &&
			!parts[0].includes('-') &&
			parts[0].length <= 2
		) {
			return parts
				.slice(1)
				.join(' ')
				.replace(/\s*\(\d.*\)$/, '')
				.trim();
		}
		return withoutStatus.replace(/\s*\(\d.*\)$/, '').trim();
	};

	type CommandResultSegment = {
		text: string;
		color?: string;
	};

	const parseAnsiCommandLine = (line: string): CommandResultSegment[] => {
		const segments: CommandResultSegment[] = [];
		const ansiPattern = /\x1b\[([0-9;]*)m/g;
		let cursor = 0;
		let activeColor: string | undefined;
		let match: RegExpExecArray | null;

		const pushText = (text: string): void => {
			const cleanText = removeAnsiCodes(text);
			if (cleanText) {
				segments.push({text: cleanText, color: activeColor});
			}
		};

		while ((match = ansiPattern.exec(line)) !== null) {
			pushText(line.slice(cursor, match.index));
			const codes = (match[1] || '0').split(';');
			if (codes.includes('33') || codes.includes('93')) {
				activeColor = 'yellow';
			} else if (codes.includes('0') || codes.includes('39')) {
				activeColor = undefined;
			}

			cursor = match.index + match[0].length;
		}

		pushText(line.slice(cursor));
		return segments.length > 0 ? segments : [{text: ' '}];
	};

	const getDisplayContent = (content: string): string => {
		// 只做视觉隐藏：保留原始 message.content 用于请求体/持久化。
		// 先折叠 Skill / GitLine，再剥离 onUserMessage hook 注入（snow-mode 等）。
		const afterSkill = maskSkillInjectedText(removeAnsiCodes(content || ''));
		const afterGit = maskGitLineText(afterSkill.displayText).displayText;
		return maskHookInjectedText(afterGit).displayText;
	};

	const wrapTextToVisualWidth = (text: string, maxWidth: number): string[] => {
		const safeWidth = Math.max(maxWidth, 1);
		const normalized = text.length > 0 ? text : ' ';
		const wrappedLines: string[] = [];

		for (const rawLine of normalized.split('\n')) {
			const line = rawLine.length > 0 ? rawLine : ' ';
			let currentLine = '';
			let currentWidth = 0;

			for (const char of toCodePoints(line)) {
				const charWidth = Math.max(visualWidth(char), 1);

				if (currentWidth > 0 && currentWidth + charWidth > safeWidth) {
					wrappedLines.push(currentLine);
					currentLine = char;
					currentWidth = charWidth;
					continue;
				}

				currentLine += char;
				currentWidth += charWidth;
			}

			wrappedLines.push(currentLine || ' ');
		}

		return wrappedLines;
	};

	const formatUserBubbleLines = (
		text: string,
		totalWidth: number,
	): string[] => {
		const safeTotalWidth = Math.max(totalWidth, 2);
		const contentWidth = Math.max(safeTotalWidth - 2, 1);

		return wrapTextToVisualWidth(text, contentWidth).map(line => {
			const trailingSpaces = ' '.repeat(
				Math.max(contentWidth - visualWidth(line), 0),
			);
			return ` ${line}${trailingSpaces} `;
		});
	};

	const formatCommandResultLines = (
		content: string,
	): CommandResultSegment[][] => {
		const afterSkill = maskSkillInjectedText(content || '');
		const displayContent = maskGitLineText(afterSkill.displayText).displayText;
		return displayContent
			.split('\n')
			.map((line, index) =>
				parseAnsiCommandLine(`${index === 0 ? '└─ ' : '   '}${line || ' '}`),
			);
	};

	const formatCompactCount = (value: number): string => {
		if (value >= 1000) {
			return `${(value / 1000).toFixed(1)}K`;
		}

		return String(value);
	};

	const formatCompressionSummaryBubbleLines = (
		content: string,
		totalWidth: number,
	): string[] | null => {
		const summaryDisplay = getCompressionSummaryDisplay(
			getDisplayContent(content),
			{
				maxPreviewWidth: Math.max(totalWidth - 6, 24),
			},
		);
		if (!summaryDisplay) {
			return null;
		}

		const title =
			summaryDisplay.kind === 'auto'
				? t.chatScreen.compressionSummaryAutoTitle
				: t.chatScreen.compressionSummaryManualTitle;
		const stats = t.chatScreen.compressionSummaryStats
			.replace('{lines}', formatCompactCount(summaryDisplay.lineCount))
			.replace('{chars}', formatCompactCount(summaryDisplay.charCount));
		const previewLines =
			summaryDisplay.previewLines.length > 0
				? [
						`${t.chatScreen.compressionSummaryPreviewPrefix}: ${summaryDisplay.previewLines[0]}`,
						...summaryDisplay.previewLines.slice(1).map(line => `  ${line}`),
				  ]
				: [];

		return formatUserBubbleLines(
			[
				title,
				stats,
				...previewLines,
				t.chatScreen.compressionSummaryOriginalSaved,
			].join('\n'),
			totalWidth,
		);
	};

	const formatAiCompletionTime = (value: Date | string): string => {
		const date = value instanceof Date ? value : new Date(value);

		if (Number.isNaN(date.getTime())) {
			return String(value);
		}

		return date.toLocaleTimeString(undefined, {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hour12: false,
		});
	};

	const formatAiCompletionDuration = (ms: number): string => {
		if (!Number.isFinite(ms) || ms < 0) {
			return '';
		}
		const totalSeconds = Math.floor(ms / 1000);
		if (totalSeconds < 60) {
			return `${totalSeconds}s`;
		}
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds % 60;
		if (minutes < 60) {
			return `${minutes}m${seconds.toString().padStart(2, '0')}s`;
		}
		const hours = Math.floor(minutes / 60);
		const remainMinutes = minutes % 60;
		return `${hours}h${remainMinutes.toString().padStart(2, '0')}m`;
	};

	if (message.aiCompletionTime) {
		const completionTime = formatAiCompletionTime(message.aiCompletionTime);
		const durationStr =
			typeof message.aiCompletionDurationMs === 'number' &&
			Number.isFinite(message.aiCompletionDurationMs) &&
			message.aiCompletionDurationMs >= 0
				? formatAiCompletionDuration(message.aiCompletionDurationMs)
				: '';

		const displayText = durationStr
			? t.chatScreen.aiCompletionTimeWithDurationMessage
					.replace('{time}', completionTime)
					.replace('{duration}', durationStr)
			: t.chatScreen.aiCompletionTimeMessage.replace('{time}', completionTime);

		return (
			<Box paddingX={1} width={terminalWidth} marginBottom={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{displayText}
				</Text>
			</Box>
		);
	}

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

	// isFirstInGroup / isLastInGroup are now passed as props from the parent
	// (pre-computed via computeParallelGroupEdges), so we only need to apply
	// the shouldShowParallelIndicator gate here.
	const effectiveIsFirstInGroup = shouldShowParallelIndicator && isFirstInGroup;
	const effectiveIsLastInGroup = shouldShowParallelIndicator && isLastInGroup;

	const leadingIndicator =
		shouldShowParallelIndicator && !effectiveIsFirstInGroup ? '│' : '';
	const messageIcon =
		message.role === 'user'
			? message.subAgentDirected
				? '»'
				: '❯'
			: message.role === 'command'
			? '⌘'
			: '❆';
	const messagePrefix = `${leadingIndicator}${messageIcon}`;
	const contentColumnWidth = Math.max(
		terminalWidth - 2 - visualWidth(messagePrefix) - 1,
		1,
	);
	const userBubbleWidth = Math.max(contentColumnWidth - visualWidth('│ '), 2);

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
			marginTop={message.role === 'user' ? 1 : 0}
			marginBottom={1}
			paddingX={1}
			flexDirection="column"
			width={terminalWidth}
		>
			{message.plainOutput ? (
				<Text
					color={
						message.role === 'user'
							? theme.colors.userMessageText
							: toolStatusColor
					}
				>
					{getDisplayContent(message.content)}
				</Text>
			) : (
				<>
					{/* Show parallel group indicator */}
					{effectiveIsFirstInGroup && (
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
										: theme.colors.userMessageBackground ||
										  theme.colors.menuSelected ||
										  'green'
									: message.role === 'command'
									? theme.colors.menuSecondary
									: toolStatusColor
							}
							bold
						>
							{messagePrefix}
						</Text>
						<Box
							marginLeft={1}
							flexDirection="column"
							width={contentColumnWidth}
						>
							{/* Show target sub-agent tree for directed messages */}
							{message.role === 'user' &&
								message.subAgentDirected &&
								message.subAgentDirected.targets.length > 0 && (
									<Box flexDirection="column">
										{message.subAgentDirected.targets.map((target, ti, arr) => {
											const isLast = ti === arr.length - 1;
											const branch = isLast ? '└─' : '├─';
											return (
												<Box key={ti}>
													<Text color="magenta" dimColor>
														{branch}{' '}
													</Text>
													<Text color="magenta">{target.agentName}</Text>
													{target.promptSnippet ? (
														<Text color="gray" dimColor>
															{' '}
															{target.promptSnippet}
														</Text>
													) : null}
												</Box>
											);
										})}
									</Box>
								)}
							{message.role === 'command' ? (
								<>
									{!message.hideCommandName && (
										<Text color={theme.colors.menuInfo} bold>
											{message.commandName}
										</Text>
									)}
									{message.content && (
										<Box flexDirection="column">
											{formatCommandResultLines(message.content).map(
												(lineSegments, lineIndex) => (
													<Box key={lineIndex}>
														{lineSegments.map((segment, segmentIndex) => (
															<Text
																key={segmentIndex}
																color={
																	segment.color ?? theme.colors.menuSecondary
																}
																dimColor={!segment.color}
															>
																{segment.text}
															</Text>
														))}
													</Box>
												),
											)}
										</Box>
									)}
								</>
							) : (
								<>
									{message.plainOutput ? (
										<Text
											color={
												message.role === 'user'
													? theme.colors.userMessageText
													: toolStatusColor
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
															{/* compact mode: append brief result summary */}
															{toolDisplayMode === 'compact' &&
																message.messageStatus === 'success' &&
																message.toolResult &&
																(() => {
																	const toolName = getMessageToolName(
																		removeAnsiCodes(titleLine),
																	);
																	const summary = getToolResultSummary(
																		toolName,
																		message.toolResult,
																	);
																	return summary ? ` — ${summary}` : null;
																})()}
														</Text>
														{treeLines.length > 0 && (
															<Text color={theme.colors.menuSecondary}>
																{treeLines
																	.map(line => removeAnsiCodes(line || ''))
																	.join('\n')}
															</Text>
														)}
														{showCtxBar &&
															(() => {
																const pct = ctxUsage.percentage;
																const barWidth = 10;
																const filled = Math.round(
																	(pct / 100) * barWidth,
																);
																const empty = barWidth - filled;
																const bar =
																	'\u2588'.repeat(filled) +
																	'\u2591'.repeat(empty);
																const barColor =
																	pct >= 80
																		? 'red'
																		: pct >= 65
																		? 'yellow'
																		: pct >= 50
																		? 'cyan'
																		: 'gray';
																return (
																	<Text color={barColor} dimColor>
																		{'└─ Context: '}
																		{pct}
																		{'% '}
																		{bar}
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
																{thinkDisplayMode === 'compact'
																	? compactThinkingContent(
																			cleanThinkingContent(message.thinking),
																	  )
																	: cleanThinkingContent(message.thinking)}
															</Text>
														</Box>
													)}
													{message.role === 'user' ? (
														<Box width={contentColumnWidth}>
															{(() => {
																const accentColor = message.subAgentDirected
																	? 'magenta'
																	: theme.colors.userMessageBackground ||
																	  theme.colors.menuSelected ||
																	  theme.colors.success ||
																	  'green';
																const lines =
																	formatCompressionSummaryBubbleLines(
																		message.content,
																		userBubbleWidth,
																	) ??
																	formatUserBubbleLines(
																		getDisplayContent(message.content),
																		userBubbleWidth,
																	);

																return (
																	<>
																		<Text color={accentColor}>
																			{lines.map(() => '│').join('\n')}
																		</Text>
																		<Text color={theme.colors.userMessageText}>
																			{` ${lines.join('\n ')}`}
																		</Text>
																	</>
																);
															})()}
														</Box>
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
										!message.subAgentInternal &&
										// Hide tool arguments in compact mode
										toolDisplayMode === 'full' && (
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
										!message.toolCall.arguments.isBatch &&
										message.toolCall.arguments.content &&
										message.messageStatus === 'pending' && (
											<Box marginTop={1}>
												<DiffViewer
													newContent={message.toolCall.arguments.content}
													filename={message.toolCall.arguments.path}
												/>
											</Box>
										)}
									{message.toolCall &&
										(message.toolCall.name === 'filesystem-edit' ||
											message.toolCall.name === 'filesystem-replaceedit') &&
										typeof message.toolCall.arguments.oldContent === 'string' &&
										typeof message.toolCall.arguments.newContent === 'string' &&
										message.messageStatus === 'pending' && (
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
									{/* Show batch edit results (pending only — success uses tool result) */}
									{message.toolCall &&
										(message.toolCall.name === 'filesystem-edit' ||
											message.toolCall.name === 'filesystem-replaceedit') &&
										message.toolCall.arguments.isBatch &&
										message.toolCall.arguments.batchResults &&
										Array.isArray(message.toolCall.arguments.batchResults) &&
										message.messageStatus === 'pending' && (
											<Box marginTop={1} flexDirection="column">
												{message.toolCall.arguments.batchResults.map(
													(fileResult: any, index: number) => {
														if (
															fileResult.success &&
															typeof fileResult.oldContent === 'string' &&
															typeof fileResult.newContent === 'string'
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
																		showFilenameInHeader={false}
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
									{/* Show batch create results (pending only — success uses tool result) */}
									{message.toolCall &&
										message.toolCall.name === 'filesystem-create' &&
										message.toolCall.arguments.isBatch &&
										message.toolCall.arguments.batchResults &&
										Array.isArray(message.toolCall.arguments.batchResults) &&
										message.messageStatus === 'pending' && (
											<Box marginTop={1} flexDirection="column">
												{message.toolCall.arguments.batchResults.map(
													(fileResult: any, index: number) => {
														if (fileResult.success && fileResult.content) {
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
																		newContent={fileResult.content}
																		filename={fileResult.path}
																		showFilenameInHeader={false}
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
												message.toolCall.arguments?.content ||
												message.toolCall.arguments?.batchResults)
										) &&
										// Hide result preview in compact mode
										toolDisplayMode === 'full' && (
											<ToolResultPreview
												toolName={getMessageToolName(
													removeAnsiCodes(
														(message.content || '').split('\n')[0] || '',
													),
												)}
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
					{!message.plainOutput && effectiveIsLastInGroup && (
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

/**
 * Custom memo comparator for MessageRenderer.
 * Skips re-render when message reference is unchanged and no display-affecting props changed.
 */
function areMessageRendererPropsEqual(prev: Props, next: Props): boolean {
	if (prev.message !== next.message) return false;
	if (prev.terminalWidth !== next.terminalWidth) return false;
	if (prev.showThinking !== next.showThinking) return false;
	if (prev.toolDisplayMode !== next.toolDisplayMode) return false;
	if (prev.thinkDisplayMode !== next.thinkDisplayMode) return false;
	if (prev.isFirstInGroup !== next.isFirstInGroup) return false;
	if (prev.isLastInGroup !== next.isLastInGroup) return false;
	return true;
}

const MessageRenderer = memo(MessageRendererImpl, areMessageRendererPropsEqual);
MessageRenderer.displayName = 'MessageRenderer';
export default MessageRenderer;

/**
 * Pre-compute parallel group edges for a list of messages.
 * Returns isFirstInGroup[] and isLastInGroup[] arrays to pass as props.
 */
export function computeParallelGroupEdges(messages: Message[]): {
	isFirstInGroup: boolean[];
	isLastInGroup: boolean[];
} {
	const len = messages.length;
	const isFirstInGroup = new Array<boolean>(len).fill(false);
	const isLastInGroup = new Array<boolean>(len).fill(false);

	for (let i = 0; i < len; i++) {
		const msg = messages[i]!;
		const isInParallelGroup =
			msg.parallelGroup !== undefined && msg.parallelGroup !== null;
		const isTimeConsumingTool =
			msg.toolPending || msg.messageStatus === 'pending';
		const shouldShowParallelIndicator =
			isInParallelGroup && !isTimeConsumingTool;

		if (!shouldShowParallelIndicator) continue;

		const prev = i > 0 ? messages[i - 1] : undefined;
		isFirstInGroup[i] =
			!prev ||
			prev.parallelGroup !== msg.parallelGroup ||
			prev.toolPending ||
			prev.messageStatus === 'pending';

		const next = i < len - 1 ? messages[i + 1] : undefined;
		const nextInSameGroup =
			next &&
			next.parallelGroup !== undefined &&
			next.parallelGroup !== null &&
			next.parallelGroup === msg.parallelGroup;
		isLastInGroup[i] = !nextInSameGroup;
	}

	return {isFirstInGroup, isLastInGroup};
}
