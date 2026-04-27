import type {Key} from 'ink';
import type React from 'react';
import {TextBuffer} from '../../../utils/ui/textBuffer.js';
import type {SubAgent} from '../../../utils/config/subAgentConfig.js';

export type KeyboardInputOptions = {
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
		triggerDeeperSearch: () => boolean;
	} | null>;

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
	/**
	 * 在 ProfilePanel 中按右方向键时调用：进入 ProfileEditPanel 编辑该 profile。
	 * 可选：未提供时按右方向键无效（向后兼容）。
	 */
	handleProfileEdit?: (profileName: string) => void;
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
	// Command args picker
	showArgsPicker: boolean;
	setShowArgsPicker: (show: boolean) => void;
	argsSelectedIndex: number;
	setArgsSelectedIndex: (index: number | ((prev: number) => number)) => void;
	argsPickerContext: {commandName: string; options: string[]};
};

export type HandlerRefs = {
	inputBuffer: React.MutableRefObject<string>;
	inputTimer: React.MutableRefObject<NodeJS.Timeout | null>;
	isPasting: React.MutableRefObject<boolean>;
	inputStartCursorPos: React.MutableRefObject<number>;
	isProcessingInput: React.MutableRefObject<boolean>;
	inputSessionId: React.MutableRefObject<number>;
	lastPasteShortcutAt: React.MutableRefObject<number>;
	componentMountTime: React.MutableRefObject<number>;
	deleteKeyPressed: React.MutableRefObject<boolean>;
};

export type HandlerHelpers = {
	forceStateUpdate: () => void;
	flushPendingInput: () => void;
	findWordBoundary: (
		text: string,
		start: number,
		direction: 'forward' | 'backward',
	) => number;
};

export type HandlerContext = {
	input: string;
	key: Key;
	buffer: TextBuffer;
	options: KeyboardInputOptions;
	refs: HandlerRefs;
	helpers: HandlerHelpers;
};
