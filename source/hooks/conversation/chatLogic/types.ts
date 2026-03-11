import type {Message} from '../../../ui/components/chat/MessageList.js';

export type {Message};

export interface UseChatLogicProps {
	messages: Message[];
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	pendingMessages: Array<{
		text: string;
		images?: Array<{data: string; mimeType: string}>;
	}>;
	setPendingMessages: React.Dispatch<
		React.SetStateAction<
			Array<{text: string; images?: Array<{data: string; mimeType: string}>}>
		>
	>;
	streamingState: any;
	vscodeState: any;
	snapshotState: any;
	bashMode: any;
	yoloMode: boolean;
	planMode: boolean;
	vulnerabilityHuntingMode: boolean;
	toolSearchDisabled: boolean;
	saveMessage: (msg: any) => Promise<void>;
	clearSavedMessages: () => void;
	setRemountKey: React.Dispatch<React.SetStateAction<number>>;
	requestToolConfirmation: any;
	requestUserQuestion: any;
	isToolAutoApproved: any;
	addMultipleToAlwaysApproved: any;
	setRestoreInputContent: React.Dispatch<
		React.SetStateAction<{
			text: string;
			images?: Array<{type: 'image'; data: string; mimeType: string}>;
		} | null>
	>;
	setIsCompressing: React.Dispatch<React.SetStateAction<boolean>>;
	setCompressionError: React.Dispatch<React.SetStateAction<string | null>>;
	currentContextPercentageRef: React.MutableRefObject<number>;
	userInterruptedRef: React.MutableRefObject<boolean>;
	pendingMessagesRef: React.MutableRefObject<
		Array<{text: string; images?: Array<{data: string; mimeType: string}>}>
	>;
	setBashSensitiveCommand: React.Dispatch<
		React.SetStateAction<{
			command: string;
			resolve: (proceed: boolean) => void;
		} | null>
	>;
	pendingUserQuestion: {
		question: string;
		options: string[];
		toolCall: any;
		resolve: (result: {
			selected: string | string[];
			customInput?: string;
			cancelled?: boolean;
		}) => void;
	} | null;
	setPendingUserQuestion: React.Dispatch<
		React.SetStateAction<{
			question: string;
			options: string[];
			toolCall: any;
			resolve: (result: {
				selected: string | string[];
				customInput?: string;
				cancelled?: boolean;
			}) => void;
		} | null>
	>;
	// Session panel handlers
	initializeFromSession: (messages: any[]) => void;
	setShowSessionPanel: (show: boolean) => void;
	setShowReviewCommitPanel: (show: boolean) => void;
	// Quit and reindex handlers
	codebaseAgentRef: React.MutableRefObject<any>;
	setCodebaseIndexing: React.Dispatch<React.SetStateAction<boolean>>;
	setCodebaseProgress: React.Dispatch<
		React.SetStateAction<{
			totalFiles: number;
			processedFiles: number;
			totalChunks: number;
			currentFile: string;
			status: string;
			error?: string;
		} | null>
	>;
	setFileUpdateNotification: React.Dispatch<
		React.SetStateAction<{
			file: string;
			timestamp: number;
		} | null>
	>;
	setWatcherEnabled: React.Dispatch<React.SetStateAction<boolean>>;
	exitingApplicationText: string;
	// New props for migrated logic
	commandsLoaded?: boolean;
	terminalExecutionState?: any;
	backgroundProcesses?: any;
	panelState?: any;
	setIsExecutingTerminalCommand?: React.Dispatch<React.SetStateAction<boolean>>;
	setHookError?: React.Dispatch<React.SetStateAction<any>>;
	hasFocus?: boolean;
	setSuppressLoadingIndicator?: React.Dispatch<React.SetStateAction<boolean>>;
	bashSensitiveCommand?: {
		command: string;
		resolve: (proceed: boolean) => void;
	} | null;
	handleCommandExecution?: (command: string, result: any) => void;
	// Tool confirmation state from useToolConfirmation hook
	pendingToolConfirmation?: {
		tool: {
			function: {
				name: string;
				arguments: string;
			};
		};
		allTools?: any[];
		batchToolNames?: string;
		resolve: (result: any) => void;
	} | null;
	// Scheduler execution state for ESC interrupt handling
	schedulerExecutionState?: {
		state: {
			isRunning: boolean;
			description: string | null;
			totalDuration: number;
			remainingSeconds: number;
			startedAt: string | null;
			isCompleted: boolean;
			completedAt: string | null;
		};
		resetTask: () => void;
	};
	onCompressionStatus?: (
		status:
			| import('../../../ui/components/compression/CompressionStatus.js').CompressionStatus
			| null,
	) => void;
}
