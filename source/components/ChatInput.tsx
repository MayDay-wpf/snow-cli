import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useStdout } from 'ink';
import { TextBuffer, Viewport } from '../utils/textBuffer.js';
import { cpSlice } from '../utils/textUtils.js';
import CommandPanel from './CommandPanel.js';

type Props = {
	onSubmit: (message: string) => void;
	placeholder?: string;
};

// 命令定义
const commands = [
	{ name: 'add-dir', description: 'Add a new working directory' },
	{ name: 'agents', description: 'Manage agent configurations' },
	{ name: 'bashes', description: 'List and manage background bash shells' },
	{ name: 'bug', description: 'Submit feedback about Claude Code' },
	{ name: 'clear', description: 'Clear conversation history and free up context' },
	{ name: 'compact', description: 'Clear conversation history but keep a summary in context' },
	{ name: 'config', description: 'Open config panel' },
	{ name: 'cost', description: 'Show the total cost and duration of the current session' },
	{ name: 'doctor', description: 'Diagnose and verify your Claude Code installation and settings' },
	{ name: 'exit', description: 'Exit the REPL' },
];

export default function ChatInput({ onSubmit, placeholder = 'Type your message...' }: Props) {
	const { stdout } = useStdout();
	const terminalWidth = stdout?.columns || 80; // Get the actual width of the terminal
	
	// Use the actual terminal width and leave some margins
	const viewport: Viewport = { 
		width: Math.max(40, terminalWidth - 4), // Minimum 40 characters, minus margins
		height: 1 
	};
	const [buffer] = useState(() => new TextBuffer(viewport));
	const [, forceUpdate] = useState({});
	const isActiveRef = useRef(true);
	const inputTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const lastUpdateTime = useRef<number>(0);
	
	// Command panel state
	const [showCommands, setShowCommands] = useState(false);
	const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
	
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

	// Force re-render when buffer changes - debounced for performance and stability
	const triggerUpdate = useCallback(() => {
		const now = Date.now();
		
		if (inputTimeoutRef.current) {
			clearTimeout(inputTimeoutRef.current);
		}
		
		// Increase the anti-shake time to reduce the frequency of redrawing
		inputTimeoutRef.current = setTimeout(() => {
			// Avoid too frequent updates
			if (now - lastUpdateTime.current > 16) { // ~60fps limit
				lastUpdateTime.current = now;
				forceUpdate({});
			}
		}, 32); // 32ms to improve stability
	}, []);

	// Monitor the change of terminal size
	useEffect(() => {
		const handleResize = () => {
			const newWidth = stdout?.columns || 80;
			const newViewport = { 
				width: Math.max(40, newWidth - 4), 
				height: 1 
			};
			// 只有宽度显著变化时才重新创建buffer
			if (Math.abs(newViewport.width - viewport.width) > 5) {
				triggerUpdate();
			}
		};

		process.stdout?.on('resize', handleResize);
		return () => {
			process.stdout?.off('resize', handleResize);
		};
	}, [triggerUpdate, viewport.width]);

	useEffect(() => {
		if (!process.stdin.isTTY) return;

		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.setEncoding('utf8');

		const handleKeypress = (data: string) => {
			if (!isActiveRef.current) return;

			const code = data.charCodeAt(0);

			// Ctrl+C
			if (code === 3) {
				process.exit(0);
			}

			// Backspace - handle first to avoid conflicts
			if (code === 127 || code === 8) {
				buffer.backspace();
				
				// Always check and update command panel state after backspace
				const text = buffer.getFullText();
				if (!text.startsWith('/') || text.length === 0) {
					setShowCommands(false);
					setCommandSelectedIndex(0);
				} else {
					// Still starts with '/', ensure command panel is visible and reset selection
					setShowCommands(true);
					setCommandSelectedIndex(0);
				}
				
				triggerUpdate();
				return;
			}

			// Handle command panel navigation
			if (showCommands) {
				const filteredCommands = getFilteredCommands();
				
				// Escape - close command panel
				if (code === 27) {
					const seq = data.slice(1);
					if (seq === '') { // Pure Escape key
						setShowCommands(false);
						setCommandSelectedIndex(0);
						return;
					} else if (seq === '[A') { // Up arrow
						setCommandSelectedIndex(prev => Math.max(0, prev - 1));
						return;
					} else if (seq === '[B') { // Down arrow
						const maxIndex = Math.max(0, filteredCommands.length - 1);
						setCommandSelectedIndex(prev => Math.min(maxIndex, prev + 1));
						return;
					}
				}
				
				// Enter - select command (just close panel for now)
				if (code === 13) {
					if (filteredCommands.length > 0 && commandSelectedIndex < filteredCommands.length) {
						// For now, just insert the command name
						const selectedCommand = filteredCommands[commandSelectedIndex];
						if (selectedCommand) {
							const commandText = `/${selectedCommand.name}`;
							// 清空buffer然后插入文本，确保光标在末尾
							buffer.setText('');
							buffer.insert(commandText);
							setShowCommands(false);
							setCommandSelectedIndex(0);
							triggerUpdate();
						}
					}
					return;
				}
				
				// Allow normal text input to continue filtering
			}

			// Enter
			if (code === 13) {
				const message = buffer.getFullText().trim(); // 使用完整文本包括粘贴内容
				if (message) {
					// 立即清空输入框，确保UI快速响应
					buffer.setText('');
					
					// 立即触发更新，不使用防抖
					forceUpdate({});
					
					// 然后提交消息
					onSubmit(message);
				}
				return;
			}

			// Escape sequences (arrow keys)
			if (code === 27) {
				const seq = data.slice(1);
				if (seq === '[D') { // Left arrow
					buffer.moveLeft();
				} else if (seq === '[C') { // Right arrow
					buffer.moveRight();
				} else if (seq === '[A') { // Up arrow
					buffer.moveUp();
				} else if (seq === '[B') { // Down arrow
					buffer.moveDown();
				}
				triggerUpdate();
				return;
			}

			// Delete key
			if (code === 127 && data.length === 1) {
				buffer.delete();
				// Also update command panel state for delete operations
				const text = buffer.getFullText();
				if (!text.startsWith('/') || text.length === 0) {
					setShowCommands(false);
					setCommandSelectedIndex(0);
				}
				triggerUpdate();
				return;
			}

			// Handle paste (detect multi-character input)
			const isPaste = data.length > 1 && !/^[\x00-\x1F]/.test(data);

			// Printable characters and newlines
			if (code >= 32 || code === 10 || isPaste) {
				buffer.insert(data);
				
				// Check if input starts with '/' to show command panel
				const text = buffer.getFullText();
				if (text.startsWith('/') && text.length > 0) {
					setShowCommands(true);
					// Reset selection index when filtering changes
					setCommandSelectedIndex(0);
				} else {
					setShowCommands(false);
					setCommandSelectedIndex(0);
				}
				
				triggerUpdate();
			}
		};

		process.stdin.on('data', handleKeypress);

		return () => {
			process.stdin.off('data', handleKeypress);
			if (process.stdin.isTTY) {
				process.stdin.setRawMode(false);
				process.stdin.pause();
			}
			if (inputTimeoutRef.current) {
				clearTimeout(inputTimeoutRef.current);
			}
		};
	}, [buffer, onSubmit, triggerUpdate, showCommands, commandSelectedIndex, getFilteredCommands]);

	const visualLines = buffer.viewportVisualLines;
	const [cursorRow, cursorCol] = buffer.visualCursor;

	// In-inlay layout and border, and special display and paste placeholders
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
							// Check whether it contains pasted placeholders and highlights
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
								line || ' ' // Make sure that blank lines can also be displayed
							)
						)}
					</Text>
				</Box>
			));
		} else {
			return (
				<Box>
					<Text backgroundColor="white" color="black">
						{' '}
					</Text>
					<Text color="gray" dimColor>
						{placeholder}
					</Text>
				</Box>
			);
		}
	}, [visualLines, cursorRow, cursorCol, buffer, placeholder]);

	return (
		<Box flexDirection="column" width={"100%"}>
			<Box 
				flexDirection="row" 
				borderStyle="round"
				borderColor="blue"
				paddingX={1}
				paddingY={0}
				width="100%"
			>
				<Text color="blue" dimColor>
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
					{showCommands ? "Type to filter commands" : "Press Esc to return to main menu"}
				</Text>
			</Box>
		</Box>
	);
}
