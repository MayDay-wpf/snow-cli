import { useRef, useEffect } from 'react';
import { useInput } from 'ink';
import { TextBuffer } from '../utils/textBuffer.js';
import { executeCommand } from '../utils/commandExecutor.js';

type KeyboardInputOptions = {
	buffer: TextBuffer;
	disabled: boolean;
	triggerUpdate: () => void;
	forceUpdate: React.Dispatch<React.SetStateAction<{}>>;
	// Command panel
	showCommands: boolean;
	setShowCommands: (show: boolean) => void;
	commandSelectedIndex: number;
	setCommandSelectedIndex: (index: number | ((prev: number) => number)) => void;
	getFilteredCommands: () => Array<{ name: string; description: string }>;
	updateCommandPanelState: (text: string) => void;
	onCommand?: (commandName: string, result: any) => void;
	// File picker
	showFilePicker: boolean;
	setShowFilePicker: (show: boolean) => void;
	fileSelectedIndex: number;
	setFileSelectedIndex: (index: number | ((prev: number) => number)) => void;
	fileQuery: string;
	setFileQuery: (query: string) => void;
	atSymbolPosition: number;
	setAtSymbolPosition: (pos: number) => void;
	filteredFileCount: number;
	updateFilePickerState: (text: string, cursorPos: number) => void;
	handleFileSelect: (filePath: string) => Promise<void>;
	fileListRef: React.RefObject<{ getSelectedFile: () => string | null }>;
	// History navigation
	showHistoryMenu: boolean;
	setShowHistoryMenu: (show: boolean) => void;
	historySelectedIndex: number;
	setHistorySelectedIndex: (index: number | ((prev: number) => number)) => void;
	escapeKeyCount: number;
	setEscapeKeyCount: (count: number | ((prev: number) => number)) => void;
	escapeKeyTimer: React.MutableRefObject<NodeJS.Timeout | null>;
	getUserMessages: () => Array<{ label: string; value: string; infoText: string }>;
	handleHistorySelect: (value: string) => void;
	// Clipboard
	pasteFromClipboard: () => Promise<void>;
	// Submit
	onSubmit: (
		message: string,
		images?: Array<{ data: string; mimeType: string }>,
	) => void;
};

