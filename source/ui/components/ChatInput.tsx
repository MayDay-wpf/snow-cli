import React, {useCallback, useEffect, useRef} from 'react';
import {Box, Text} from 'ink';
import {Viewport} from '../../utils/textBuffer.js';
import {cpSlice} from '../../utils/textUtils.js';
import CommandPanel from './CommandPanel.js';
import FileList from './FileList.js';
import {useInputBuffer} from '../../hooks/useInputBuffer.js';
import {useCommandPanel} from '../../hooks/useCommandPanel.js';
import {useFilePicker} from '../../hooks/useFilePicker.js';
import {useHistoryNavigation} from '../../hooks/useHistoryNavigation.js';
import {useClipboard} from '../../hooks/useClipboard.js';
import {useKeyboardInput} from '../../hooks/useKeyboardInput.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import {useTerminalFocus} from '../../hooks/useTerminalFocus.js';

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
		images?: Array<{data: string; mimeType: string}>,
	) => void;
	onCommand?: (commandName: string, result: any) => void;
	placeholder?: string;
	disabled?: boolean;
	isProcessing?: boolean; // Prevent command panel from showing during AI response/tool execution
	chatHistory?: Array<{role: string; content: string}>;
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
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
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
	// Use terminal size hook to listen for resize events
	const {columns: terminalWidth} = useTerminalSize();
	const prevTerminalWidthRef = useRef(terminalWidth);

	// Use terminal focus hook to detect focus state
	const {hasFocus, ensureFocus} = useTerminalFocus();

	// Recalculate viewport dimensions to ensure proper resizing
	const uiOverhead = 8;
	const viewportWidth = Math.max(40, terminalWidth - uiOverhead);
	const viewport: Viewport = {
		width: viewportWidth,
		height: 1,
	};

	// Use input buffer hook
	const {buffer, triggerUpdate, forceUpdate} = useInputBuffer(viewport);

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

	// Use clipboard hook
	const {pasteFromClipboard} = useClipboard(
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
			forceUpdate({});
		}, 10);
		return () => clearTimeout(timer);
	}, [showFilePicker]);

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
			forceUpdate({});
		}, 100);

		return () => clearTimeout(timer);
	}, [terminalWidth]);

	// Notify parent of context percentage changes
	useEffect(() => {
		if (contextUsage && onContextPercentageChange) {
			const percentage = calculateContextPercentage(contextUsage);
			onContextPercentageChange(percentage);
		}
	}, [contextUsage, onContextPercentageChange]);

	// Render cursor based on focus state
	const renderCursor = useCallback(
		(char: string) => {
			if (hasFocus) {
				// Focused: solid block cursor
				return (
					<Text backgroundColor="white" color="black">
						{char}
					</Text>
				);
			} else {
				// Unfocused: no cursor, just render the character normally
				return <Text>{char}</Text>;
			}
		},
		[hasFocus],
	);

	// Render content with cursor (treat all text including placeholders as plain text)
	const renderContent = useCallback(() => {
		if (buffer.text.length > 0) {
			// 使用buffer的内部文本,将占位符当作普通文本处理
			const displayText = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			const charInfo = buffer.getCharAtCursor();
			const atCursor = charInfo.char === '\n' ? ' ' : charInfo.char;

			return (
				<Text>
					{cpSlice(displayText, 0, cursorPos)}
					{renderCursor(atCursor)}
					{cpSlice(displayText, cursorPos + 1)}
				</Text>
			);
		} else {
			return (
				<>
					{renderCursor(' ')}
					<Text color={disabled ? 'darkGray' : 'gray'} dimColor>
						{disabled ? 'Waiting for response...' : placeholder}
					</Text>
				</>
			);
		}
	}, [buffer, disabled, placeholder, renderCursor, buffer.text]);

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
											<Text color="gray" dimColor>
												↑ {startIndex} more above...
											</Text>
										) : (
											<Text> </Text>
										)}
									</Box>

									{/* Message list - each item fixed to 1 line */}
									{visibleMessages.map((message, displayIndex) => {
										const actualIndex = startIndex + displayIndex;

										// Remove all newlines and extra spaces from label to ensure single line
										const singleLineLabel = message.label
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
															? 'green'
															: 'white'
													}
													bold
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
											<Text color="gray" dimColor>
												↓ {userMessages.length - endIndex} more below...
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
						<Text color="cyan" dimColor>
							↑↓ navigate · Enter select · ESC close
						</Text>
					</Box>
				</Box>
			)}
			{!showHistoryMenu && (
				<>
					<Box flexDirection="column" width={terminalWidth - 2}>
						<Text color="gray">{'─'.repeat(terminalWidth - 2)}</Text>
						<Box flexDirection="row">
							<Text color="cyan" bold>
								❯{' '}
							</Text>
							<Box flexGrow={1}>{renderContent()}</Box>
						</Box>
						<Text color="gray">{'─'.repeat(terminalWidth - 2)}</Text>
					</Box>
					<CommandPanel
						commands={getFilteredCommands()}
						selectedIndex={commandSelectedIndex}
						query={buffer.getFullText().slice(1)}
						visible={showCommands}
						isProcessing={commandPanelIsProcessing}
					/>
					<Box>
						<FileList
							ref={fileListRef}
							query={fileQuery}
							selectedIndex={fileSelectedIndex}
							visible={showFilePicker}
							maxItems={10}
							rootPath={process.cwd()}
							onFilteredCountChange={handleFilteredCountChange}
						/>
					</Box>
					{yoloMode && (
						<Box marginTop={1}>
							<Text color="yellow" dimColor>
								❁ YOLO MODE ACTIVE - All tools will be auto-approved without
								confirmation
							</Text>
						</Box>
					)}
					{contextUsage && (
						<Box marginTop={1}>
							<Text color="gray" dimColor>
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
									if (percentage < 50) color = 'green';
									else if (percentage < 75) color = 'yellow';
									else if (percentage < 90) color = 'orange';
									else color = 'red';

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
											<Text> tokens</Text>
											{hasCacheMetrics && (
												<>
													<Text> · </Text>
													{/* Anthropic caching display */}
													{isAnthropic && (
														<>
															{(contextUsage.cacheReadTokens || 0) > 0 && (
																<>
																	<Text color="cyan">
																		↯{' '}
																		{formatNumber(
																			contextUsage.cacheReadTokens || 0,
																		)}{' '}
																		cached
																	</Text>
																</>
															)}
															{(contextUsage.cacheCreationTokens || 0) > 0 && (
																<>
																	{(contextUsage.cacheReadTokens || 0) > 0 && (
																		<Text> · </Text>
																	)}
																	<Text color="magenta">
																		◆{' '}
																		{formatNumber(
																			contextUsage.cacheCreationTokens || 0,
																		)}{' '}
																		new cache
																	</Text>
																</>
															)}
														</>
													)}
													{/* OpenAI caching display */}
													{isOpenAI && (
														<Text color="cyan">
															↯ {formatNumber(contextUsage.cachedTokens || 0)}{' '}
															cached
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
					<Box marginTop={1}>
						<Text>
							{showCommands && getFilteredCommands().length > 0
								? 'Type to filter commands'
								: showFilePicker
								? 'Type to filter files • Tab/Enter to select • ESC to cancel'
								: (() => {
										const pasteKey =
											process.platform === 'darwin' ? 'Ctrl+V' : 'Alt+V';
										return `Ctrl+L: delete to start • Ctrl+R: delete to end • ${pasteKey}: paste images • '@': files • '/': commands`;
								  })()}
						</Text>
					</Box>
				</>
			)}
		</Box>
	);
}
