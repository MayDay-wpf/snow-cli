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
	phaseId?: string;
}

/**
 * Ultra TODO phase
 */
export interface TodoPhase {
	id: string;
	title: string;
	status: 'pending' | 'inProgress' | 'completed';
	createdAt: string;
	updatedAt: string;
}

/**
 * TODO list for a session
 */
export interface TodoList {
	sessionId: string;
	todos: TodoItem[];
	createdAt: string;
	updatedAt: string;
	ultraMode?: boolean;
	phases?: TodoPhase[];
	currentPhaseId?: string;
}

/**
 * Callback function type for getting current session ID
 */
export type GetCurrentSessionId = () => string | null;
