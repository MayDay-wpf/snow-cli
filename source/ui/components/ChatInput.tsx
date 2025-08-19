import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import { TextBuffer, Viewport } from '../../utils/textBuffer.js';
import { cpSlice } from '../../utils/textUtils.js';
import CommandPanel from './CommandPanel.js';
import { executeCommand } from '../../utils/commandExecutor.js';
import Menu from './Menu.js';

type Props = {
	onSubmit: (message: string) => void;
	onCommand?: (commandName: string, result: any) => void;
	placeholder?: string;
	disabled?: boolean;
	chatHistory?: Array<{role: string, content: string}>;
	onHistorySelect?: (selectedIndex: number, message: string) => void;
};

// Command Definition
const commands = [
	{ name: 'clear', description: 'Clear chat context and conversation history' },
	{ name: 'agents', description: 'Manage agent configurations' }
];

export default function ChatInput({ onSubmit, onCommand, placeholder = 'Type your message...', disabled = false, chatHistory = [], onHistorySelect }: Props) {
	const { stdout } = useStdout();
	const terminalWidth = stdout?.columns || 80;
	
	const uiOverhead = 8;
	const viewport: Viewport = { 
		width: Math.max(40, terminalWidth - uiOverhead),
		height: 1 
	};
	const [buffer] = useState(() => new TextBuffer(viewport));
	const [, forceUpdate] = useState({});
	const lastUpdateTime = useRef<number>(0);
	
	// Command panel state
	const [showCommands, setShowCommands] = useState(false);
	const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
	
	// History navigation state
	const [showHistoryMenu, setShowHistoryMenu] = useState(false);
	const [escapeKeyCount, setEscapeKeyCount] = useState(0);
	const escapeKeyTimer = useRef<NodeJS.Timeout | null>(null);
	
	// Get user messages from chat history for navigation
	const getUserMessages = useCallback(() => {
		const userMessages = chatHistory
			.map((msg, index) => ({ ...msg, originalIndex: index }))
			.filter(msg => msg.role === 'user' && msg.content.trim());
		
		// Keep original order (oldest first, newest last) and map with display numbers
		return userMessages
			.map((msg, index) => ({
				label: `${index + 1}. ${msg.content.slice(0, 50)}${msg.content.length > 50 ? '...' : ''}`,
				value: msg.originalIndex.toString(),
				infoText: msg.content
			}));
	}, [chatHistory]);
	
	// Get filtered commands based on current input
	const getFilteredCommands = useCallback(() => {
		const text = buffer.getFullText();
		if (!text.startsWith('/')) return [];
		
		const query = text.slice(1).toLowerCase();
		return commands.filter(command => 
			command.name.toLowerCase().includes(query) || 
			command.description.toLowerCase().includes(query)
		);
	}, [buffer]);

	// Update command panel state
	const updateCommandPanelState = useCallback((text: string) => {
		if (text.startsWith('/') && text.length > 0) {
			setShowCommands(true);
			setCommandSelectedIndex(0);
		} else {
			setShowCommands(false);
			setCommandSelectedIndex(0);
		}
	}, []);

	// Force re-render when buffer changes
	const triggerUpdate = useCallback(() => {
		const now = Date.now();
		// Avoid too frequent updates
		if (now - lastUpdateTime.current > 16) { // ~60fps limit
			lastUpdateTime.current = now;
			forceUpdate({});
		}
	}, []);

	// Update buffer viewport when terminal width changes
	useEffect(() => {
		const newViewport: Viewport = {
			width: Math.max(40, terminalWidth - uiOverhead),
			height: 1
		};
		buffer.updateViewport(newViewport);
		triggerUpdate();
	}, [terminalWidth, buffer, triggerUpdate]);

	// Handle input using useInput hook instead of raw stdin
	useInput((input, key) => {
		if (disabled) return;
		
		// Handle escape key for double-ESC history navigation
		if (key.escape) {
			// Don't interfere with existing ESC behavior if in command panel
			if (showCommands) {
				setShowCommands(false);
				setCommandSelectedIndex(0);
				return;
			}
			
			// Handle history navigation
			if (showHistoryMenu) {
				setShowHistoryMenu(false);
				return;
			}
			
			// Count escape key presses for double-ESC detection
			setEscapeKeyCount(prev => prev + 1);
			
			// Clear any existing timer
			if (escapeKeyTimer.current) {
				clearTimeout(escapeKeyTimer.current);
			}
			
			// Set timer to reset count after 500ms
			escapeKeyTimer.current = setTimeout(() => {
				setEscapeKeyCount(0);
			}, 500);
			
			// Check for double escape
			if (escapeKeyCount >= 1) { // This will be 2 after increment
				const userMessages = getUserMessages();
				if (userMessages.length > 0) {
					setShowHistoryMenu(true);
					setEscapeKeyCount(0);
					if (escapeKeyTimer.current) {
						clearTimeout(escapeKeyTimer.current);
						escapeKeyTimer.current = null;
					}
				}
			}
			return;
		}
		
		// Handle history menu navigation
		if (showHistoryMenu) {
			// History navigation is handled by the Menu component itself
			return;
		}
		
		// Backspace
		if (key.backspace || key.delete) {
			buffer.backspace();
			const text = buffer.getFullText();
			updateCommandPanelState(text);
			triggerUpdate();
			return;
		}

		// Handle command panel navigation
		if (showCommands) {
			const filteredCommands = getFilteredCommands();
			
			// Up arrow in command panel
			if (key.upArrow) {
				setCommandSelectedIndex(prev => Math.max(0, prev - 1));
				return;
			}
			
			// Down arrow in command panel
			if (key.downArrow) {
				const maxIndex = Math.max(0, filteredCommands.length - 1);
				setCommandSelectedIndex(prev => Math.min(maxIndex, prev + 1));
				return;
			}
			
			// Enter - select command
			if (key.return) {
				if (filteredCommands.length > 0 && commandSelectedIndex < filteredCommands.length) {
					const selectedCommand = filteredCommands[commandSelectedIndex];
					if (selectedCommand) {
						// Execute command instead of inserting text
						executeCommand(selectedCommand.name).then(result => {
							if (onCommand) {
								onCommand(selectedCommand.name, result);
							}
						});
						buffer.setText('');
						setShowCommands(false);
						setCommandSelectedIndex(0);
						triggerUpdate();
						return;
					}
				}
				// If no commands available, fall through to normal Enter handling
			}
		}

		// Enter - submit message
		if (key.return) {
			const message = buffer.getFullText().trim();
			if (message) {
				buffer.setText('');
				forceUpdate({});
				onSubmit(message);
			}
			return;
		}

		// Arrow keys for cursor movement
		if (key.leftArrow) {
			buffer.moveLeft();
			triggerUpdate();
			return;
		}
		
		if (key.rightArrow) {
			buffer.moveRight();
			triggerUpdate();
			return;
		}
		
		if (key.upArrow && !showCommands) {
			buffer.moveUp();
			triggerUpdate();
			return;
		}
		
		if (key.downArrow && !showCommands) {
			buffer.moveDown();
			triggerUpdate();
			return;
		}

		// Regular character input
		if (input && !key.ctrl && !key.meta && !key.escape) {
			buffer.insert(input);
			const text = buffer.getFullText();
			updateCommandPanelState(text);
			triggerUpdate();
		}
	});

	// Handle paste events - useInput should handle paste automatically
	// but we may need to handle large pastes specially
	useEffect(() => {
		const handlePaste = (event: ClipboardEvent) => {
			if (event.clipboardData) {
				const pastedText = event.clipboardData.getData('text');
				if (pastedText && pastedText.length > 0) {
					// Let TextBuffer handle the paste processing
					buffer.insert(pastedText);
					const text = buffer.getFullText();
					updateCommandPanelState(text);
					triggerUpdate();
				}
			}
		};

		// Note: This might not work in all terminal environments
		// but the useInput hook should handle most paste scenarios
		if (typeof window !== 'undefined') {
			window.addEventListener('paste', handlePaste);
			return () => window.removeEventListener('paste', handlePaste);
		}
		
		return undefined;
	}, [buffer, updateCommandPanelState, triggerUpdate]);

	// Handle history selection
	const handleHistorySelect = useCallback((value: string) => {
		const selectedIndex = parseInt(value, 10);
		const selectedMessage = chatHistory[selectedIndex];
		if (selectedMessage && onHistorySelect) {
			// Put the message content in the input buffer
			buffer.setText(selectedMessage.content);
			setShowHistoryMenu(false);
			triggerUpdate();
			onHistorySelect(selectedIndex, selectedMessage.content);
		}
	}, [chatHistory, onHistorySelect, buffer, triggerUpdate]);

	const visualLines = buffer.viewportVisualLines;
	const [cursorRow, cursorCol] = buffer.visualCursor;

	// Render content with cursor and paste placeholders
	const renderContent = useCallback(() => {
		if (buffer.text.length > 0) {
			return visualLines.map((line, index) => (
				<Box key={`line-${index}`}>
					<Text>
						{index === cursorRow ? (
							<>
								{cpSlice(line, 0, cursorCol)}
								<Text backgroundColor="white" color="black">
									{(() => {
										const charInfo = buffer.getCharAtCursor();
										return charInfo.char === '\n' ? ' ' : charInfo.char;
									})()}
								</Text>
								{cpSlice(line, cursorCol + 1)}
							</>
						) : (
							// Check for paste placeholders and highlight them
							line.includes('[Paste ') && line.includes(' line #') ? (
								<Text>
									{line.split(/(\[Paste \d+ line #\d+\])/).map((part, partIndex) => 
										part.match(/^\[Paste \d+ line #\d+\]$/) ? (
											<Text key={partIndex} color="cyan" dimColor>
												{part}
											</Text>
										) : (
											<Text key={partIndex}>{part}</Text>
										)
									)}
								</Text>
							) : (
								line || ' '
							)
						)}
					</Text>
				</Box>
			));
		} else {
			return (
				<Box>
					<Text backgroundColor={disabled ? "gray" : "white"} color={disabled ? "darkGray" : "black"}>
						{' '}
					</Text>
					<Text color={disabled ? "darkGray" : "gray"} dimColor>
						{disabled ? 'Waiting for response...' : placeholder}
					</Text>
				</Box>
			);
		}
	}, [visualLines, cursorRow, cursorCol, buffer, placeholder]);

	return (
		<Box flexDirection="column" width={"100%"}>
			{showHistoryMenu && (
				<Box marginBottom={1}>
					<Menu
						options={getUserMessages()}
						onSelect={handleHistorySelect}
						onSelectionChange={() => {}}
					/>
				</Box>
			)}
			{!showHistoryMenu && (
				<>
					<Box 
						flexDirection="row" 
						borderStyle="round"
						borderColor="gray"
						paddingX={1}
						paddingY={0}
						width="100%"
					>
						<Text color="cyan" bold>
							➣{' '}
						</Text>
						<Box flexDirection="column" flexGrow={1}>
							{renderContent()}
						</Box>
					</Box>
					<CommandPanel
						commands={getFilteredCommands()}
						selectedIndex={commandSelectedIndex}
						query={buffer.getFullText().slice(1)}
						visible={showCommands}
					/>
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							{showCommands && getFilteredCommands().length > 0 
								? "Type to filter commands" 
								: "Press Ctrl+C twice to exit"
							}
						</Text>
					</Box>
				</>
			)}
		</Box>
	);
}