import type {MCPTool} from '../utils/execution/mcpToolsManager.js';

export interface AskUserQuestionArgs {
	question: string;
	options: string[];
}

export interface AskUserQuestionResult {
	selected: string | string[];
	customInput?: string;
}

export const mcpTools: MCPTool[] = [
	{
		type: 'function',
		function: {
			name: 'askuser-ask_question',
			description:
				'Ask the user a concise, focused question with multiple choice options to clarify requirements. Keep wording short and centered on one decision point. The AI workflow pauses until the user selects an option or provides custom input. Use this when you need user input to continue processing. Supports both single and multiple selection - user can choose one or more options.',
			parameters: {
				type: 'object',
				properties: {
					question: {
						type: 'string',
						description:
							'The question to ask the user. Keep it short, focused, and specific. Avoid long-winded wording and ask only for the key information needed.',
					},
					options: {
						type: 'array',
						items: {
							type: 'string',
						},
						description:
							'Array of option strings for the user to choose from. Should be concise and clear. User can select one or multiple options.',
						minItems: 2,
					},
				},
				required: ['question', 'options'],
			},
		},
	},
];

// This will be handled by a special UI component, not a service
// The actual execution happens in mcpToolsManager.ts with user interaction
