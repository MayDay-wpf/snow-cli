import type {ConfirmationResult} from '../../../ui/components/tools/ToolConfirmation.js';
import type {CompressionStatus} from '../../../ui/components/compression/CompressionStatus.js';
import type {Message} from '../../../ui/components/chat/MessageList.js';
import type {ToolCall} from '../../../utils/execution/toolExecutor.js';

export type UserQuestionResult = {
	selected: string | string[];
	customInput?: string;
};

export type ConversationUsage = {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
	cached_tokens?: number;
};

export type ConversationHandlerOptions = {
	userContent: string;
	editorContext?: {
		workspaceFolder?: string;
		activeFile?: string;
		cursorPosition?: {line: number; character: number};
		selectedText?: string;
	};
	imageContents:
		| Array<{type: 'image'; data: string; mimeType: string}>
		| undefined;
	controller: AbortController;
	messages: Message[];
	saveMessage: (message: any) => Promise<void>;
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
	setStreamTokenCount: React.Dispatch<React.SetStateAction<number>>;
	requestToolConfirmation: (
		toolCall: ToolCall,
		batchToolNames?: string,
		allTools?: ToolCall[],
	) => Promise<ConfirmationResult>;
	requestUserQuestion: (
		question: string,
		options: string[],
		toolCall: ToolCall,
		multiSelect?: boolean,
	) => Promise<UserQuestionResult>;
	isToolAutoApproved: (toolName: string) => boolean;
	addMultipleToAlwaysApproved: (toolNames: string[]) => void;
	yoloModeRef: React.MutableRefObject<boolean>;
	planMode?: boolean;
	vulnerabilityHuntingMode?: boolean;
	toolSearchDisabled?: boolean;
	setContextUsage: React.Dispatch<React.SetStateAction<any>>;
	useBasicModel?: boolean;
	getPendingMessages?: () => Array<{
		text: string;
		images?: Array<{data: string; mimeType: string}>;
	}>;
	clearPendingMessages?: () => void;
	setIsStreaming?: React.Dispatch<React.SetStateAction<boolean>>;
	setIsReasoning?: React.Dispatch<React.SetStateAction<boolean>>;
	setRetryStatus?: React.Dispatch<
		React.SetStateAction<{
			isRetrying: boolean;
			attempt: number;
			nextDelay: number;
			remainingSeconds?: number;
			errorMessage?: string;
		} | null>
	>;
	clearSavedMessages?: () => void;
	setRemountKey?: React.Dispatch<React.SetStateAction<number>>;
	setSnapshotFileCount?: React.Dispatch<
		React.SetStateAction<Map<number, number>>
	>;
	getCurrentContextPercentage?: () => number;
	setCurrentModel?: React.Dispatch<React.SetStateAction<string | null>>;
	onCompressionStatus?: (status: CompressionStatus | null) => void;
	setIsAutoCompressing?: (value: boolean) => void;
};

export type TokenEncoder = {
	encode: (text: string) => number[];
};

export type StreamRoundResult = {
	streamedContent: string;
	receivedToolCalls: ToolCall[] | undefined;
	receivedReasoning: any;
	receivedThinking:
		| {type: 'thinking'; thinking: string; signature?: string}
		| undefined;
	receivedReasoningContent: string | undefined;
	roundUsage: ConversationUsage | null;
	hasStreamedLines: boolean;
};

export type ToolCallRoundResult =
	| {type: 'continue'; accumulatedUsage?: ConversationUsage | null}
	| {type: 'break'; accumulatedUsage?: ConversationUsage | null}
	| {type: 'return'; accumulatedUsage: ConversationUsage | null};
