import type {Language} from '../../../../utils/config/languageConfig.js';

export type VSCodeConnectionStatus =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'error';

export type BackendConnectionStatus =
	| 'disconnected'
	| 'connecting'
	| 'connected'
	| 'reconnecting';

export interface StatusLineRenderItem {
	id?: string;
	text: string;
	detailedText?: string;
	color?: string;
	priority?: number;
}

export interface StatusLineLabels {
	gitBranch: string;
}

export interface StatusLineEditorContext {
	activeFile?: string;
	selectedText?: string;
	cursorPosition?: {line: number; character: number};
	workspaceFolder?: string;
}

export interface StatusLineContextUsage {
	inputTokens: number;
	maxContextTokens: number;
	cacheCreationTokens?: number;
	cacheReadTokens?: number;
	cachedTokens?: number;
}

export interface StatusLineCodebaseProgress {
	totalFiles: number;
	processedFiles: number;
	totalChunks: number;
	currentFile?: string;
	status?: string;
	error?: string;
}

export interface StatusLineFileUpdateNotification {
	file: string;
	timestamp: number;
}

export interface StatusLineCopyStatusMessage {
	text: string;
	isError?: boolean;
	timestamp: number;
}

export interface StatusLineContextWindowMetrics {
	percentage: number;
	totalInputTokens: number;
	hasAnthropicCache: boolean;
	hasOpenAICache: boolean;
	hasAnyCache: boolean;
}

export interface StatusLineSystemState {
	memory: {
		usageMb: number;
		formattedUsage: string;
	};
	modes: {
		yolo: boolean;
		plan: boolean;
		vulnerabilityHunting: boolean;
		toolSearchEnabled: boolean;
		simple: boolean;
	};
	ide: {
		connectionStatus: VSCodeConnectionStatus;
		editorContext?: StatusLineEditorContext;
		selectedTextLength: number;
	};
	backend: {
		connectionStatus: BackendConnectionStatus;
		instanceName?: string;
	};
	contextWindow?: StatusLineContextUsage & StatusLineContextWindowMetrics;
	codebase: {
		indexing: boolean;
		progress?: StatusLineCodebaseProgress | null;
	};
	watcher: {
		enabled: boolean;
		fileUpdateNotification?: StatusLineFileUpdateNotification | null;
	};
	clipboard?: StatusLineCopyStatusMessage | null;
	profile: {
		currentName?: string;
		baseUrl?: string;
		requestMethod?: string;
		advancedModel?: string;
		basicModel?: string;
		maxContextTokens?: number;
		maxTokens?: number;
		anthropicBeta?: boolean;
		anthropicCacheTTL?: string;
		thinkingEnabled?: boolean;
		thinkingType?: string;
		thinkingBudgetTokens?: number;
		thinkingEffort?: string;
		geminiThinkingEnabled?: boolean;
		geminiThinkingBudget?: number;
		responsesReasoningEnabled?: boolean;
		responsesReasoningEffort?: string;
		responsesFastMode?: boolean;
		responsesVerbosity?: string;
		anthropicSpeed?: string;
		enablePromptOptimization?: boolean;
		enableAutoCompress?: boolean;
		autoCompressThreshold?: number;
		showThinking?: boolean;
		streamIdleTimeoutSec?: number;
		systemPromptId?: string | string[];
		customHeadersSchemeId?: string;
		editSimilarityThreshold?: number;
		toolResultTokenLimit?: number;
		streamingDisplay?: boolean;
	};
	compression: {
		blockToast?: string | null;
	};
}

export interface StatusLineHookContext {
	cwd: string;
	platform: NodeJS.Platform;
	language: Language;
	simpleMode: boolean;
	labels: StatusLineLabels;
	system: StatusLineSystemState;
}

export interface StatusLineHookDefinition {
	id: string;
	refreshIntervalMs?: number;
	enable?: boolean;
	getItems: (
		context: StatusLineHookContext,
	) =>
		| StatusLineRenderItem
		| StatusLineRenderItem[]
		| undefined
		| null
		| Promise<StatusLineRenderItem | StatusLineRenderItem[] | undefined | null>;
}
