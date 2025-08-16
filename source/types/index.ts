export interface AIBotConfig {
	model?: string;
	apiKey?: string;
	maxTokens?: number;
}

export interface Command {
	name: string;
	description: string;
	handler: (args: string[]) => Promise<void>;
}

export interface AppState {
	isLoading: boolean;
	currentCommand?: string;
	history: string[];
}