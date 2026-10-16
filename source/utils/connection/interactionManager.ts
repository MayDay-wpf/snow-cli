import type * as signalR from '@microsoft/signalr';
import type {StateManager} from './stateManager.js';
import {logger} from '../core/logger.js';

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
		} catch (error) {
			logger.debug('Failed to invoke NotifyToolConfirmationNeeded', {toolName, toolCallId, error});
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
		} catch (error) {
			logger.debug('Failed to invoke NotifyUserInteractionNeeded', {question, toolCallId, error});
		}
	}

	// Notify server that rollback confirmation is needed
	async notifyRollbackConfirmationNeeded(payload: {
		filePaths: string[];
		notebookCount?: number;
		teamCount?: number;
		todoCount?: number;
	}): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		this.stateManager.setPendingRollbackConfirmation({
			filePaths: payload.filePaths || [],
			notebookCount: payload.notebookCount ?? 0,
			teamCount: payload.teamCount ?? 0,
			todoCount: payload.todoCount ?? 0,
		});

		try {
			await this.connection.invoke(
				'NotifyRollbackConfirmationNeeded',
				JSON.stringify(payload.filePaths || []),
				payload.notebookCount ?? 0,
				payload.teamCount ?? 0,
				payload.todoCount ?? 0,
			);
		} catch (error) {
			logger.debug('Failed to invoke NotifyRollbackConfirmationNeeded', {payload, error});
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
		} catch (error) {
			logger.debug('Failed to invoke SendToolConfirmationResult', {toolCallId, result, error});
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
		} catch (error) {
			logger.debug('Failed to invoke SendUserQuestionResult', {toolCallId, error});
		}
	}

	// Notify server that current message processing is completed
	async notifyMessageProcessingCompleted(): Promise<void> {
		if (!this.isConnected() || !this.connection) {
			return;
		}

		try {
			await this.connection.invoke('SendMessageProcessingCompleted');
		} catch (error) {
			logger.debug('Failed to invoke SendMessageProcessingCompleted', {error});
		}
	}
}
