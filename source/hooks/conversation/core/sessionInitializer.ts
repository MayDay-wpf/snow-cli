import type {ChatMessage} from '../../../api/chat.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {getTodoService} from '../../../utils/execution/mcpToolsManager.js';
import {formatTodoContext} from '../../../utils/core/todoPreprocessor.js';
import {getSystemPromptForMode} from '../../../prompt/systemPrompt.js';

/**
 * Initialize conversation session and TODO context
 *
 * @param planMode - Plan mode flag
 * @param vulnerabilityHuntingMode - Vulnerability hunting mode flag
 * @returns Initialized conversation messages and session info
 */
export async function initializeConversationSession(
	planMode: boolean,
	vulnerabilityHuntingMode: boolean,
): Promise<{
	conversationMessages: ChatMessage[];
	currentSession: any;
	existingTodoList: any;
}> {
	// Step 1: Ensure session exists and get existing TODOs
	let currentSession = sessionManager.getCurrentSession();
	if (!currentSession) {
		// Check if running in task mode (temporary session)
		const isTaskMode = process.env['SNOW_TASK_MODE'] === 'true';
		currentSession = await sessionManager.createNewSession(isTaskMode);
	}

	const todoService = getTodoService();
	const existingTodoList = await todoService.getTodoList(currentSession.id);

	// Build conversation history with TODO context as pinned user message
	const conversationMessages: ChatMessage[] = [
		{
			role: 'system',
			content: getSystemPromptForMode(planMode, vulnerabilityHuntingMode),
		},
	];

	// If there are TODOs, add pinned context message at the front
	if (existingTodoList && existingTodoList.todos.length > 0) {
		const todoContext = formatTodoContext(existingTodoList.todos);
		conversationMessages.push({
			role: 'user',
			content: todoContext,
		});
	}

	// Add history messages from session (includes tool_calls and tool results)
	// Filter out internal sub-agent messages (marked with subAgentInternal: true)
	const session = sessionManager.getCurrentSession();
	if (session && session.messages.length > 0) {
		const filteredMessages = session.messages.filter(
			msg => !msg.subAgentInternal,
		);
		conversationMessages.push(...filteredMessages);
	}

	return {conversationMessages, currentSession, existingTodoList};
}
