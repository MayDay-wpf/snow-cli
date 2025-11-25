import {useCallback, useRef} from 'react';
import {
	sessionManager,
	type ChatMessage as SessionChatMessage,
} from '../utils/session/sessionManager.js';
import type {ChatMessage as APIChatMessage} from '../api/chat.js';

export function useSessionSave() {
	const savedMessagesRef = useRef<Set<string>>(new Set());

	// Generate a unique ID for a message (based on role + content + timestamp window + tool identifiers)
	const generateMessageId = useCallback(
		(message: APIChatMessage, timestamp: number): string => {
			// Base ID with role, content length, and time window
			let id = `${message.role}-${message.content.length}-${Math.floor(
				timestamp / 5000,
			)}`;

			// For assistant messages with tool_calls, include tool call IDs to ensure uniqueness
			if (
				message.role === 'assistant' &&
				message.tool_calls &&
				message.tool_calls.length > 0
			) {
				const toolCallIds = message.tool_calls
					.map(tc => tc.id)
					.sort()
					.join(',');
				id += `-tools:${toolCallIds}`;
			}

			// For tool result messages, include the tool_call_id to ensure uniqueness
			if (message.role === 'tool' && message.tool_call_id) {
				id += `-toolcall:${message.tool_call_id}`;
			}

			return id;
		},
		[],
	);

	// Save API message directly - 直接保存 API 格式的消息
	const saveMessage = useCallback(
		async (message: APIChatMessage) => {
			const timestamp = Date.now();
			const messageId = generateMessageId(message, timestamp);

			if (savedMessagesRef.current.has(messageId)) {
				return; // Already saved
			}

			const sessionMessage: SessionChatMessage = {
				...message, // 直接展开 API 消息，包含所有字段
				timestamp,
			};

			try {
				await sessionManager.addMessage(sessionMessage);
				savedMessagesRef.current.add(messageId);
			} catch (error) {
				console.error('Failed to save message:', error);
			}
		},
		[generateMessageId],
	);

	// Save multiple API messages at once
	const saveMessages = useCallback(
		async (messages: APIChatMessage[]) => {
			for (const message of messages) {
				await saveMessage(message);
			}
		},
		[saveMessage],
	);

	// Clear saved messages tracking (for new sessions)
	const clearSavedMessages = useCallback(() => {
		savedMessagesRef.current.clear();
	}, []);

	// Initialize from existing session - 从已有会话初始化
	const initializeFromSession = useCallback(
		(messages: SessionChatMessage[]) => {
			savedMessagesRef.current.clear();
			messages.forEach(message => {
				const messageId = generateMessageId(message, message.timestamp);
				savedMessagesRef.current.add(messageId);
			});
		},
		[generateMessageId],
	);

	return {
		saveMessage,
		saveMessages,
		clearSavedMessages,
		initializeFromSession,
	};
}
