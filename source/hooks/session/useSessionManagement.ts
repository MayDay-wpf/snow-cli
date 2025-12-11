import {useState} from 'react';
import {sessionManager} from '../../utils/session/sessionManager.js';
import type {Message} from '../../ui/components/chat/MessageList.js';
import {convertSessionMessagesToUI} from '../../utils/session/sessionConverter.js';

/**
 * Hook for managing session list and session selection
 */
export function useSessionManagement(
	setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
	setPendingMessages: React.Dispatch<React.SetStateAction<string[]>>,
	setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>,
	setRemountKey: React.Dispatch<React.SetStateAction<number>>,
	initializeFromSession: (messages: any[]) => void,
) {
	const [showSessionList, setShowSessionList] = useState(false);

	/**
	 * Handle session selection from the session list
	 */
	const handleSessionSelect = async (sessionId: string) => {
		try {
			const session = await sessionManager.loadSession(sessionId);
			if (session) {
				// Convert API format messages to UI format
				const uiMessages = convertSessionMessagesToUI(session.messages);

				setMessages(uiMessages);
				setPendingMessages([]);
				setIsStreaming(false);
				setShowSessionList(false);
				setRemountKey(prev => prev + 1);

				// Initialize session save hook with loaded API messages
				initializeFromSession(session.messages);
			}
		} catch (error) {
			console.error('Failed to load session:', error);
		}
	};

	/**
	 * Handle back action from session list
	 */
	const handleBackFromSessionList = () => {
		setShowSessionList(false);
	};

	return {
		showSessionList,
		setShowSessionList,
		handleSessionSelect,
		handleBackFromSessionList,
	};
}
