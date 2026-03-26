import {useRef, useEffect} from 'react';
import {useInput} from 'ink';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {editTextWithNotepad} from '../../utils/ui/externalEditor.js';
import {executeCommand} from '../../utils/execution/commandExecutor.js';
import {copyToClipboard} from '../../utils/core/clipboard.js';
import {commandUsageManager} from '../../utils/session/commandUsageManager.js';
import {setPickerActive} from '../../utils/ui/pickerState.js';
import type {SubAgent} from '../../utils/config/subAgentConfig.js';

type KeyboardInputOptions = {
	buffer: TextBuffer;
	disabled: boolean;
	disableKeyboardNavigation?: boolean;
	isProcessing?: boolean; // Prevent command execution during AI response/tool execution
	triggerUpdate: () => void;
	forceUpdate: React.Dispatch<React.SetStateAction<{}>>;
	// Mode state
	yoloMode: boolean;
	setYoloMode: (value: boolean) => void;
	planMode: boolean;
	setPlanMode: (value: boolean) => void;
	vulnerabilityHuntingMode: boolean;
	setVulnerabilityHuntingMode: (value: boolean) => void;
	teamMode: boolean;
	setTeamMode: (value: boolean) => void;
	// Command panel
	showCommands: boolean;
	setShowCommands: (show: boolean) => void;
	commandSelectedIndex: number;
	setCommandSelectedIndex: (index: number | ((prev: number) => number)) => void;
	getFilteredCommands: () => Array<{
		name: string;
		description: string;
		type: 'builtin' | 'execute' | 'prompt';
	}>;
	updateCommandPanelState: (text: string) => void;
	onCommand?: (commandName: string, result: any) => void;
	getAllCommands?: () => Array<{
		name: string;
		description: string;
		type: 'builtin' | 'execute' | 'prompt';
	}>; // Get all available commands for validation

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
	fileListRef: React.RefObject<{
		getSelectedFile: () => string | null;
		toggleDisplayMode: () => boolean;
	}>;

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
	onCopyInputSuccess?: () => void;
	onCopyInputError?: (errorMessage: string) => void;
	// Paste detection
	pasteShortcutTimeoutMs?: number;
	pasteFlushDebounceMs?: number;
	pasteIndicatorThreshold?: number;
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
	updateAgentPickerState: (text: string, cursorPos: number) => void;
	getFilteredAgents: () => SubAgent[];
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
	// Skills picker
	showSkillsPicker: boolean;
	setShowSkillsPicker: (show: boolean) => void;
	skillsSelectedIndex: number;
	setSkillsSelectedIndex: (index: number | ((prev: number) => number)) => void;
	skills: Array<{
		id: string;
		name: string;
		description: string;
		location: string;
	}>;
	skillsIsLoading: boolean;
	skillsSearchQuery: string;
	skillsAppendText: string;
	skillsFocus: 'search' | 'append';
	toggleSkillsFocus: () => void;
	appendSkillsChar: (ch: string) => void;
	backspaceSkillsField: () => void;
	confirmSkillsSelection: () => void;
	closeSkillsPicker: () => void;
	// GitLine picker
	showGitLinePicker: boolean;
	setShowGitLinePicker: (show: boolean) => void;
	gitLineSelectedIndex: number;
	setGitLineSelectedIndex: (index: number | ((prev: number) => number)) => void;
	gitLineCommits: Array<{
		sha: string;
		subject: string;
		authorName: string;
		dateIso: string;
	}>;
	selectedGitLineCommits: Set<string>;
	gitLineIsLoading: boolean;
	gitLineSearchQuery: string;
	setGitLineSearchQuery: (query: string) => void;
	gitLineError?: string | null;
	toggleGitLineCommitSelection: () => void;
	confirmGitLineSelection: () => void;
	closeGitLinePicker: () => void;
	// Profile picker
	showProfilePicker: boolean;
	setShowProfilePicker: (show: boolean) => void;
	profileSelectedIndex: number;
	setProfileSelectedIndex: (index: number | ((prev: number) => number)) => void;
	getFilteredProfiles: () => Array<{
		name: string;
		displayName: string;
		isActive: boolean;
	}>;
	handleProfileSelect: (profileName: string) => void;
	profileSearchQuery: string;
	setProfileSearchQuery: (query: string) => void;
	// Profile switching
	onSwitchProfile?: () => void;
	// Running agents picker
	showRunningAgentsPicker: boolean;
	setShowRunningAgentsPicker: (show: boolean) => void;
	runningAgentsSelectedIndex: number;
	setRunningAgentsSelectedIndex: (
		index: number | ((prev: number) => number),
	) => void;
	runningAgents: Array<{
		instanceId: string;
		agentId: string;
		agentName: string;
		prompt: string;
		startedAt: Date;
	}>;
	selectedRunningAgents: Set<string>;
	toggleRunningAgentSelection: () => void;
	confirmRunningAgentsSelection: () => any[];
	closeRunningAgentsPicker: () => void;
	updateRunningAgentsPickerState: (text: string, cursorPos: number) => void;
};

