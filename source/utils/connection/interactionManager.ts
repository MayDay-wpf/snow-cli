import type * as signalR from '@microsoft/signalr';
import type {StateManager} from './stateManager.js';

export class InteractionManager {
	private connection: signalR.HubConnection | null = null;
	private stateManager: StateManager;

	constructor(stateManager: StateManager) {
		this.stateManager = stateManager;
	}

	// Set connection reference
	setConnection(connection: signalR.HubConnection | null): void {
		this.connection = connection;
	}

	// Check if connected
	private isConnected(): boolean {
		return this.stateManager.isConnected() && this.connection !== null;
	}

	// Notify server that tool confirmation is needed
	async notifyToolConfirmationNeeded(
		toolName: string,
		toolArguments: string,
		toolCallId: string,
		allTools?: Array<{name: string; arguments: string}>,
	): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return; // Silently fail if not connected
		}

		this.stateManager.addPendingToolConfirmation({
			toolName,
			toolArguments,
			toolCallId,
		});

		try {
			await this.connection.invoke(
				'NotifyToolConfirmationNeeded',
				toolName,
				toolArguments,
				toolCallId,
				allTools ? JSON.stringify(allTools) : null,
			);
		} catch {
			// Silently fail - don't block CLI functionality
		}
	}

	// Notify server that user interaction (ask_question) is needed
	async notifyUserInteractionNeeded(
		question: string,
		options: string[],
		toolCallId: string,
		multiSelect?: boolean,
	): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return; // Silently fail if not connected
		}

		this.stateManager.addPendingQuestion({
			question,
			options,
			toolCallId,
			multiSelect: multiSelect ?? false,
		});

		try {
			await this.connection.invoke(
				'NotifyUserInteractionNeeded',
				question,
				JSON.stringify(options),
				toolCallId,
				multiSelect ?? false,
			);
		} catch {
			// Silently fail - don't block CLI functionality
		}
	}

	// Notify server that rollback confirmation is needed
	async notifyRollbackConfirmationNeeded(payload: {
		filePaths: string[];
		notebookCount?: number;
	}): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		this.stateManager.setPendingRollbackConfirmation({
			filePaths: payload.filePaths || [],
			notebookCount: payload.notebookCount ?? 0,
		});

		try {
			await this.connection.invoke(
				'NotifyRollbackConfirmationNeeded',
				JSON.stringify(payload.filePaths || []),
				payload.notebookCount ?? 0,
			);
		} catch {
			// Silently fail - do not block local rollback flow
		}
	}

	// Send tool confirmation result (when user approves/rejects)
	async sendToolConfirmationResult(
		toolCallId: string,
		result: 'approve' | 'approve_always' | 'reject' | 'reject_with_reply',
		reason?: string,
	): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		this.stateManager.removePendingToolConfirmation(toolCallId);

		try {
			await this.connection.invoke(
				'SendToolConfirmationResult',
				toolCallId,
				result,
				reason ?? null,
			);
		} catch {
			// Silently fail
		}
	}

	// Send user question result (when user answers)
	async sendUserQuestionResult(
		toolCallId: string,
		selected: string | string[],
		customInput?: string,
		cancelled?: boolean,
	): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		this.stateManager.removePendingQuestion(toolCallId);

		try {
			await this.connection.invoke(
				'SendUserQuestionResult',
				toolCallId,
				Array.isArray(selected) ? JSON.stringify(selected) : selected,
				customInput ?? null,
				cancelled ?? false,
			);
		} catch {
			// Silently fail
		}
	}

	// Notify server that current message processing is completed
	async notifyMessageProcessingCompleted(): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		try {
			await this.connection.invoke('SendMessageProcessingCompleted');
		} catch {
			// Silently fail - should not break CLI flow
		}
	}
}
