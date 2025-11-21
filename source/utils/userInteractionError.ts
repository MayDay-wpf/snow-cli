/**
 * Error thrown when a tool requires user interaction
 * This special error should be caught and handled by the UI layer
 */
export class UserInteractionNeededError extends Error {
	public readonly question: string;
	public readonly options: string[];
	public readonly toolCallId: string;

	constructor(question: string, options: string[], toolCallId: string = '') {
		super('User interaction needed');
		this.name = 'UserInteractionNeededError';
		this.question = question;
		this.options = options;
		this.toolCallId = toolCallId;
	}
}

export interface UserInteractionResponse {
	selected: string;
	customInput?: string;
}
