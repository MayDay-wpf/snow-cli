import {
	ConnectionState,
	StatusChangeCallback,
	MessageCallback,
	InFlightState,
	PendingToolConfirmation,
	PendingQuestion,
	PendingRollbackConfirmation,
} from './types.js';

export class StateManager {
	private state: ConnectionState = {status: 'disconnected'};
	private statusCallbacks: StatusChangeCallback[] = [];
	private messageCallbacks: Map<string, MessageCallback[]> = new Map();

	// Streaming state
	private streamingState: 'idle' | 'streaming' | 'stopping' = 'idle';

	// Pending interactions
	private pendingToolConfirmations = new Map<string, PendingToolConfirmation>();
	private pendingQuestions = new Map<string, PendingQuestion>();
	private pendingRollbackConfirmation: PendingRollbackConfirmation | null =
		null;

	// Subscribe to status changes
	onStatusChange(callback: StatusChangeCallback): () => void {
		this.statusCallbacks.push(callback);
		// Immediately notify current state
		callback(this.state);
		return () => {
			const index = this.statusCallbacks.indexOf(callback);
			if (index > -1) {
				this.statusCallbacks.splice(index, 1);
			}
		};
	}

	// Subscribe to specific message types
	onMessage(type: string, callback: MessageCallback): () => void {
		if (!this.messageCallbacks.has(type)) {
			this.messageCallbacks.set(type, []);
		}
		this.messageCallbacks.get(type)!.push(callback);
		return () => {
			const callbacks = this.messageCallbacks.get(type);
			if (callbacks) {
				const index = callbacks.indexOf(callback);
				if (index > -1) {
					callbacks.splice(index, 1);
				}
			}
		};
	}

	// Update state and notify subscribers
	updateState(newState: Partial<ConnectionState>): void {
		this.state = {...this.state, ...newState};
		this.statusCallbacks.forEach(callback => callback(this.state));
	}

	// Notify message subscribers
	notifyMessage(type: string, message: unknown): void {
		const callbacks = this.messageCallbacks.get(type);
		if (callbacks) {
			callbacks.forEach(callback => callback(message));
		}
	}

	// Get current state
	getState(): ConnectionState {
		return {...this.state};
	}

	// Check if connected
	isConnected(): boolean {
		return this.state.status === 'connected';
	}

	// Set streaming state
	setStreamingState(state: 'idle' | 'streaming' | 'stopping'): void {
		this.streamingState = state;
	}

	// Get streaming state
	getStreamingState(): 'idle' | 'streaming' | 'stopping' {
		return this.streamingState;
	}

	// Check if has pending interactions
	hasPendingInteractions(): boolean {
		return (
			this.pendingToolConfirmations.size > 0 ||
			this.pendingQuestions.size > 0 ||
			this.pendingRollbackConfirmation !== null
		);
	}

	// Clear all in-flight interactions
	clearInFlightInteractions(): void {
		this.pendingToolConfirmations.clear();
		this.pendingQuestions.clear();
		this.pendingRollbackConfirmation = null;
	}

	// Add pending tool confirmation
	addPendingToolConfirmation(confirmation: PendingToolConfirmation): void {
		this.pendingToolConfirmations.set(confirmation.toolCallId, confirmation);
	}

	// Remove pending tool confirmation
	removePendingToolConfirmation(toolCallId: string): boolean {
		return this.pendingToolConfirmations.delete(toolCallId);
	}

	// Add pending question
	addPendingQuestion(question: PendingQuestion): void {
		this.pendingQuestions.set(question.toolCallId, question);
	}

	// Remove pending question
	removePendingQuestion(toolCallId: string): boolean {
		return this.pendingQuestions.delete(toolCallId);
	}

	// Set pending rollback confirmation
	setPendingRollbackConfirmation(
		confirmation: PendingRollbackConfirmation | null,
	): void {
		this.pendingRollbackConfirmation = confirmation;
	}

	// Get in-flight state for context info
	getInFlightState(): InFlightState {
		return {
			isMessageProcessing:
				this.streamingState === 'streaming' ||
				this.streamingState === 'stopping' ||
				this.hasPendingInteractions(),
			pendingToolConfirmations: Array.from(
				this.pendingToolConfirmations.values(),
			),
			pendingQuestions: Array.from(this.pendingQuestions.values()),
			pendingRollbackConfirmation: this.pendingRollbackConfirmation
				? {
						filePaths: [...this.pendingRollbackConfirmation.filePaths],
						notebookCount: this.pendingRollbackConfirmation.notebookCount,
				  }
				: null,
		};
	}

	// Getters for pending interactions
	getPendingToolConfirmation(
		toolCallId: string,
	): PendingToolConfirmation | undefined {
		return this.pendingToolConfirmations.get(toolCallId);
	}

	getPendingQuestion(toolCallId: string): PendingQuestion | undefined {
		return this.pendingQuestions.get(toolCallId);
	}

	getPendingRollbackConfirmation(): PendingRollbackConfirmation | null {
		return this.pendingRollbackConfirmation;
	}
}