export function useKeyboardInput(options: KeyboardInputOptions) {
	const {
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
		setFileQuery,
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
		pasteFromClipboard,
		onSubmit,
	} = options;

	// Track paste detection
	const inputBuffer = useRef<string>('');
	const inputTimer = useRef<NodeJS.Timeout | null>(null);

	// Cleanup timer on unmount
	useEffect(() => {
		return () => {
			if (inputTimer.current) {
				clearTimeout(inputTimer.current);
			}
		};
	}, []);

	// Force immediate state update for critical operations like backspace
	const forceStateUpdate = () => {
		const text = buffer.getFullText();
		const cursorPos = buffer.getCursorPosition();

		updateFilePickerState(text, cursorPos);
		updateCommandPanelState(text);

		forceUpdate({});
	};

	// Handle input using useInput hook
	useInput((input, key) => {
		if (disabled) return;

		// Handle escape key for double-ESC history navigation
		if (key.escape) {
			// Close file picker if open
			if (showFilePicker) {
				setShowFilePicker(false);
				setFileSelectedIndex(0);
				setFileQuery('');
				setAtSymbolPosition(-1);
				return;
			}

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
			if (escapeKeyCount >= 1) {
				// This will be 2 after increment
				const userMessages = getUserMessages();
				if (userMessages.length > 0) {
					setShowHistoryMenu(true);
					setHistorySelectedIndex(0); // Reset selection to first item
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
			const userMessages = getUserMessages();

			// Up arrow in history menu
			if (key.upArrow) {
				setHistorySelectedIndex(prev => Math.max(0, prev - 1));
				return;
			}

			// Down arrow in history menu
			if (key.downArrow) {
				const maxIndex = Math.max(0, userMessages.length - 1);
				setHistorySelectedIndex(prev => Math.min(maxIndex, prev + 1));
				return;
			}

			// Enter - select history item
			if (key.return) {
				if (
					userMessages.length > 0 &&
					historySelectedIndex < userMessages.length
				) {
					const selectedMessage = userMessages[historySelectedIndex];
					if (selectedMessage) {
						handleHistorySelect(selectedMessage.value);
					}
				}
				return;
			}

			// For any other key in history menu, just return to prevent interference
			return;
		}

		// Ctrl+L - Delete from cursor to beginning
		if (key.ctrl && input === 'l') {
			const fullText = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			const afterCursor = fullText.slice(cursorPos);

			buffer.setText(afterCursor);
			forceStateUpdate();
			return;
		}

		// Ctrl+R - Delete from cursor to end
		if (key.ctrl && input === 'r') {
			const fullText = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			const beforeCursor = fullText.slice(0, cursorPos);

			buffer.setText(beforeCursor);
			forceStateUpdate();
			return;
		}

		// Windows: Alt+V, macOS: Ctrl+V - Paste from clipboard (including images)
		const isPasteShortcut =
			process.platform === 'darwin'
				? key.ctrl && input === 'v'
				: key.meta && input === 'v';

		if (isPasteShortcut) {
			pasteFromClipboard();
			return;
		}

		// Backspace
		if (key.backspace || key.delete) {
			buffer.backspace();
			forceStateUpdate();
			return;
		}

		// Handle file picker navigation
		if (showFilePicker) {
			// Up arrow in file picker
			if (key.upArrow) {
				setFileSelectedIndex(prev => Math.max(0, prev - 1));
				return;
			}

			// Down arrow in file picker
			if (key.downArrow) {
				const maxIndex = Math.max(0, filteredFileCount - 1);
				setFileSelectedIndex(prev => Math.min(maxIndex, prev + 1));
				return;
			}

			// Tab or Enter - select file
			if (key.tab || key.return) {
				if (filteredFileCount > 0 && fileSelectedIndex < filteredFileCount) {
					const selectedFile = fileListRef.current?.getSelectedFile();
					if (selectedFile) {
						handleFileSelect(selectedFile);
					}
				}
				return;
			}
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
				if (
					filteredCommands.length > 0 &&
					commandSelectedIndex < filteredCommands.length
				) {
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
				// Get images data, but only include images whose placeholders still exist
				const currentText = buffer.text; // Use internal text (includes placeholders)
				const allImages = buffer.getImages();
				const validImages = allImages
					.filter(img => currentText.includes(img.placeholder))
					.map(img => ({
						data: img.data,
						mimeType: img.mimeType,
					}));

				buffer.setText('');
				forceUpdate({});
				onSubmit(message, validImages.length > 0 ? validImages : undefined);
			}
			return;
		}

		// Arrow keys for cursor movement
		if (key.leftArrow) {
			buffer.moveLeft();
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateFilePickerState(text, cursorPos);
			triggerUpdate();
			return;
		}

		if (key.rightArrow) {
			buffer.moveRight();
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateFilePickerState(text, cursorPos);
			triggerUpdate();
			return;
		}

		if (key.upArrow && !showCommands && !showFilePicker) {
			buffer.moveUp();
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateFilePickerState(text, cursorPos);
			triggerUpdate();
			return;
		}

		if (key.downArrow && !showCommands && !showFilePicker) {
			buffer.moveDown();
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateFilePickerState(text, cursorPos);
			triggerUpdate();
			return;
		}

		// Regular character input
		if (input && !key.ctrl && !key.meta && !key.escape) {
			// Accumulate input for paste detection
			inputBuffer.current += input;

			// Clear existing timer
			if (inputTimer.current) {
				clearTimeout(inputTimer.current);
			}

			// Set timer to process accumulated input
			inputTimer.current = setTimeout(() => {
				const accumulated = inputBuffer.current;
				inputBuffer.current = '';

				// If we accumulated input, it's likely a paste
				if (accumulated) {
					buffer.insert(accumulated);
					const text = buffer.getFullText();
					const cursorPos = buffer.getCursorPosition();
					updateCommandPanelState(text);
					updateFilePickerState(text, cursorPos);
					triggerUpdate();
				}
			}, 10); // Short delay to accumulate rapid input
		}
	});
}
