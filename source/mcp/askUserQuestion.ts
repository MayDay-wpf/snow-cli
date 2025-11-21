import type {MCPTool} from '../utils/mcpToolsManager.js';

export interface AskUserQuestionArgs {
	question: string;
	options: string[];
}

export interface AskUserQuestionResult {
	selected: string;
	customInput?: string;
}

export const mcpTools: MCPTool[] = [
	{
		type: 'function',
		function: {
			name: 'askuser-ask_question',
			description:
				'Ask the user a question with multiple choice options to clarify requirements. The AI workflow pauses until the user selects an option or provides custom input. Use this when you need user input to continue processing.',
			parameters: {
				type: 'object',
				properties: {
					question: {
						type: 'string',
						description:
							'The question to ask the user. Be clear and specific about what information you need.',
					},
					options: {
						type: 'array',
						items: {
							type: 'string',
						},
						description:
							'Array of option strings for the user to choose from. Should be concise and clear.',
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
