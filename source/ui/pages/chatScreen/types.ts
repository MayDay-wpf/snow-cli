export type PendingMessageInput = {
	text: string;
	images?: Array<{data: string; mimeType: string}>;
};

export type InputImage = {
	type: 'image';
	data: string;
	mimeType: string;
};

export type RestoreInputContent = {
	text: string;
	images?: InputImage[];
} | null;

export type DraftContent = RestoreInputContent;

export type BashSensitiveCommandState = {
	command: string;
	resolve: (proceed: boolean) => void;
} | null;

export type CustomCommandExecutionState = {
	commandName: string;
	command: string;
	isRunning: boolean;
	output: string[];
	exitCode?: number | null;
	error?: string;
} | null;

export type PendingUserQuestionResult = {
	selected: string | string[];
	customInput?: string;
	cancelled?: boolean;
};

export type PendingUserQuestionState = {
	question: string;
	options: string[];
	toolCall: any;
	resolve: (result: PendingUserQuestionResult) => void;
} | null;

export type CodebaseProgressState = {
	totalFiles: number;
	processedFiles: number;
	totalChunks: number;
	currentFile: string;
	status: string;
	error?: string;
} | null;

export type FileUpdateNotificationState = {
	file: string;
	timestamp: number;
} | null;

/**
 * 焦点覆盖层类型 — 同一时刻只渲染一个阻塞式对话框。
 * 优先级从高到低: user-question > bash-sensitive-command > tool-confirmation
 */
export type FocusedOverlay =
	| 'user-question'
	| 'bash-sensitive-command'
	| 'tool-confirmation'
	| null;

/**
 * 根据当前状态决定哪个阻塞式对话框应该获得焦点。
 * 非阻塞状态显示(ThinkingStatus/CompressionStatus 等)不受此影响,可共存。
 */
export function getFocusedOverlay(state: {
	pendingUserQuestion: PendingUserQuestionState;
	bashSensitiveCommand: BashSensitiveCommandState;
	pendingToolConfirmation: unknown;
}): FocusedOverlay {
	// 最高优先级: 交互式用户问题,阻塞一切
	if (state.pendingUserQuestion) return 'user-question';
	// 次高: 敏感 bash 命令确认(阻塞式)
	if (state.bashSensitiveCommand) return 'bash-sensitive-command';
	// 最低: 工具调用确认
	if (state.pendingToolConfirmation) return 'tool-confirmation';
	return null;
}
