import { useState, useCallback, useRef, useEffect } from 'react';
import { TextBuffer } from '../utils/textBuffer.js';

type ChatMessage = {
	role: string;
	content: string;
};

export function useHistoryNavigation(
	buffer: TextBuffer,
	triggerUpdate: () => void,
	chatHistory: ChatMessage[],
	onHistorySelect?: (selectedIndex: number, message: string) => void,
) {
	const [showHistoryMenu, setShowHistoryMenu] = useState(false);
	const [historySelectedIndex, setHistorySelectedIndex] = useState(0);
	const [escapeKeyCount, setEscapeKeyCount] = useState(0);
	const escapeKeyTimer = useRef<NodeJS.Timeout | null>(null);

	// Cleanup timer on unmount
	useEffect(() => {
		return () => {
			if (escapeKeyTimer.current) {
				clearTimeout(escapeKeyTimer.current);
			}
		};
	}, []);

	// Get user messages from chat history for navigation
	const getUserMessages = useCallback(() => {
		const userMessages = chatHistory
			.map((msg, index) => ({ ...msg, originalIndex: index }))
			.filter(msg => msg.role === 'user' && msg.content.trim());

		// Keep original order (oldest first, newest last) and map with display numbers
		return userMessages.map((msg, index) => ({
			label: `${index + 1}. ${msg.content.slice(0, 50)}${
				msg.content.length > 50 ? '...' : ''
			}`,
			value: msg.originalIndex.toString(),
			infoText: msg.content,
		}));
	}, [chatHistory]);

	// Handle history selection
	const handleHistorySelect = useCallback(
		(value: string) => {
			const selectedIndex = parseInt(value, 10);
			const selectedMessage = chatHistory[selectedIndex];
			if (selectedMessage && onHistorySelect) {
				// Put the message content in the input buffer
				buffer.setText(selectedMessage.content);
				setShowHistoryMenu(false);
				triggerUpdate();
				onHistorySelect(selectedIndex, selectedMessage.content);
			}
		},
		[chatHistory, onHistorySelect, buffer, triggerUpdate],
	);

	return {
		showHistoryMenu,
		setShowHistoryMenu,
		historySelectedIndex,
		setHistorySelectedIndex,
		escapeKeyCount,
		setEscapeKeyCount,
		escapeKeyTimer,
		getUserMessages,
		handleHistorySelect,
	};
}
