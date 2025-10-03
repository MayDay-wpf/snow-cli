import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import Gradient from 'ink-gradient';
import { Alert } from '@inkjs/ui';
import SelectInput from 'ink-select-input';
import { sessionManager, type SessionListItem } from '../../utils/sessionManager.js';

type Props = {
	onBack: () => void;
	onSelectSession: (sessionId: string) => void;
};

type SelectItem = {
	label: string;
	value: string;
};

export default function SessionListScreen({ onBack, onSelectSession }: Props) {
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const { stdout } = useStdout();

	// Enable alternate screen buffer when this component mounts
	useEffect(() => {
		process.stdout.write('\x1B[?1049h');
		process.stdout.write('\x1B[2J');
		process.stdout.write('\x1B[H');
		return () => {
			process.stdout.write('\x1B[2J');
			process.stdout.write('\x1B[?1049l');
		};
	}, []);

	const loadSessions = useCallback(async () => {
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
	}, []);

	useEffect(() => {
		void loadSessions();
	}, [loadSessions]);

	const formatDate = useCallback((timestamp: number): string => {
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
	}, []);

	// Create select items with truncated labels
	const selectItems = useMemo((): SelectItem[] => {
		const terminalWidth = stdout?.columns || 80;
		// Increase margin and ensure minimum width
		const maxLabelWidth = Math.max(20, terminalWidth - 20);

		return sessions.map(session => {
			const timeString = formatDate(session.updatedAt);
			const title = session.title || 'Untitled';
			const label = `${title} (${session.messageCount}) - ${timeString}`;

			// Truncate if too long with safer boundary check
			let truncatedLabel = label;
			if (label.length > maxLabelWidth) {
				const maxLength = Math.max(10, maxLabelWidth - 3);
				truncatedLabel = label.substring(0, maxLength) + '...';
			}

			return {
				label: truncatedLabel,
				value: session.id
			};
		});
	}, [sessions, formatDate, stdout?.columns]);

	const handleSelect = useCallback((item: SelectItem) => {
		onSelectSession(item.value);
	}, [onSelectSession]);

	const handleInput = useCallback((input: string, key: any) => {
		if (key.escape) {
			onBack();
		} else if (input === 'r' || input === 'R') {
			void loadSessions();
		}
	}, [onBack, loadSessions]);

	useInput(handleInput);

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

	// Calculate available height for the list with safer bounds
	const terminalHeight = stdout?.rows || 24;
	const headerHeight = 7; // Header box height (including borders and padding)
	const footerHeight = 4; // Footer info height (including margins)
	const availableHeight = Math.max(5, terminalHeight - headerHeight - footerHeight);
	const listLimit = Math.min(selectItems.length, Math.max(3, availableHeight));

	return (
		<Box flexDirection="column" padding={1} height={terminalHeight - 2}>
			<Box marginBottom={1} borderStyle="double" borderColor="cyan" paddingX={2} paddingY={1}>
				<Box flexDirection="column">
					<Gradient name="rainbow">
						Resume Conversation
					</Gradient>
					<Text color="gray" dimColor>
						{sessions.length} conversation{sessions.length !== 1 ? 's' : ''} available
					</Text>
				</Box>
			</Box>

			<Box marginBottom={1} flexShrink={0}>
				<SelectInput
					items={selectItems}
					onSelect={handleSelect}
					limit={listLimit}
					indicatorComponent={({ isSelected }) => (
						<Text color={isSelected ? 'green' : 'gray'}>
							{isSelected ? '❯ ' : '  '}
						</Text>
					)}
					itemComponent={({ isSelected, label }) => (
						<Text color={isSelected ? 'cyan' : 'white'}>
							{label}
						</Text>
					)}
				/>
			</Box>

			<Box flexDirection="column" flexShrink={0}>
				<Alert variant="info">
					↑↓ navigate • Enter select • Esc return • R refresh
				</Alert>
			</Box>
		</Box>
	);
}