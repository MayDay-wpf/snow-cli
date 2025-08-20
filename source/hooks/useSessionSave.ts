import { useCallback, useRef } from 'react';
import { sessionManager, type ChatMessage as SessionChatMessage } from '../utils/sessionManager.js';

export interface Message {
	role: 'user' | 'assistant' | 'command';
	content: string;
	streaming?: boolean;
	discontinued?: boolean;
	commandName?: string;
}

export function useSessionSave() {
	const savedMessagesRef = useRef<Set<string>>(new Set());

	// Generate a unique ID for a message
	const generateMessageId = useCallback((message: Message): string => {
		return `${message.role}-${message.content.length}-${message.content.slice(0, 30).replace(/\s/g, '')}`;
	}, []);

	// Save a single message
	const saveMessage = useCallback(async (message: Message) => {
		if (message.role === 'command' || message.streaming) {
			return;
		}

		const messageId = generateMessageId(message);
		if (savedMessagesRef.current.has(messageId)) {
			return; // Already saved
		}

		const sessionMessage: SessionChatMessage = {
			role: message.role as 'user' | 'assistant',
			content: message.content,
			timestamp: Date.now()
		};

		try {
			await sessionManager.addMessage(sessionMessage);
			savedMessagesRef.current.add(messageId);
		} catch (error) {
			console.error('Failed to save message:', error);
		}
	}, [generateMessageId]);

	// Save multiple messages at once
	const saveMessages = useCallback(async (messages: Message[]) => {
		for (const message of messages) {
			await saveMessage(message);
		}
	}, [saveMessage]);

	// Hook for when streaming completes - save the final message
	const onStreamingComplete = useCallback(async (finalMessage: Message) => {
		if (finalMessage.role === 'assistant' && !finalMessage.streaming && !finalMessage.discontinued) {
			await saveMessage(finalMessage);
		}
	}, [saveMessage]);

	// Hook for when user sends a message
	const onUserMessage = useCallback(async (userMessage: Message) => {
		if (userMessage.role === 'user') {
			await saveMessage(userMessage);
		}
	}, [saveMessage]);

	// Clear saved messages tracking (for new sessions)
	const clearSavedMessages = useCallback(() => {
		savedMessagesRef.current.clear();
	}, []);

	// Initialize from existing session
	const initializeFromSession = useCallback((messages: Message[]) => {
		savedMessagesRef.current.clear();
		messages.forEach(message => {
			if (message.role !== 'command' && !message.streaming) {
				const messageId = generateMessageId(message);
				savedMessagesRef.current.add(messageId);
			}
		});
	}, [generateMessageId]);

	return {
		saveMessage,
		saveMessages,
		onStreamingComplete,
		onUserMessage,
		clearSavedMessages,
		initializeFromSession
	};
}