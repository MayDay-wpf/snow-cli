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
