import * as signalR from '@microsoft/signalr';

export type ConnectionStatus =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'reconnecting';

export interface ConnectionConfig {
	apiUrl: string;
	username: string;
	password: string;
	instanceId: string;
	instanceName: string;
}

export interface ConnectionState {
	status: ConnectionStatus;
	instanceId?: string;
	instanceName?: string;
	token?: string;
	error?: string;
}

export type StatusChangeCallback = (state: ConnectionState) => void;
export type MessageCallback = (message: unknown) => void;

// In-flight interaction types
export interface PendingToolConfirmation {
	toolName: string;
	toolArguments: string;
	toolCallId: string;
}

export interface PendingQuestion {
	question: string;
	options: string[];
	toolCallId: string;
	multiSelect: boolean;
}

export interface PendingRollbackConfirmation {
	filePaths: string[];
	notebookCount: number;
}

export interface InFlightState {
	isMessageProcessing: boolean;
	pendingToolConfirmations: PendingToolConfirmation[];
	pendingQuestions: PendingQuestion[];
	pendingRollbackConfirmation: PendingRollbackConfirmation | null;
}

// SignalR message type handlers
export interface SignalRMessageHandlers {
	instanceconnected: (message: unknown) => void;
	instancedisconnected: (message: unknown) => void;
	requestcontextinfo: () => Promise<void>;
	receivecontextinfo: (contextData: string) => void;
	receivemessage: (message: string) => void;
	receivetoolconfirmationresult: (result: {
		toolCallId: string;
		result: 'approve' | 'approve_always' | 'reject' | 'reject_with_reply';
		reason?: string;
	}) => void;
	receiveuserquestionresult: (result: {
		toolCallId: string;
		selected: string;
		customInput?: string;
		cancelled?: boolean;
	}) => void;
	receivemessageprocessingcompleted: (instanceId: string) => void;
	receiveinterruptmessageprocessing: () => void;
	receiveclearsession: () => void;
	receiveforceoffline: () => void;
	receiverollbackmessage: (userMessageOrder: number) => void;
	receiveresumesession: (sessionId: string) => void;
	receiverollbackconfirmationresult: (result: {
		rollbackFiles?: boolean | null;
		rollbackMode?: 'conversation' | 'both' | 'files';
		selectedFiles?: string[];
	}) => void;
	receivefilelistrequest: (requestId: string) => Promise<void>;
	receivesessionlistrequest: (
		requestId: string,
		page: number,
		pageSize: number,
		searchQuery: string,
	) => Promise<void>;
}

// Context info message structure
export interface ContextInfoMessage {
	role: string;
	content: string;
	timestamp: number;
	tool_calls?: Array<{
		id: string;
		type: string;
		function: {
			name: string;
			arguments: string;
		};
	}>;
	tool_call_id?: string;
}

export interface TokenUsageInfo {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
	cached_tokens?: number;
	percentage?: number;
	max_tokens?: number;
}

export interface ContextInfo {
	sessionId: string;
	sessionTitle: string;
	messageCount: number;
	messages: ContextInfoMessage[];
	inFlightState: InFlightState;
	tokenUsage?: TokenUsageInfo;
	timestamp: string;
	error?: string;
}

// Re-export signalR for convenience
export {signalR};
