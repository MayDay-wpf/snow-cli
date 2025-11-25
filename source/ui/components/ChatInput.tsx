import React, { useCallback, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Box, Text } from 'ink';
import { Viewport } from '../../utils/ui/textBuffer.js';
import { cpSlice } from '../../utils/core/textUtils.js';

// Lazy load panel components to reduce initial bundle size
const CommandPanel = lazy(() => import('./CommandPanel.js'));
const FileList = lazy(() => import('./FileList.js'));
const AgentPickerPanel = lazy(() => import('./AgentPickerPanel.js'));
const TodoPickerPanel = lazy(() => import('./TodoPickerPanel.js'));
import { useInputBuffer } from '../../hooks/input/useInputBuffer.js';
import { useCommandPanel } from '../../hooks/ui/useCommandPanel.js';
import { useFilePicker } from '../../hooks/picker/useFilePicker.js';
import { useHistoryNavigation } from '../../hooks/input/useHistoryNavigation.js';
import { useClipboard } from '../../hooks/input/useClipboard.js';
import { useKeyboardInput } from '../../hooks/input/useKeyboardInput.js';
import { useTerminalSize } from '../../hooks/ui/useTerminalSize.js';
import { useTerminalFocus } from '../../hooks/ui/useTerminalFocus.js';
import { useAgentPicker } from '../../hooks/picker/useAgentPicker.js';
import { useTodoPicker } from '../../hooks/picker/useTodoPicker.js';
import { useI18n } from '../../i18n/index.js';
import { useTheme } from '../contexts/ThemeContext.js';

/**
 * Calculate context usage percentage
 * This is the same logic used in ChatInput to display usage
 */
export function calculateContextPercentage(contextUsage: {
	inputTokens: number;
	maxContextTokens: number;
	cacheCreationTokens?: number;
	cacheReadTokens?: number;
	cachedTokens?: number;
}): number {
	// Determine which caching system is being used
	const isAnthropic =
		(contextUsage.cacheCreationTokens || 0) > 0 ||
		(contextUsage.cacheReadTokens || 0) > 0;

	// For Anthropic: Total = inputTokens + cacheCreationTokens + cacheReadTokens
	// For OpenAI: Total = inputTokens (cachedTokens are already included in inputTokens)
	const totalInputTokens = isAnthropic
		? contextUsage.inputTokens +
		(contextUsage.cacheCreationTokens || 0) +
		(contextUsage.cacheReadTokens || 0)
		: contextUsage.inputTokens;

	return Math.min(
		100,
		(totalInputTokens / contextUsage.maxContextTokens) * 100,
	);
}

type Props = {
	onSubmit: (
		message: string,
		images?: Array<{ data: string; mimeType: string }>,
	) => void;
	onCommand?: (commandName: string, result: any) => void;
	placeholder?: string;
	disabled?: boolean;
	isProcessing?: boolean; // Prevent command panel from showing during AI response/tool execution
	chatHistory?: Array<{ role: string; content: string }>;
	onHistorySelect?: (selectedIndex: number, message: string) => void;
	yoloMode?: boolean;
	contextUsage?: {
		inputTokens: number;
		maxContextTokens: number;
		// Anthropic caching
		cacheCreationTokens?: number;
		cacheReadTokens?: number;
		// OpenAI caching
		cachedTokens?: number;
	};
	initialContent?: {
		text: string;
		images?: Array<{ type: 'image'; data: string; mimeType: string }>;
	} | null;
	onContextPercentageChange?: (percentage: number) => void; // Callback to notify parent of percentage changes
};

