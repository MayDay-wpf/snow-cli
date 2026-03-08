import {useEffect, useRef} from 'react';
import type {Dispatch, SetStateAction} from 'react';
import {useStdout} from 'ink';
import ansiEscapes from 'ansi-escapes';
import type {Message} from '../../components/chat/MessageList.js';
import {
	sessionManager,
	type ChatMessage as SessionChatMessage,
} from '../../../utils/session/sessionManager.js';
import {convertSessionMessagesToUI} from '../../../utils/session/sessionConverter.js';

type Options = {
	autoResume?: boolean;
	terminalWidth: number;
	remountKey: number;
	setRemountKey: Dispatch<SetStateAction<number>>;
	setMessages: Dispatch<SetStateAction<Message[]>>;
	initializeFromSession: (messages: SessionChatMessage[]) => void;
};

export function useChatScreenSessionLifecycle({
	autoResume,
	terminalWidth,
	remountKey,
	setRemountKey,
	setMessages,
	initializeFromSession,
}: Options) {
	const {stdout} = useStdout();
	const isInitialMount = useRef(true);

	useEffect(() => {
		if (!autoResume) {
			sessionManager.clearCurrentSession();
			return;
		}

		const resumeSession = async () => {
			try {
				const sessions = await sessionManager.listSessions();
				if (sessions.length > 0) {
					const latestSession = sessions[0];
					if (latestSession) {
						const session = await sessionManager.loadSession(latestSession.id);
						if (session) {
							const uiMessages = convertSessionMessagesToUI(session.messages);
							setMessages(uiMessages);
							initializeFromSession(session.messages);
						}
					}
				}
			} catch (error) {
				console.error('Failed to auto-resume session:', error);
			}
		};

		resumeSession();
	}, [autoResume, initializeFromSession, setMessages]);

	useEffect(() => {
		if (isInitialMount.current) {
			isInitialMount.current = false;
			return;
		}

		const handler = setTimeout(() => {
			stdout.write(ansiEscapes.clearTerminal);
			setRemountKey(prev => prev + 1);
		}, 200);

		return () => {
			clearTimeout(handler);
		};
		// stdout 对象可能在每次渲染时变化，移除以避免循环
	}, [terminalWidth, setRemountKey]);

	useEffect(() => {
		if (remountKey === 0) {
			return;
		}

		const reloadMessages = async () => {
			const currentSession = sessionManager.getCurrentSession();
			if (currentSession && currentSession.messages.length > 0) {
				const uiMessages = convertSessionMessagesToUI(currentSession.messages);
				setMessages(uiMessages);
			}
		};

		reloadMessages();
	}, [remountKey, setMessages]);
}
