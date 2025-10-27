import {useRef, useEffect} from 'react';
import {useInput} from 'ink';
import {TextBuffer} from '../utils/textBuffer.js';
import {executeCommand} from '../utils/commandExecutor.js';
import type {SubAgent} from '../utils/subAgentConfig.js';

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
	getFilteredCommands: () => Array<{name: string; description: string}>;
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
	fileListRef: React.RefObject<{getSelectedFile: () => string | null}>;
	// History navigation
	showHistoryMenu: boolean;
	setShowHistoryMenu: (show: boolean) => void;
	historySelectedIndex: number;
	setHistorySelectedIndex: (index: number | ((prev: number) => number)) => void;
	escapeKeyCount: number;
	setEscapeKeyCount: (count: number | ((prev: number) => number)) => void;
	escapeKeyTimer: React.MutableRefObject<NodeJS.Timeout | null>;
	getUserMessages: () => Array<{
		label: string;
		value: string;
		infoText: string;
	}>;
	handleHistorySelect: (value: string) => void;
	// Terminal-style history navigation
	currentHistoryIndex: number;
	navigateHistoryUp: () => boolean;
	navigateHistoryDown: () => boolean;
	resetHistoryNavigation: () => void;
	saveToHistory: (content: string) => Promise<void>;
	// Clipboard
	pasteFromClipboard: () => Promise<void>;
	// Submit
	onSubmit: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
	) => void;
	// Focus management
	ensureFocus: () => void;
	// Agent picker
	showAgentPicker: boolean;
	setShowAgentPicker: (show: boolean) => void;
	agentSelectedIndex: number;
	setAgentSelectedIndex: (index: number | ((prev: number) => number)) => void;
	agents: SubAgent[];
	handleAgentSelect: (agent: SubAgent) => void;
	// Todo picker
	showTodoPicker: boolean;
	setShowTodoPicker: (show: boolean) => void;
	todoSelectedIndex: number;
	setTodoSelectedIndex: (index: number | ((prev: number) => number)) => void;
	todos: Array<{id: string; file: string; line: number; content: string}>;
	selectedTodos: Set<string>;
	toggleTodoSelection: () => void;
	confirmTodoSelection: () => void;
	todoSearchQuery: string;
	setTodoSearchQuery: (query: string) => void;
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
		agents,
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
	} = options;

	// Mark variables as used (they are used in useInput closure below)
	void todoSelectedIndex;
	void selectedTodos;

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
		// Filter out focus events more robustly
		// Focus events: ESC[I (focus in) or ESC[O (focus out)
		// Some terminals may send these with or without ESC, and they might appear
		// anywhere in the input string (especially during drag-and-drop with Shift held)
		// We need to filter them out but NOT remove legitimate user input
		const focusEventPattern = /(\s|^)\[(?:I|O)(?=(?:\s|$|["'~\\\/]|[A-Za-z]:))/;

		if (
			// Complete escape sequences
			input === '\x1b[I' ||
			input === '\x1b[O' ||
			// Standalone sequences (exact match only)
			input === '[I' ||
			input === '[O' ||
			// Filter if input ONLY contains focus events, whitespace, and optional ESC prefix
			(/^[\s\x1b\[IO]+$/.test(input) && focusEventPattern.test(input))
		) {
			return;
		}

		// Shift+Tab - Toggle YOLO mode
		if (key.shift && key.tab) {
			executeCommand('yolo').then(result => {
				if (onCommand) {
					onCommand('yolo', result);
				}
			});
			return;
		}

		// Handle escape key for double-ESC history navigation
		if (key.escape) {
			// Close todo picker if open
			if (showTodoPicker) {
				setShowTodoPicker(false);
				setTodoSelectedIndex(0);
				return;
			}

			// Close agent picker if open
			if (showAgentPicker) {
				setShowAgentPicker(false);
				setAgentSelectedIndex(0);
				return;
			}

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

		// Handle todo picker navigation
		if (showTodoPicker) {
			// Up arrow in todo picker
			if (key.upArrow) {
				setTodoSelectedIndex(prev => Math.max(0, prev - 1));
				return;
			}

			// Down arrow in todo picker
			if (key.downArrow) {
				const maxIndex = Math.max(0, todos.length - 1);
				setTodoSelectedIndex(prev => Math.min(maxIndex, prev + 1));
				return;
			}

			// Space - toggle selection
			if (input === ' ') {
				toggleTodoSelection();
				return;
			}

			// Enter - confirm selection
			if (key.return) {
				confirmTodoSelection();
				return;
			}

			// Backspace - remove last character from search
			if (key.backspace || key.delete) {
				if (todoSearchQuery.length > 0) {
					setTodoSearchQuery(todoSearchQuery.slice(0, -1));
					setTodoSelectedIndex(0); // Reset to first item
					triggerUpdate();
				}
				return;
			}

			// Type to search - alphanumeric and common characters
			if (
				input &&
				input.length === 1 &&
				!key.ctrl &&
				!key.meta &&
				input !== '\x1b' // Ignore escape sequences
			) {
				setTodoSearchQuery(todoSearchQuery + input);
				setTodoSelectedIndex(0); // Reset to first item
				triggerUpdate();
				return;
			}

			// For any other key in todo picker, just return to prevent interference
			return;
		}

		// Handle agent picker navigation
		if (showAgentPicker) {
			// Up arrow in agent picker
			if (key.upArrow) {
				setAgentSelectedIndex(prev => Math.max(0, prev - 1));
				return;
			}

			// Down arrow in agent picker
			if (key.downArrow) {
				const maxIndex = Math.max(0, agents.length - 1);
				setAgentSelectedIndex(prev => Math.min(maxIndex, prev + 1));
				return;
			}

			// Enter - select agent
			if (key.return) {
				if (agents.length > 0 && agentSelectedIndex < agents.length) {
					const selectedAgent = agents[agentSelectedIndex];
					if (selectedAgent) {
						handleAgentSelect(selectedAgent);
						setShowAgentPicker(false);
						setAgentSelectedIndex(0);
					}
				}
				return;
			}

			// For any other key in agent picker, just return to prevent interference
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
			const displayText = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			const afterCursor = displayText.slice(cursorPos);

			buffer.setText(afterCursor);
			forceStateUpdate();
			return;
		}

		// Ctrl+R - Delete from cursor to end
		if (key.ctrl && input === 'r') {
			const displayText = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			const beforeCursor = displayText.slice(0, cursorPos);

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
						// Special handling for todo- command
						if (selectedCommand.name === 'todo-') {
							buffer.setText('');
							setShowCommands(false);
							setCommandSelectedIndex(0);
							setShowTodoPicker(true);
							triggerUpdate();
							return;
						}
						// Special handling for agent- command
						if (selectedCommand.name === 'agent-') {
							buffer.setText('');
							setShowCommands(false);
							setCommandSelectedIndex(0);
							setShowAgentPicker(true);
							triggerUpdate();
							return;
						}
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
			// Reset history navigation on submit
			if (currentHistoryIndex !== -1) {
				resetHistoryNavigation();
			}

			const message = buffer.getFullText().trim();
			if (message) {
				// Check if message is a command with arguments (e.g., /review [note])
				if (message.startsWith('/')) {
					const commandMatch = message.match(/^\/(\w+)(?:\s+(.+))?$/);
					if (commandMatch && commandMatch[1]) {
						const commandName = commandMatch[1];
						const commandArgs = commandMatch[2];

						// Execute command with arguments
						executeCommand(commandName, commandArgs).then(result => {
							if (onCommand) {
								onCommand(commandName, result);
							}
						});

						buffer.setText('');
						setShowCommands(false);
						setCommandSelectedIndex(0);
						triggerUpdate();
						return;
					}
				}

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

				// Save to persistent history
				saveToHistory(message);

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
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			const isEmpty = text.trim() === '';
			const isAtStart = cursorPos === 0;
			const hasNewline = text.includes('\n');

			// Terminal-style history navigation:
			// 1. Empty input box -> navigate history
			// 2. Cursor at start of single line -> navigate history
			// 3. Otherwise -> normal cursor movement
			if (isEmpty || (!hasNewline && isAtStart)) {
				const navigated = navigateHistoryUp();
				if (navigated) {
					updateFilePickerState(
						buffer.getFullText(),
						buffer.getCursorPosition(),
					);
					triggerUpdate();
					return;
				}
			}

			// Normal cursor movement
			buffer.moveUp();
			updateFilePickerState(buffer.getFullText(), buffer.getCursorPosition());
			triggerUpdate();
			return;
		}

		if (key.downArrow && !showCommands && !showFilePicker) {
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			const isEmpty = text.trim() === '';
			const isAtEnd = cursorPos === text.length;
			const hasNewline = text.includes('\n');

			// Terminal-style history navigation:
			// 1. Empty input box -> navigate history (if in history mode)
			// 2. Cursor at end of single line -> navigate history (if in history mode)
			// 3. Otherwise -> normal cursor movement
			if ((isEmpty || (!hasNewline && isAtEnd)) && currentHistoryIndex !== -1) {
				const navigated = navigateHistoryDown();
				if (navigated) {
					updateFilePickerState(
						buffer.getFullText(),
						buffer.getCursorPosition(),
					);
					triggerUpdate();
					return;
				}
			}

			// Normal cursor movement
			buffer.moveDown();
			updateFilePickerState(buffer.getFullText(), buffer.getCursorPosition());
			triggerUpdate();
			return;
		}

		// Regular character input
		if (input && !key.ctrl && !key.meta && !key.escape) {
			// Reset history navigation when user starts typing
			if (currentHistoryIndex !== -1) {
				resetHistoryNavigation();
			}

			// Ensure focus is active when user is typing (handles delayed focus events)
			// This is especially important for drag-and-drop operations where focus
			// events may arrive out of order or be filtered by sanitizeInput
			ensureFocus();

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