export default function ChatInput({
	onSubmit,
	onCommand,
	placeholder = 'Type your message...',
	disabled = false,
	isProcessing = false,
	chatHistory = [],
	onHistorySelect,
	yoloMode = false,
	contextUsage,
	initialContent = null,
	onContextPercentageChange,
}: Props) {
	// Use i18n hook for translations
	const { t } = useI18n();
	const { theme } = useTheme();

	// Use terminal size hook to listen for resize events
	const { columns: terminalWidth } = useTerminalSize();
	const prevTerminalWidthRef = useRef(terminalWidth);

	// Use terminal focus hook to detect focus state
	const { hasFocus, ensureFocus } = useTerminalFocus();

	// Recalculate viewport dimensions to ensure proper resizing
	const uiOverhead = 8;
	const viewportWidth = Math.max(40, terminalWidth - uiOverhead);
	const viewport: Viewport = useMemo(
		() => ({
			width: viewportWidth,
			height: 1,
		}),
		[viewportWidth],
	); // Memoize viewport to prevent unnecessary re-renders

	// Use input buffer hook
	const { buffer, triggerUpdate, forceUpdate } = useInputBuffer(viewport);

	// Use command panel hook
	const {
		showCommands,
		setShowCommands,
		commandSelectedIndex,
		setCommandSelectedIndex,
		getFilteredCommands,
		updateCommandPanelState,
		isProcessing: commandPanelIsProcessing,
	} = useCommandPanel(buffer, isProcessing);

	// Use file picker hook
	const {
		showFilePicker,
		setShowFilePicker,
		fileSelectedIndex,
		setFileSelectedIndex,
		fileQuery,
		setFileQuery,
		atSymbolPosition,
		setAtSymbolPosition,
		filteredFileCount,
		searchMode,
		updateFilePickerState,
		handleFileSelect,
		handleFilteredCountChange,
		fileListRef,
	} = useFilePicker(buffer, triggerUpdate);

	// Use history navigation hook
	const {
		showHistoryMenu,
		setShowHistoryMenu,
		historySelectedIndex,
		setHistorySelectedIndex,
		escapeKeyCount,
		setEscapeKeyCount,
		escapeKeyTimer,
		getUserMessages,
		handleHistorySelect,
		currentHistoryIndex,
		navigateHistoryUp,
		navigateHistoryDown,
		resetHistoryNavigation,
		saveToHistory,
	} = useHistoryNavigation(buffer, triggerUpdate, chatHistory, onHistorySelect);

	// Use agent picker hook
	const {
		showAgentPicker,
		setShowAgentPicker,
		agentSelectedIndex,
		setAgentSelectedIndex,
		updateAgentPickerState,
		getFilteredAgents,
		handleAgentSelect,
	} = useAgentPicker(buffer, triggerUpdate);

	// Use todo picker hook
	const {
		showTodoPicker,
		setShowTodoPicker,
		todoSelectedIndex,
		setTodoSelectedIndex,
		todos,
		selectedTodos,
		toggleTodoSelection,
		confirmTodoSelection,
		isLoading: todoIsLoading,
		searchQuery: todoSearchQuery,
		setSearchQuery: setTodoSearchQuery,
		totalTodoCount,
	} = useTodoPicker(buffer, triggerUpdate, process.cwd());

	// Use clipboard hook
	const { pasteFromClipboard } = useClipboard(
		buffer,
		updateCommandPanelState,
		updateFilePickerState,
		triggerUpdate,
	);

	// Use keyboard input hook
	useKeyboardInput({
		buffer,
		disabled,
		triggerUpdate,
		forceUpdate,
		showCommands,
		setShowCommands,
		commandSelectedIndex,
		setCommandSelectedIndex,
		getFilteredCommands,
		updateCommandPanelState,
		onCommand,
		showFilePicker,
		setShowFilePicker,
		fileSelectedIndex,
		setFileSelectedIndex,
		fileQuery,
		setFileQuery,
		atSymbolPosition,
		setAtSymbolPosition,
		filteredFileCount,
		updateFilePickerState,
		handleFileSelect,
		fileListRef,
		showHistoryMenu,
		setShowHistoryMenu,
		historySelectedIndex,
		setHistorySelectedIndex,
		escapeKeyCount,
		setEscapeKeyCount,
		escapeKeyTimer,
		getUserMessages,
		handleHistorySelect,
		currentHistoryIndex,
		navigateHistoryUp,
		navigateHistoryDown,
		resetHistoryNavigation,
		saveToHistory,
		pasteFromClipboard,
		onSubmit,
		ensureFocus,
		showAgentPicker,
		setShowAgentPicker,
		agentSelectedIndex,
		setAgentSelectedIndex,
		updateAgentPickerState,
		getFilteredAgents,
		handleAgentSelect,
		showTodoPicker,
		setShowTodoPicker,
		todoSelectedIndex,
		setTodoSelectedIndex,
		todos,
		selectedTodos,
		toggleTodoSelection,
		confirmTodoSelection,
		todoSearchQuery,
		setTodoSearchQuery,
	});

	// Set initial content when provided (e.g., when rolling back to first message)
	useEffect(() => {
		if (initialContent) {
			// Always do full restore to avoid duplicate placeholders
			buffer.setText('');

			const text = initialContent.text;
			const images = initialContent.images || [];

			if (images.length === 0) {
				// No images, just set the text
				if (text) {
					buffer.insert(text);
				}
			} else {
				// Split text by image placeholders and reconstruct with actual images
				// Placeholder format: [image #N]
				const imagePlaceholderPattern = /\[image #\d+\]/g;
				const parts = text.split(imagePlaceholderPattern);

				// Interleave text parts with images
				for (let i = 0; i < parts.length; i++) {
					// Insert text part
					const part = parts[i];
					if (part) {
						buffer.insert(part);
					}

					// Insert image after this text part (if exists)
					if (i < images.length) {
						const img = images[i];
						if (img) {
							// Extract base64 data from data URL if present
							let base64Data = img.data;
							if (base64Data.startsWith('data:')) {
								const base64Index = base64Data.indexOf('base64,');
								if (base64Index !== -1) {
									base64Data = base64Data.substring(base64Index + 7);
								}
							}
							buffer.insertImage(base64Data, img.mimeType);
						}
					}
				}
			}

			triggerUpdate();
		}
		// Only run when initialContent changes
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [initialContent]);

	// Force full re-render when file picker visibility changes to prevent artifacts
	useEffect(() => {
		// Use a small delay to ensure the component tree has updated
		const timer = setTimeout(() => {
			forceUpdate();
		}, 10);
		return () => clearTimeout(timer);
	}, [showFilePicker, forceUpdate]);

	// Handle terminal width changes with debounce (like gemini-cli)
	useEffect(() => {
		// Skip on initial mount
		if (prevTerminalWidthRef.current === terminalWidth) {
			prevTerminalWidthRef.current = terminalWidth;
			return;
		}

		prevTerminalWidthRef.current = terminalWidth;

		// Debounce the re-render to avoid flickering during resize
		const timer = setTimeout(() => {
			forceUpdate();
		}, 100);

		return () => clearTimeout(timer);
	}, [terminalWidth, forceUpdate]);

	// Notify parent of context percentage changes
	const lastPercentageRef = useRef<number>(0);
	useEffect(() => {
		if (contextUsage && onContextPercentageChange) {
			const percentage = calculateContextPercentage(contextUsage);
			// Only call callback if percentage has actually changed
			if (percentage !== lastPercentageRef.current) {
				lastPercentageRef.current = percentage;
				onContextPercentageChange(percentage);
			}
		}
	}, [contextUsage, onContextPercentageChange]);

	// Render cursor based on focus state
	const renderCursor = useCallback(
		(char: string) => {
			if (hasFocus) {
				// Focused: solid block cursor (use inverted colors)
				return (
					<Text backgroundColor={theme.colors.menuNormal} color={theme.colors.background}>
						{char}
					</Text>
				);
			} else {
				// Unfocused: no cursor, just render the character normally
				return <Text>{char}</Text>;
			}
		},
		[hasFocus, theme],
	);

	// Render content with cursor (treat all text including placeholders as plain text)
	const renderContent = () => {
		if (buffer.text.length > 0) {
			// Use visual lines for proper wrapping and multi-line support
			const visualLines = buffer.viewportVisualLines;
			const [cursorRow, cursorCol] = buffer.visualCursor;
			const renderedLines: React.ReactNode[] = [];

			for (let i = 0; i < visualLines.length; i++) {
				const line = visualLines[i] || '';

				if (i === cursorRow) {
					// This line contains the cursor
					const beforeCursor = cpSlice(line, 0, cursorCol);
					const atCursor = cpSlice(line, cursorCol, cursorCol + 1) || ' ';
					const afterCursor = cpSlice(line, cursorCol + 1);

					renderedLines.push(
						<Box key={i} flexDirection="row">
							<Text>{beforeCursor}</Text>
							{renderCursor(atCursor)}
							<Text>{afterCursor}</Text>
						</Box>,
					);
				} else {
					// No cursor in this line
					renderedLines.push(<Text key={i}>{line || ' '}</Text>);
				}
			}

			return <Box flexDirection="column">{renderedLines}</Box>;
		} else {
			return (
				<>
					{renderCursor(' ')}
					<Text color={theme.colors.menuSecondary} dimColor>
						{disabled ? t.chatScreen.waitingForResponse : placeholder}
					</Text>
				</>
			);
		}
	};

	return (
		<Box flexDirection="column" paddingX={1} width={terminalWidth}>
			{showHistoryMenu && (
				<Box flexDirection="column" marginBottom={1} width={terminalWidth - 2}>
					<Box flexDirection="column">
						{(() => {
							const userMessages = getUserMessages();
							const maxVisibleItems = 5; // Number of message items to show (reduced for small terminals)

							// Calculate scroll window to keep selected index visible
							let startIndex = 0;
							if (userMessages.length > maxVisibleItems) {
								// Keep selected item in the middle of the view when possible
								startIndex = Math.max(
									0,
									historySelectedIndex - Math.floor(maxVisibleItems / 2),
								);
								// Adjust if we're near the end
								startIndex = Math.min(
									startIndex,
									userMessages.length - maxVisibleItems,
								);
							}

							const endIndex = Math.min(
								userMessages.length,
								startIndex + maxVisibleItems,
							);
							const visibleMessages = userMessages.slice(startIndex, endIndex);

							const hasMoreAbove = startIndex > 0;
							const hasMoreBelow = endIndex < userMessages.length;

							return (
								<>
									{/* Top scroll indicator - always reserve space */}
									<Box height={1}>
										{hasMoreAbove ? (
											<Text color={theme.colors.menuSecondary} dimColor>
												{t.chatScreen.moreAbove.replace(
													'{count}',
													startIndex.toString(),
												)}
											</Text>
										) : (
											<Text> </Text>
										)}
									</Box>

									{/* Message list - each item fixed to 1 line */}
									{visibleMessages.map((message, displayIndex) => {
										const actualIndex = startIndex + displayIndex;

										// Ensure single line by removing all newlines and control characters
										const singleLineLabel = message.label
											.replace(/[\r\n\t\v\f\u0000-\u001F\u007F-\u009F]+/g, ' ')
											.replace(/\s+/g, ' ')
											.trim();
										// Calculate available width for the message
										const prefixWidth = 3; // "❯  " or "  "
										const maxLabelWidth = terminalWidth - 4 - prefixWidth;
										const truncatedLabel =
											singleLineLabel.length > maxLabelWidth
												? singleLineLabel.slice(0, maxLabelWidth - 3) + '...'
												: singleLineLabel;

										return (
											<Box key={message.value} height={1}>
												<Text
													color={
														actualIndex === historySelectedIndex
															? theme.colors.menuSelected
															: theme.colors.menuNormal
													}
													bold
													wrap="truncate"
												>
													{actualIndex === historySelectedIndex ? '❯  ' : '  '}
													{truncatedLabel}
												</Text>
											</Box>
										);
									})}

									{/* Bottom scroll indicator - always reserve space */}
									<Box height={1}>
										{hasMoreBelow ? (
											<Text color={theme.colors.menuSecondary} dimColor>
												{t.chatScreen.moreBelow.replace(
													'{count}',
													(userMessages.length - endIndex).toString(),
												)}
											</Text>
										) : (
											<Text> </Text>
										)}
									</Box>
								</>
							);
						})()}
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.menuInfo} dimColor>
							{t.chatScreen.historyNavigateHint}
						</Text>
					</Box>
				</Box>
			)}
			{!showHistoryMenu && (
				<>
					<Box flexDirection="column" width={terminalWidth - 2}>
						<Text color={theme.colors.menuSecondary}>{'─'.repeat(terminalWidth - 2)}</Text>
						<Box flexDirection="row">
							<Text color={theme.colors.menuInfo} bold>
								❯{' '}
							</Text>
							<Box flexGrow={1}>{renderContent()}</Box>
						</Box>
						<Text color={theme.colors.menuSecondary}>{'─'.repeat(terminalWidth - 2)}</Text>
					</Box>
					{(showCommands && getFilteredCommands().length > 0) ||
						showFilePicker ? (
						<Box marginTop={1}>
							<Text>
								{showCommands && getFilteredCommands().length > 0
									? t.chatScreen.typeToFilterCommands
									: showFilePicker
										? searchMode === 'content'
											? t.chatScreen.contentSearchHint
											: t.chatScreen.fileSearchHint
										: ''}
							</Text>
						</Box>
					) : null}
					<Suspense fallback={null}>
						<CommandPanel
							commands={getFilteredCommands()}
							selectedIndex={commandSelectedIndex}
							query={buffer.getFullText().slice(1)}
							visible={showCommands}
							isProcessing={commandPanelIsProcessing}
						/>
					</Suspense>
					<Box>
						<Suspense fallback={null}>
							<FileList
								ref={fileListRef}
								query={fileQuery}
								selectedIndex={fileSelectedIndex}
								visible={showFilePicker}
								maxItems={10}
								rootPath={process.cwd()}
								onFilteredCountChange={handleFilteredCountChange}
								searchMode={searchMode}
							/>
						</Suspense>
					</Box>
					<Suspense fallback={null}>
						<AgentPickerPanel
							agents={getFilteredAgents()}
							selectedIndex={agentSelectedIndex}
							visible={showAgentPicker}
							maxHeight={5}
						/>
					</Suspense>
					<Suspense fallback={null}>
						<TodoPickerPanel
							todos={todos}
							selectedIndex={todoSelectedIndex}
							selectedTodos={selectedTodos}
							visible={showTodoPicker}
							maxHeight={5}
							isLoading={todoIsLoading}
							searchQuery={todoSearchQuery}
							totalCount={totalTodoCount}
						/>
					</Suspense>
					{yoloMode && (
						<Box marginTop={1}>
							<Text color={theme.colors.warning} dimColor>
								{t.chatScreen.yoloModeActive}
							</Text>
						</Box>
					)}
					{contextUsage && (
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{(() => {
									// Determine which caching system is being used
									const isAnthropic =
										(contextUsage.cacheCreationTokens || 0) > 0 ||
										(contextUsage.cacheReadTokens || 0) > 0;
									const isOpenAI = (contextUsage.cachedTokens || 0) > 0;

									// Use the exported function for consistent calculation
									const percentage = calculateContextPercentage(contextUsage);

									// Calculate total tokens for display
									const totalInputTokens = isAnthropic
										? contextUsage.inputTokens +
										(contextUsage.cacheCreationTokens || 0) +
										(contextUsage.cacheReadTokens || 0)
										: contextUsage.inputTokens;
									let color: string;
									if (percentage < 50) color = theme.colors.success;
									else if (percentage < 75) color = theme.colors.warning;
									else if (percentage < 90) color = theme.colors.warning;
									else color = theme.colors.error;

									const formatNumber = (num: number) => {
										if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
										return num.toString();
									};

									const hasCacheMetrics = isAnthropic || isOpenAI;

									return (
										<>
											<Text color={color}>{percentage.toFixed(1)}%</Text>
											<Text> · </Text>
											<Text color={color}>
												{formatNumber(totalInputTokens)}
											</Text>
											<Text>{t.chatScreen.tokens}</Text>
											{hasCacheMetrics && (
												<>
													<Text> · </Text>
													{/* Anthropic caching display */}
													{isAnthropic && (
														<>
															{(contextUsage.cacheReadTokens || 0) > 0 && (
																<>
																	<Text color={theme.colors.menuInfo}>
																		↯{' '}
																		{formatNumber(
																			contextUsage.cacheReadTokens || 0,
																		)}{' '}
																		{t.chatScreen.cached}
																	</Text>
																</>
															)}
															{(contextUsage.cacheCreationTokens || 0) > 0 && (
																<>
																	{(contextUsage.cacheReadTokens || 0) > 0 && (
																		<Text> · </Text>
																	)}
																	<Text color={theme.colors.warning}>
																		◆{' '}
																		{formatNumber(
																			contextUsage.cacheCreationTokens || 0,
																		)}{' '}
																		{t.chatScreen.newCache}
																	</Text>
																</>
															)}
														</>
													)}
													{/* OpenAI caching display */}
													{isOpenAI && (
														<Text color={theme.colors.menuInfo}>
															↯ {formatNumber(contextUsage.cachedTokens || 0)}{' '}
															{t.chatScreen.cached}
														</Text>
													)}
												</>
											)}
										</>
									);
								})()}
							</Text>
						</Box>
					)}
				</>
			)}
		</Box>
	);
}
