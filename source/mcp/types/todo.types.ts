/**
 * Type definitions for TODO Service
 */

/**
 * TODO item
 */
export interface TodoItem {
	id: string;
	content: string;
	status: 'pending' | 'inProgress' | 'completed';
	createdAt: string;
	updatedAt: string;
	parentId?: string;
}

/**
 * TODO list for a session
 */
export interface TodoList {
	sessionId: string;
	todos: TodoItem[];
	createdAt: string;
	updatedAt: string;
}

/**
 * Callback function type for getting current session ID
 */
export type GetCurrentSessionId = () => string | null;
