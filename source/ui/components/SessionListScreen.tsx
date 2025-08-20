import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Gradient from 'ink-gradient';
import { Alert } from '@inkjs/ui';
import Menu from './Menu.js';
import { sessionManager, type SessionListItem } from '../../utils/sessionManager.js';

type Props = {
	onBack: () => void;
	onSelectSession: (sessionId: string) => void;
};

export default function SessionListScreen({ onBack, onSelectSession }: Props) {
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [selectedSessionInfo, setSelectedSessionInfo] = useState('');

	useEffect(() => {
		loadSessions();
	}, []);

	const loadSessions = async () => {
		setLoading(true);
		setError('');
		try {
			const sessionList = await sessionManager.listSessions();
			setSessions(sessionList);
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load sessions');
		} finally {
			setLoading(false);
		}
	};

	const formatDate = (timestamp: number): string => {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
		const diffDays = Math.floor(diffHours / 24);

		if (diffHours < 1) {
			const diffMinutes = Math.floor(diffMs / (1000 * 60));
			return diffMinutes < 1 ? 'Just now' : `${diffMinutes}m ago`;
		} else if (diffHours < 24) {
			return `${diffHours}h ago`;
		} else if (diffDays < 7) {
			return `${diffDays}d ago`;
		} else {
			return date.toLocaleDateString();
		}
	};

	const getMenuOptions = () => {
		return sessions.map(session => {
			const timeString = formatDate(session.updatedAt);
			return {
				label: `${session.title || 'Untitled'} (${session.messageCount} messages) - ${timeString}`,
				value: session.id,
				infoText: session.summary || 'No summary'
			};
		});
	};

	const handleSessionSelect = (sessionId: string) => {
		onSelectSession(sessionId);
	};

	const handleSelectionChange = (infoText: string) => {
		setSelectedSessionInfo(infoText);
	};

	useInput((input, key) => {
		if (key.escape) {
			onBack();
		} else if (input === 'r') {
			loadSessions();
		}
	});

	if (loading) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={2} borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Gradient name="rainbow">
							Resume Conversation
						</Gradient>
						<Text color="gray" dimColor>
							Loading your conversation history...
						</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	if (error) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={2} borderStyle="double" borderColor="red" paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Gradient name="rainbow">
							Resume Conversation
						</Gradient>
						<Text color="gray" dimColor>
							Select a conversation to resume
						</Text>
					</Box>
				</Box>

				<Box marginBottom={2}>
					<Alert variant="error">
						{error}
					</Alert>
				</Box>

				<Box flexDirection="column">
					<Alert variant="info">
						Press Esc to return, or R to retry
					</Alert>
				</Box>
			</Box>
		);
	}

	if (sessions.length === 0) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={2} borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1}>
					<Box flexDirection="column">
						<Gradient name="rainbow">
							Resume Conversation
						</Gradient>
						<Text color="gray" dimColor>
							No conversations found
						</Text>
					</Box>
				</Box>

				<Box marginBottom={2}>
					<Alert variant="info">
						No previous conversations found. Start a new conversation to create your first session.
					</Alert>
				</Box>

				<Box flexDirection="column">
					<Alert variant="info">
						Press Esc to return to chat
					</Alert>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={2} borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1}>
				<Box flexDirection="column">
					<Gradient name="rainbow">
						Resume Conversation
					</Gradient>
					<Text color="gray" dimColor>
						Select a conversation to resume ({sessions.length} available)
					</Text>
				</Box>
			</Box>

			<Box marginBottom={1}>
				<Menu
					options={getMenuOptions()}
					onSelect={handleSessionSelect}
					onSelectionChange={handleSelectionChange}
				/>
			</Box>

			{selectedSessionInfo && (
				<Box marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
					<Text color="yellow">Summary: </Text>
					<Text color="gray">{selectedSessionInfo}</Text>
				</Box>
			)}

			<Box flexDirection="column">
				<Alert variant="info">
					Use ↑↓ to navigate, Enter to select, Esc to return, R to refresh
				</Alert>
			</Box>
		</Box>
	);
}