export function useKeyboardInput(options: KeyboardInputOptions) {
	const {
		buffer,
		disabled,
		disableKeyboardNavigation = false,
		isProcessing = false,
		triggerUpdate,
		forceUpdate,
		yoloMode,
		setYoloMode,
		planMode,
		setPlanMode,
		vulnerabilityHuntingMode: _vulnerabilityHuntingMode,
		setVulnerabilityHuntingMode,
		teamMode: _teamMode,
		setTeamMode,
		showCommands,
		setShowCommands,
		commandSelectedIndex,
		setCommandSelectedIndex,
		getFilteredCommands,
		updateCommandPanelState,
		onCommand,
		getAllCommands,
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
		onCopyInputSuccess,
		onCopyInputError,

		pasteShortcutTimeoutMs = 800,

		pasteFlushDebounceMs = 250,
		pasteIndicatorThreshold = 300,
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
		showSkillsPicker,
		setShowSkillsPicker,
		skillsSelectedIndex,
		setSkillsSelectedIndex,
		skills,
		skillsIsLoading,
		skillsSearchQuery,
		skillsAppendText,
		skillsFocus,
		toggleSkillsFocus,
		appendSkillsChar,
		backspaceSkillsField,
		confirmSkillsSelection,
		closeSkillsPicker,
		showGitLinePicker,
		setShowGitLinePicker,
		gitLineSelectedIndex,
		setGitLineSelectedIndex,
		gitLineCommits,
		selectedGitLineCommits,
		gitLineIsLoading,
		gitLineSearchQuery,
		setGitLineSearchQuery,
		gitLineError,
		toggleGitLineCommitSelection,
		confirmGitLineSelection,
		closeGitLinePicker,
		showProfilePicker,
		setShowProfilePicker,
		profileSelectedIndex,
		setProfileSelectedIndex,
		getFilteredProfiles,
		handleProfileSelect,
		profileSearchQuery,
		setProfileSearchQuery,
		onSwitchProfile,
		showRunningAgentsPicker,
		runningAgentsSelectedIndex,
		setRunningAgentsSelectedIndex,
		runningAgents,
		selectedRunningAgents,
		toggleRunningAgentSelection,
		confirmRunningAgentsSelection,
		closeRunningAgentsPicker,
		updateRunningAgentsPickerState,
	} = options;

	// Mark variables as used (they are used in useInput closure below)
	void todoSelectedIndex;
	void selectedTodos;
	void skillsSelectedIndex;
	void skillsIsLoading;
	void skillsSearchQuery;
	void skillsAppendText;
	void skillsFocus;
	void gitLineSelectedIndex;
	void selectedGitLineCommits;
	void gitLineIsLoading;
	void gitLineError;
	void _teamMode;
	void runningAgentsSelectedIndex;
	void selectedRunningAgents;

	// Track paste detection
	const inputBuffer = useRef<string>('');
	const inputTimer = useRef<NodeJS.Timeout | null>(null);
	const isPasting = useRef<boolean>(false); // Track if we're in pasting mode
	const inputStartCursorPos = useRef<number>(0); // Track cursor position when input starts accumulating
	const isProcessingInput = useRef<boolean>(false); // Track if multi-char input is being processed
	const inputSessionId = useRef<number>(0); // Invalidates stale buffered input timers
	const lastPasteShortcutAt = useRef<number>(0); // Track recent paste shortcut usage
	const componentMountTime = useRef<number>(Date.now()); // Track when component mounted

	// Cleanup timer on unmount
	useEffect(() => {
		return () => {
			if (inputTimer.current) {
				clearTimeout(inputTimer.current);
			}
		};
	}, []);

	// Track if Delete key was pressed (detected via raw stdin)
	const deleteKeyPressed = useRef<boolean>(false);

	// Listen to raw stdin to detect Delete key (escape sequence \x1b[3~)
	// ink's useInput doesn't distinguish between Backspace and Delete
	useEffect(() => {
		const handleRawInput = (data: Buffer) => {
			const str = data.toString();
			// Delete key sends escape sequence: ESC [ 3 ~
			if (str === '\x1b[3~') {
				deleteKeyPressed.current = true;
			}
		};

		if (process.stdin.isTTY) {
			process.stdin.on('data', handleRawInput);
		}

		return () => {
			if (process.stdin.isTTY) {
				process.stdin.off('data', handleRawInput);
			}
		};
	}, []);

	// Force immediate state update for critical operations like backspace
	const forceStateUpdate = () => {
		const text = buffer.getFullText();
		const cursorPos = buffer.getCursorPosition();

		updateFilePickerState(text, cursorPos);
		updateAgentPickerState(text, cursorPos);
		updateRunningAgentsPickerState(text, cursorPos);
		updateCommandPanelState(text);

		forceUpdate({});
	};

	const flushPendingInput = () => {
		if (!inputBuffer.current) return;

		if (inputTimer.current) {
			clearTimeout(inputTimer.current);
			inputTimer.current = null;
		}

		// Invalidate any queued timer work from older input batches.
		inputSessionId.current += 1;

		const accumulated = inputBuffer.current;
		const savedCursorPosition = inputStartCursorPos.current;
		inputBuffer.current = '';

		// Keep these flags consistent; otherwise a single-char insert can race a pending flush.
		isPasting.current = false;
		isProcessingInput.current = false;

		buffer.setCursorPosition(savedCursorPosition);
		buffer.insert(accumulated);
		inputStartCursorPos.current = buffer.getCursorPosition();
	};

	// Handle input using useInput hook
	useInput((input, key) => {
		if (disabled) return;

		// Ignore focus events during the first 500ms after component mount
		// This prevents [I[I artifacts when switching from WelcomeScreen to ChatScreen
		const timeSinceMount = Date.now() - componentMountTime.current;
		if (timeSinceMount < 500) {
			// During initial mount period, aggressively filter any input that could be focus events
			if (
				input.includes('[I') ||
				input.includes('[O') ||
				input === '\x1b[I' ||
				input === '\x1b[O' ||
				/^[\s\x1b\[IO]+$/.test(input)
			) {
				return;
			}
		}

		// Filter out focus events more robustly
		// Focus events: ESC[I (focus in) or ESC[O (focus out)
		// Some terminals may send these with or without ESC, and they might appear
		// anywhere in the input string (especially during drag-and-drop with Shift held)
		// We need to filter them out but NOT remove legitimate user input
		const focusEventPattern = /(\s|^)\[(?:I|O)(?=(?:\s|$|["'~\\/]|[A-Za-z]:))/;

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

		// Shift+Tab - Toggle modes in cycle: Off -> YOLO -> YOLO+Plan -> Plan -> YOLO+Team -> Team -> Off
		if (key.shift && key.tab) {
			if (yoloMode && !planMode && !_teamMode) {
				// YOLO only -> YOLO + Plan
				setPlanMode(true);
				setVulnerabilityHuntingMode(false);
				setTeamMode(false);
			} else if (yoloMode && planMode && !_teamMode) {
				// YOLO + Plan -> Plan only
				setYoloMode(false);
			} else if (!yoloMode && planMode && !_teamMode) {
				// Plan only -> YOLO + Team
				setYoloMode(true);
				setPlanMode(false);
				setTeamMode(true);
				setVulnerabilityHuntingMode(false);
			} else if (yoloMode && !planMode && _teamMode) {
				// YOLO + Team -> Team only
				setYoloMode(false);
			} else if (!yoloMode && !planMode && _teamMode) {
				// Team only -> All off
				setTeamMode(false);
			} else {
				// All off -> YOLO only
				setYoloMode(true);
				setPlanMode(false);
				setTeamMode(false);
				setVulnerabilityHuntingMode(false);
			}
			return;
		}

		// Ctrl+Y - Toggle modes in cycle: Off -> YOLO -> YOLO+Plan -> Plan -> YOLO+Team -> Team -> Off
		if (key.ctrl && input === 'y') {
			if (yoloMode && !planMode && !_teamMode) {
				// YOLO only -> YOLO + Plan
				setPlanMode(true);
				setVulnerabilityHuntingMode(false);
				setTeamMode(false);
			} else if (yoloMode && planMode && !_teamMode) {
				// YOLO + Plan -> Plan only
				setYoloMode(false);
			} else if (!yoloMode && planMode && !_teamMode) {
				// Plan only -> YOLO + Team
				setYoloMode(true);
				setPlanMode(false);
				setTeamMode(true);
				setVulnerabilityHuntingMode(false);
			} else if (yoloMode && !planMode && _teamMode) {
				// YOLO + Team -> Team only
				setYoloMode(false);
			} else if (!yoloMode && !planMode && _teamMode) {
				// Team only -> All off
				setTeamMode(false);
			} else {
				// All off -> YOLO only
				setYoloMode(true);
				setPlanMode(false);
				setTeamMode(false);
				setVulnerabilityHuntingMode(false);
			}
			return;
		}

		// Windows/Linux: Alt+P, macOS: Ctrl+P - Switch to next profile
		const isProfileSwitchShortcut =
			process.platform === 'darwin'
				? key.ctrl && input === 'p'
				: key.meta && input === 'p';
		if (isProfileSwitchShortcut) {
			if (onSwitchProfile) {
				onSwitchProfile();
			}
			return;
		}

		// Handle escape key for double-ESC history navigation
		if (key.escape) {
			if (showProfilePicker) {
				setShowProfilePicker(false);
				setProfileSelectedIndex(0);
				setProfileSearchQuery('');
				setPickerActive(true);
				return;
			}

			if (showSkillsPicker) {
				closeSkillsPicker();
				setPickerActive(true);
				return;
			}

			if (showGitLinePicker) {
				closeGitLinePicker();
				setPickerActive(true);
				return;
			}

			if (showRunningAgentsPicker) {
				closeRunningAgentsPicker();
				setPickerActive(true);
				return;
			}

			if (showTodoPicker) {
				setShowTodoPicker(false);
				setTodoSelectedIndex(0);
				setPickerActive(true);
				return;
			}

			if (showAgentPicker) {
				setShowAgentPicker(false);
				setAgentSelectedIndex(0);
				setPickerActive(true);
				return;
			}

			if (showFilePicker) {
				setShowFilePicker(false);
				setFileSelectedIndex(0);
				setFileQuery('');
				setAtSymbolPosition(-1);
				setPickerActive(true);
				return;
			}

			if (showCommands) {
				setShowCommands(false);
				setCommandSelectedIndex(0);
				setPickerActive(true);
				return;
			}

			setPickerActive(false);

			if (showHistoryMenu) {
				setShowHistoryMenu(false);
				return;
			}

			setEscapeKeyCount(prev => prev + 1);

			if (escapeKeyTimer.current) {
				clearTimeout(escapeKeyTimer.current);
			}

			escapeKeyTimer.current = setTimeout(() => {
				setEscapeKeyCount(0);
			}, 500);

			if (escapeKeyCount >= 1) {
				setEscapeKeyCount(0);
				if (escapeKeyTimer.current) {
					clearTimeout(escapeKeyTimer.current);
					escapeKeyTimer.current = null;
				}

				const text = buffer.getFullText();
				if (text.trim().length > 0) {
					buffer.setText('');
					forceStateUpdate();
				} else {
					const userMessages = getUserMessages();
					if (userMessages.length > 0) {
						setShowHistoryMenu(true);
						setHistorySelectedIndex(userMessages.length - 1);
					}
				}
			}
			return;
		}

		// Handle skills picker navigation
		if (showSkillsPicker) {
			// Up arrow - 循环导航:第一项 → 最后一项
			if (key.upArrow) {
				setSkillsSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, skills.length - 1),
				);
				return;
			}

			// Down arrow - 循环导航:最后一项 → 第一项
			if (key.downArrow) {
				const maxIndex = Math.max(0, skills.length - 1);
				setSkillsSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
				return;
			}

			// Tab - toggle focus between search/append
			if (key.tab) {
				toggleSkillsFocus();
				return;
			}

			// Enter - confirm selection
			if (key.return) {
				confirmSkillsSelection();
				return;
			}

			// Backspace/Delete - remove last character from focused field
			if (key.backspace || key.delete) {
				backspaceSkillsField();
				return;
			}

			// Type - update focused field (accept multi-byte like Chinese)
			if (
				input &&
				!key.ctrl &&
				!key.meta &&
				!key.escape &&
				input !== '\\x1b' &&
				input !== '\\u001b' &&
				!/[\\x00-\\x1F]/.test(input)
			) {
				appendSkillsChar(input);
				return;
			}

			return;
		}

		if (showGitLinePicker) {
			if (key.upArrow) {
				setGitLineSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, gitLineCommits.length - 1),
				);
				return;
			}

			if (key.downArrow) {
				const maxIndex = Math.max(0, gitLineCommits.length - 1);
				setGitLineSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
				return;
			}

			if (input === ' ') {
				toggleGitLineCommitSelection();
				return;
			}

			if (key.return) {
				confirmGitLineSelection();
				return;
			}

			if (key.backspace || key.delete) {
				if (gitLineSearchQuery.length > 0) {
					setGitLineSearchQuery(gitLineSearchQuery.slice(0, -1));
					setGitLineSelectedIndex(0);
					triggerUpdate();
				}
				return;
			}

			if (
				input &&
				!key.ctrl &&
				!key.meta &&
				!key.escape &&
				input !== '\\x1b' &&
				input !== '\\u001b' &&
				!/[\\x00-\\x1F]/.test(input)
			) {
				setGitLineSearchQuery(gitLineSearchQuery + input);
				setGitLineSelectedIndex(0);
				triggerUpdate();
				return;
			}

			return;
		}

		// Handle profile picker navigation
		if (showProfilePicker) {
			const filteredProfiles = getFilteredProfiles();

			if (key.upArrow) {
				setProfileSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, filteredProfiles.length - 1),
				);
				return;
			}

			if (key.downArrow) {
				const maxIndex = Math.max(0, filteredProfiles.length - 1);
				setProfileSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
				return;
			}

			if (key.return) {
				if (
					filteredProfiles.length > 0 &&
					profileSelectedIndex < filteredProfiles.length
				) {
					const selectedProfile = filteredProfiles[profileSelectedIndex];
					if (selectedProfile) {
						handleProfileSelect(selectedProfile.name);
					}
				}
				return;
			}

			if (key.backspace || key.delete) {
				if (profileSearchQuery.length > 0) {
					setProfileSearchQuery(profileSearchQuery.slice(0, -1));
					setProfileSelectedIndex(0);
					triggerUpdate();
				}
				return;
			}

			if (
				input &&
				!key.ctrl &&
				!key.meta &&
				!key.escape &&
				input !== '\x1b' &&
				input !== '\u001b' &&
				!/[\x00-\x1F]/.test(input)
			) {
				setProfileSearchQuery(profileSearchQuery + input);
				setProfileSelectedIndex(0);
				triggerUpdate();
				return;
			}

			return;
		}

		// Handle running agents picker navigation
		if (showRunningAgentsPicker) {
			// Up arrow - circular navigation
			if (key.upArrow) {
				setRunningAgentsSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, runningAgents.length - 1),
				);
				return;
			}

			// Down arrow - circular navigation
			if (key.downArrow) {
				const maxIndex = Math.max(0, runningAgents.length - 1);
				setRunningAgentsSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
				return;
			}

			// Space - toggle multi-selection
			if (input === ' ') {
				toggleRunningAgentSelection();
				return;
			}

			// Enter - confirm selection and insert visual tags.
			// If nothing was explicitly toggled with Space, the currently
			// highlighted agent is auto-selected inside confirmRunningAgentsSelection().
			if (key.return) {
				confirmRunningAgentsSelection();
				forceStateUpdate();
				return;
			}

			// Backspace / Delete — let it through so >> can be deleted
			// and updateRunningAgentsPickerState will auto-close the panel.
			if (key.backspace || key.delete) {
				// Don't return — fall through to normal backspace handling below
			} else {
				// For any other key in running agents picker, block to prevent interference
				return;
			}
		}

		// Handle todo picker navigation
		if (showTodoPicker) {
			// Up arrow in todo picker - 循环导航:第一项 → 最后一项
			if (key.upArrow) {
				setTodoSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, todos.length - 1),
				);
				return;
			}

			// Down arrow in todo picker - 循环导航:最后一项 → 第一项
			if (key.downArrow) {
				const maxIndex = Math.max(0, todos.length - 1);
				setTodoSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
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
			// Accept complete characters (including multi-byte like Chinese)
			// but filter out control sequences and incomplete input
			if (
				input &&
				!key.ctrl &&
				!key.meta &&
				!key.escape &&
				input !== '\x1b' && // Ignore escape sequences
				input !== '\u001b' && // Additional escape check
				!/[\x00-\x1F]/.test(input) // Ignore other control characters
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
			const filteredAgents = getFilteredAgents();

			// Up arrow in agent picker - 循环导航:第一项 → 最后一项
			if (key.upArrow) {
				setAgentSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, filteredAgents.length - 1),
				);
				return;
			}

			// Down arrow in agent picker - 循环导航:最后一项 → 第一项
			if (key.downArrow) {
				const maxIndex = Math.max(0, filteredAgents.length - 1);
				setAgentSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
				return;
			}

			// Enter - select agent
			if (key.return) {
				if (
					filteredAgents.length > 0 &&
					agentSelectedIndex < filteredAgents.length
				) {
					const selectedAgent = filteredAgents[agentSelectedIndex];
					if (selectedAgent) {
						handleAgentSelect(selectedAgent);
						setShowAgentPicker(false);
						setAgentSelectedIndex(0);
					}
				}
				return;
			}

			// Allow typing to filter - don't block regular input
			// The input will be processed below and updateAgentPickerState will be called
			// which will update the filter automatically
		}

		// Handle history menu navigation
		if (showHistoryMenu) {
			const userMessages = getUserMessages();

			// Up arrow in history menu - 循环导航:第一项 → 最后一项
			if (key.upArrow) {
				setHistorySelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, userMessages.length - 1),
				);
				return;
			}

			// Down arrow in history menu - 循环导航:最后一项 → 第一项
			if (key.downArrow) {
				const maxIndex = Math.max(0, userMessages.length - 1);
				setHistorySelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
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

		// Helper function: find word boundaries (space and punctuation)
		const findWordBoundary = (
			text: string,
			start: number,
			direction: 'forward' | 'backward',
		): number => {
			if (direction === 'forward') {
				// Skip current whitespace/punctuation
				let pos = start;
				while (pos < text.length && /[\s\p{P}]/u.test(text[pos] || '')) {
					pos++;
				}
				// Find next whitespace/punctuation
				while (pos < text.length && !/[\s\p{P}]/u.test(text[pos] || '')) {
					pos++;
				}
				return pos;
			} else {
				// Skip current whitespace/punctuation
				let pos = start;
				while (pos > 0 && /[\s\p{P}]/u.test(text[pos - 1] || '')) {
					pos--;
				}
				// Find previous whitespace/punctuation
				while (pos > 0 && !/[\s\p{P}]/u.test(text[pos - 1] || '')) {
					pos--;
				}
				return pos;
			}
		};

		// Ctrl+T - Toggle file picker display mode when active, otherwise toggle pasted text view
		if (key.ctrl && input === 't') {
			if (showFilePicker && fileListRef.current?.toggleDisplayMode()) {
				forceUpdate({});
				return;
			}

			flushPendingInput();
			buffer.toggleExpandedView();
			forceUpdate({});
			return;
		}

		// Ctrl+A - Move to beginning of line
		if (key.ctrl && input === 'a') {
			flushPendingInput();
			const text = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			// Find start of current line
			const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
			buffer.setCursorPosition(lineStart);
			triggerUpdate();
			return;
		}

		// Ctrl+E - Move to end of line
		if (key.ctrl && input === 'e') {
			flushPendingInput();
			const text = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			// Find end of current line
			let lineEnd = text.indexOf('\n', cursorPos);
			if (lineEnd === -1) lineEnd = text.length;
			buffer.setCursorPosition(lineEnd);
			triggerUpdate();
			return;
		}

		// Ctrl+G - 使用外部编辑器编辑输入内容（Windows: Notepad）
		if (key.ctrl && input === 'g') {
			flushPendingInput();

			// 非 Windows 平台安全降级：吞掉快捷键但不执行任何操作
			if (process.platform !== 'win32') {
				return;
			}

			const initialText = buffer.getFullText();

			// useInput 回调不是 async，这里用 Promise 链处理。
			editTextWithNotepad(initialText)
				.then(editedText => {
					// 完全覆盖输入：先清空以清理占位符/图片残留，再恢复文本（避免触发 [Paste ...]）
					buffer.setText('');
					if (editedText) {
						buffer.insertRestoredText(editedText);
						buffer.setCursorPosition(editedText.length);
					} else {
						buffer.setCursorPosition(0);
					}
					forceStateUpdate();
				})
				.catch(() => {
					// 失败时不阻断输入，只做一次刷新避免 UI 卡住
					forceStateUpdate();
				});

			return;
		}

		// Ctrl+O - Copy current input content to system clipboard
		if (key.ctrl && input === 'o') {
			flushPendingInput();
			const contentToCopy = buffer.getFullText();
			void copyToClipboard(contentToCopy)
				.then(() => {
					onCopyInputSuccess?.();
				})
				.catch(error => {
					console.error('Failed to copy current input to clipboard:', error);
					onCopyInputError?.(
						error instanceof Error ? error.message : 'Unknown error',
					);
				});
			return;
		}

		// Alt+F - Forward one word
		if (key.meta && input === 'f') {
			flushPendingInput();
			const text = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			const newPos = findWordBoundary(text, cursorPos, 'forward');
			buffer.setCursorPosition(newPos);
			triggerUpdate();
			return;
		}

		// Ctrl+K - Delete from cursor to end of line (readline compatible)
		if (key.ctrl && input === 'k') {
			flushPendingInput();
			const text = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			// Find end of current line
			let lineEnd = text.indexOf('\n', cursorPos);
			if (lineEnd === -1) lineEnd = text.length;
			// Delete from cursor to end of line
			const beforeCursor = text.slice(0, cursorPos);
			const afterLine = text.slice(lineEnd);
			buffer.setText(beforeCursor + afterLine);
			forceStateUpdate();
			return;
		}

		// Ctrl+U - Delete from cursor to beginning of line (readline compatible)
		if (key.ctrl && input === 'u') {
			flushPendingInput();
			const text = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			// Find start of current line
			const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
			// Delete from line start to cursor
			const beforeLine = text.slice(0, lineStart);
			const afterCursor = text.slice(cursorPos);
			buffer.setText(beforeLine + afterCursor);
			buffer.setCursorPosition(lineStart);
			forceStateUpdate();
			return;
		}

		// Ctrl+W - Delete word before cursor
		if (key.ctrl && input === 'w') {
			flushPendingInput();
			const text = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			const wordStart = findWordBoundary(text, cursorPos, 'backward');
			// Delete from word start to cursor
			const beforeWord = text.slice(0, wordStart);
			const afterCursor = text.slice(cursorPos);
			buffer.setText(beforeWord + afterCursor);
			buffer.setCursorPosition(wordStart);
			forceStateUpdate();
			return;
		}

		// Ctrl+D - Delete character at cursor (readline compatible)
		if (key.ctrl && input === 'd') {
			flushPendingInput();
			const text = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			if (cursorPos < text.length) {
				const beforeCursor = text.slice(0, cursorPos);
				const afterChar = text.slice(cursorPos + 1);
				buffer.setText(beforeCursor + afterChar);
				forceStateUpdate();
			}
			return;
		}

		// Ctrl+L - Clear from cursor to beginning (legacy, kept for compatibility)
		if (key.ctrl && input === 'l') {
			flushPendingInput();
			const displayText = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			const afterCursor = displayText.slice(cursorPos);

			buffer.setText(afterCursor);
			forceStateUpdate();
			return;
		}

		// Ctrl+R - Clear from cursor to end (legacy, kept for compatibility)
		if (key.ctrl && input === 'r') {
			flushPendingInput();
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
			lastPasteShortcutAt.current = Date.now();
			pasteFromClipboard();
			return;
		}

		// Delete key - delete character after cursor
		// Detected via raw stdin listener because ink doesn't distinguish Delete from Backspace
		if (deleteKeyPressed.current) {
			deleteKeyPressed.current = false;
			flushPendingInput();
			buffer.delete();
			forceStateUpdate();
			return;
		}

		// Backspace - delete character before cursor
		// Check both ink's key detection and raw input codes
		const isBackspace =
			key.backspace || key.delete || input === '\x7f' || input === '\x08';
		if (isBackspace) {
			flushPendingInput();
			buffer.backspace();
			forceStateUpdate();
			return;
		}

		// Handle file picker navigation
		if (showFilePicker) {
			// Up arrow in file picker - 循环导航:第一项 → 最后一项
			if (key.upArrow) {
				setFileSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, filteredFileCount - 1),
				);
				return;
			}

			// Down arrow in file picker - 循环导航:最后一项 → 第一项
			if (key.downArrow) {
				const maxIndex = Math.max(0, filteredFileCount - 1);
				setFileSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
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

			// Up arrow in command panel - 循环导航:第一项 → 最后一项
			if (key.upArrow) {
				setCommandSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, filteredCommands.length - 1),
				);
				return;
			}

			// Down arrow in command panel - 循环导航:最后一项 → 第一项
			if (key.downArrow) {
				const maxIndex = Math.max(0, filteredCommands.length - 1);
				setCommandSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
				return;
			}

			// Tab - autocomplete command to input
			if (key.tab) {
				if (
					filteredCommands.length > 0 &&
					commandSelectedIndex < filteredCommands.length
				) {
					const selectedCommand = filteredCommands[commandSelectedIndex];
					if (selectedCommand) {
						// Replace input with "/" + selected command name
						buffer.setText('/' + selectedCommand.name);
						// Move cursor to end
						buffer.setCursorPosition(buffer.text.length);
						// Close command panel
						setShowCommands(false);
						setCommandSelectedIndex(0);
						triggerUpdate();
						return;
					}
				}
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
						// Special handling for skills- command
						if (selectedCommand.name === 'skills-') {
							buffer.setText('');
							setShowCommands(false);
							setCommandSelectedIndex(0);
							setShowSkillsPicker(true);
							triggerUpdate();
							return;
						}
						if (selectedCommand.name === 'gitline') {
							buffer.setText('');
							setShowCommands(false);
							setCommandSelectedIndex(0);
							setShowGitLinePicker(true);
							triggerUpdate();
							return;
						}
						// Block command execution if AI is processing

						if (isProcessing && getAllCommands) {
							const matchedCommand = getAllCommands().find(
								cmd => cmd.name === selectedCommand.name,
							);
							if (matchedCommand && matchedCommand.type !== 'prompt') {
								// Keep non-prompt commands blocked while AI is already processing.
								buffer.setText('');
								setShowCommands(false);
								setCommandSelectedIndex(0);
								triggerUpdate();
								return;
							}
						}

						// Execute command instead of inserting text
						// If the user has typed args after the command name (e.g. "/role -l"),
						// pass them through so sub-commands work from the command panel.
						const fullText = buffer.getFullText();
						const commandMatch = fullText.match(/^\/([^\s]+)(?:\s+(.+))?$/);
						const commandArgs = commandMatch?.[2];
						executeCommand(selectedCommand.name, commandArgs).then(result => {
							// Record command usage for frequency-based sorting
							commandUsageManager.recordUsage(selectedCommand.name);
							if (onCommand) {
								// Ensure onCommand errors are caught
								Promise.resolve(onCommand(selectedCommand.name, result)).catch(
									error => {
										console.error('Command execution error:', error);
									},
								);
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

		// Ctrl+Enter - Insert newline
		if (key.ctrl && key.return) {
			flushPendingInput();
			buffer.insert('\n');
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateCommandPanelState(text);
			updateFilePickerState(text, cursorPos);
			updateAgentPickerState(text, cursorPos);
			updateRunningAgentsPickerState(text, cursorPos);
			return;
		}

		// Enter - submit message or insert newline after '/'
		if (key.return) {
			flushPendingInput();
			// Prevent submission if multi-char input (paste/IME) is still being processed
			if (isProcessingInput.current) {
				return; // Ignore Enter key while processing
			}

			// Check if we should insert newline instead of submitting
			// Condition: If text ends with '/' and there's non-whitespace content before it
			const fullText = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();

			// Check if cursor is right after a '/' character
			if (cursorPos > 0 && fullText[cursorPos - 1] === '/') {
				// Find the text before '/' (ignoring the '/' itself)
				const textBeforeSlash = fullText.slice(0, cursorPos - 1);

				// If there's any non-whitespace content before '/', insert newline
				// This prevents conflict with command panel trigger at line start
				if (textBeforeSlash.trim().length > 0) {
					buffer.insert('\n');
					const text = buffer.getFullText();
					const newCursorPos = buffer.getCursorPosition();
					updateCommandPanelState(text);
					updateFilePickerState(text, newCursorPos);
					updateAgentPickerState(text, newCursorPos);
					updateRunningAgentsPickerState(text, newCursorPos);
					return;
				}
			}

			// Reset history navigation on submit
			if (currentHistoryIndex !== -1) {
				resetHistoryNavigation();
			}

			const message = buffer.getFullText().trim();
			const markedMessage = buffer.hasTextPlaceholders()
				? buffer.getFullTextWithPasteMarkers().trim()
				: message;
			if (message) {
				// Check if message is a command with arguments (e.g., /review [note])
				if (message.startsWith('/')) {
					// Support namespaced slash commands like /folder:command
					const commandMatch = message.match(/^\/([^\s]+)(?:\s+(.+))?$/);
					if (commandMatch && commandMatch[1]) {
						const commandName = commandMatch[1];
						const commandArgs = commandMatch[2];

						// Special handling for picker-style commands.
						// These commands are UI interactions and should open the picker panel
						// instead of going through the generic command execution flow.
						if (commandName === 'todo-' && !commandArgs) {
							buffer.setText('');
							setShowCommands(false);
							setCommandSelectedIndex(0);
							setShowTodoPicker(true);
							triggerUpdate();
							return;
						}
						if (commandName === 'agent-' && !commandArgs) {
							buffer.setText('');
							setShowCommands(false);
							setCommandSelectedIndex(0);
							setShowAgentPicker(true);
							triggerUpdate();
							return;
						}
						if (commandName === 'skills-' && !commandArgs) {
							buffer.setText('');
							setShowCommands(false);
							setCommandSelectedIndex(0);
							setShowSkillsPicker(true);
							triggerUpdate();
							return;
						}
						if (commandName === 'gitline' && !commandArgs) {
							buffer.setText('');
							setShowCommands(false);
							setCommandSelectedIndex(0);
							setShowGitLinePicker(true);
							triggerUpdate();
							return;
						}

						// Block command execution if AI is processing

						if (isProcessing && getAllCommands) {
							const matchedCommand = getAllCommands().find(
								cmd => cmd.name === commandName,
							);
							if (matchedCommand && matchedCommand.type !== 'prompt') {
								// Keep non-prompt commands blocked while AI is already processing.
								buffer.setText('');
								triggerUpdate();
								return;
							}
						}

						// Execute command with arguments
						executeCommand(commandName, commandArgs).then(result => {
							// If command is unknown, send the original message as a normal message
							if (result.action === 'sendAsMessage') {
								// Get images data for the message
								const currentText = buffer.text;
								const allImages = buffer.getImages();
								const validImages = allImages
									.filter(img => currentText.includes(img.placeholder))
									.map(img => ({
										data: img.data,
										mimeType: img.mimeType,
									}));

								// Save to persistent history
								saveToHistory(message);

								// Send as normal message (use marked version to preserve paste boundaries)
								onSubmit(
									markedMessage,
									validImages.length > 0 ? validImages : undefined,
								);
								return;
							}

							// Record command usage for frequency-based sorting
							commandUsageManager.recordUsage(commandName);
							if (onCommand) {
								// Ensure onCommand errors are caught
								Promise.resolve(onCommand(commandName, result)).catch(error => {
									console.error('Command execution error:', error);
								});
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

				onSubmit(
					markedMessage,
					validImages.length > 0 ? validImages : undefined,
				);
			}
			return;
		}

		// Arrow keys for cursor movement
		if (key.leftArrow) {
			flushPendingInput();

			buffer.moveLeft();
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateFilePickerState(text, cursorPos);
			updateAgentPickerState(text, cursorPos);
			updateRunningAgentsPickerState(text, cursorPos);
			// No need to call triggerUpdate() - buffer.moveLeft() already triggers update via scheduleUpdate()
			return;
		}

		if (key.rightArrow) {
			flushPendingInput();

			buffer.moveRight();
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateFilePickerState(text, cursorPos);
			updateAgentPickerState(text, cursorPos);
			updateRunningAgentsPickerState(text, cursorPos);
			// No need to call triggerUpdate() - buffer.moveRight() already triggers update via scheduleUpdate()
			return;
		}

		if (
			key.upArrow &&
			!showCommands &&
			!showFilePicker &&
			!disableKeyboardNavigation
		) {
			flushPendingInput();

			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			const isEmpty = text.trim() === '';
			const hasMultipleVisualLines = buffer.viewportVisualLines.length > 1;

			// For multi-line content, always prioritize cursor movement over history navigation.
			// Only use history navigation when the input is single-line (or empty) and cursor is at position 0.
			if (!hasMultipleVisualLines && (isEmpty || cursorPos === 0)) {
				const navigated = navigateHistoryUp();
				if (navigated) {
					updateFilePickerState(
						buffer.getFullText(),
						buffer.getCursorPosition(),
					);
					updateAgentPickerState(
						buffer.getFullText(),
						buffer.getCursorPosition(),
					);
					updateRunningAgentsPickerState(
						buffer.getFullText(),
						buffer.getCursorPosition(),
					);
					triggerUpdate();
					return;
				}
			}

			buffer.moveUp();
			updateFilePickerState(buffer.getFullText(), buffer.getCursorPosition());
			updateAgentPickerState(buffer.getFullText(), buffer.getCursorPosition());
			updateRunningAgentsPickerState(
				buffer.getFullText(),
				buffer.getCursorPosition(),
			);
			triggerUpdate();
			return;
		}

		if (
			key.downArrow &&
			!showCommands &&
			!showFilePicker &&
			!disableKeyboardNavigation
		) {
			flushPendingInput();

			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			const isEmpty = text.trim() === '';
			const hasMultipleVisualLines = buffer.viewportVisualLines.length > 1;

			// For multi-line content, always prioritize cursor movement over history navigation.
			// Only use history navigation when the input is single-line (or empty),
			// cursor is at the end, and we're already in history mode.
			if (
				!hasMultipleVisualLines &&
				(isEmpty || cursorPos === text.length) &&
				currentHistoryIndex !== -1
			) {
				const navigated = navigateHistoryDown();
				if (navigated) {
					updateFilePickerState(
						buffer.getFullText(),
						buffer.getCursorPosition(),
					);
					updateAgentPickerState(
						buffer.getFullText(),
						buffer.getCursorPosition(),
					);
					updateRunningAgentsPickerState(
						buffer.getFullText(),
						buffer.getCursorPosition(),
					);
					triggerUpdate();
					return;
				}
			}

			buffer.moveDown();
			updateFilePickerState(buffer.getFullText(), buffer.getCursorPosition());
			updateAgentPickerState(buffer.getFullText(), buffer.getCursorPosition());
			updateRunningAgentsPickerState(
				buffer.getFullText(),
				buffer.getCursorPosition(),
			);
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

			const now = Date.now();
			const isPasteShortcutActive =
				now - lastPasteShortcutAt.current <= pasteShortcutTimeoutMs;

			// ink 在 IME 场景下可能一次性提交多个字符（通常很短），这不是“粘贴”。
			// 如果仍按“多字符=粘贴/IME，延迟缓冲”处理，用户在提交前移动光标会让插入位置/显示状态产生竞态，
			// 表现为光标插入错位、内容渲染像“总是显示末尾”。
			// 因此：短的多字符输入直接落盘；只对明显的粘贴/大输入走缓冲。
			const isSingleCharInput = input.length === 1;
			const isSmallMultiCharInput = input.length > 1 && !input.includes('\n');

			// 单字符：正常键入，直接插入
			if (isSingleCharInput && !isProcessingInput.current) {
				// This prevents the "disappearing text" issue at line start
				buffer.insert(input);
				const text = buffer.getFullText();
				const cursorPos = buffer.getCursorPosition();
				updateCommandPanelState(text);
				updateFilePickerState(text, cursorPos);
				updateAgentPickerState(text, cursorPos);
				updateRunningAgentsPickerState(text, cursorPos);
				return;
			}

			// IME commit / 小段粘贴（无换行、长度不大）统一直接落盘，避免进入 100ms 缓冲。
			// 这能避免“先移动光标再输入”场景下仍走缓冲，导致插入位置/内容被错误合并。
			if (
				isSmallMultiCharInput &&
				!isProcessingInput.current &&
				!isPasteShortcutActive
			) {
				flushPendingInput();
				buffer.insert(input);
				const text = buffer.getFullText();
				const cursorPos = buffer.getCursorPosition();
				updateCommandPanelState(text);
				updateFilePickerState(text, cursorPos);
				updateAgentPickerState(text, cursorPos);
				updateRunningAgentsPickerState(text, cursorPos);
				return;
			}

			// 其余（含换行/已有缓冲会话/大段输入）：使用缓冲机制
			// Save cursor position when starting new input accumulation
			const isStartingNewInput = inputBuffer.current === '';
			if (isStartingNewInput) {
				inputStartCursorPos.current = buffer.getCursorPosition();
				isProcessingInput.current = true; // Mark that we're processing multi-char input
				inputSessionId.current += 1;
			}

			// Accumulate input for paste detection
			inputBuffer.current += input;

			// Clear existing timer
			if (inputTimer.current) {
				clearTimeout(inputTimer.current);
			}

			const activeSessionId = inputSessionId.current;
			const currentLength = inputBuffer.current.length;
			const shouldShowIndicator =
				isPasteShortcutActive || currentLength > pasteIndicatorThreshold;

			// Show pasting indicator for large text or explicit paste
			// Simple static message - no progress animation
			if (shouldShowIndicator && !isPasting.current) {
				isPasting.current = true;
				buffer.insertPastingIndicator();
				// Trigger UI update to show the indicator
				const text = buffer.getFullText();
				const cursorPos = buffer.getCursorPosition();
				updateCommandPanelState(text);
				updateFilePickerState(text, cursorPos);
				updateAgentPickerState(text, cursorPos);
				updateRunningAgentsPickerState(text, cursorPos);
				triggerUpdate();
			}

			// Set timer to process accumulated input
			const flushDelay = isPasteShortcutActive
				? pasteShortcutTimeoutMs
				: pasteFlushDebounceMs;
			inputTimer.current = setTimeout(() => {
				if (activeSessionId !== inputSessionId.current) {
					return;
				}

				const accumulated = inputBuffer.current;
				const savedCursorPosition = inputStartCursorPos.current;
				const wasPasting = isPasting.current; // Save pasting state before clearing

				inputBuffer.current = '';
				isPasting.current = false; // Reset pasting state
				isProcessingInput.current = false; // Reset processing flag

				// If we accumulated input, insert it at the saved cursor position
				// The insert() method will automatically remove the pasting indicator
				if (accumulated) {
					// Get current cursor position to calculate if user moved cursor during input
					const currentCursor = buffer.getCursorPosition();

					// If cursor hasn't moved from where we started (or only moved due to pasting indicator),
					// insert at the saved position
					// Otherwise, insert at current position (user deliberately moved cursor)
					// Note: wasPasting check uses saved state, not current isPasting.current
					if (
						currentCursor === savedCursorPosition ||
						(wasPasting && currentCursor > savedCursorPosition)
					) {
						// Temporarily set cursor to saved position for insertion
						// This is safe because we're in a timeout, not during active cursor movement
						buffer.setCursorPosition(savedCursorPosition);
						buffer.insert(accumulated);
						// No need to restore cursor - insert() moves it naturally
					} else {
						// User moved cursor during input, insert at current position
						buffer.insert(accumulated);
					}

					// Reset inputStartCursorPos after processing to prevent stale position
					inputStartCursorPos.current = buffer.getCursorPosition();

					const text = buffer.getFullText();
					const cursorPos = buffer.getCursorPosition();
					updateCommandPanelState(text);
					updateFilePickerState(text, cursorPos);
					updateAgentPickerState(text, cursorPos);
					updateRunningAgentsPickerState(text, cursorPos);
					triggerUpdate();
				}
			}, flushDelay);
		}
	});
}
