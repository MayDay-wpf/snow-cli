import React, {useState, useEffect, useMemo, useCallback} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import Gradient from 'ink-gradient';
import {Alert} from '@inkjs/ui';
import ScrollableSelectInput from './ScrollableSelectInput.js';
import {
	sessionManager,
	type SessionListItem,
} from '../../utils/sessionManager.js';

type Props = {
	onBack: () => void;
	onSelectSession: (sessionId: string) => void;
};

type SelectItem = {
	label: string;
	value: string;
	isMarked: boolean;
};

export default function SessionListScreen({onBack, onSelectSession}: Props) {
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [selectedSessions, setSelectedSessions] = useState<Set<string>>(
		new Set(),
	);
	const [actionMessage, setActionMessage] = useState<{
		type: 'info' | 'error';
		text: string;
	} | null>(null);
	const {stdout} = useStdout();

	const loadSessions = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			const sessionList = await sessionManager.listSessions();
			setSessions(sessionList);
			setSelectedSessions(new Set());
			setActionMessage(null);
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
		// Reserve space for indicators (✔ + ❯ + spacing) and margins
		const reservedSpace = 30;
		const maxLabelWidth = Math.max(30, terminalWidth - reservedSpace);

		return sessions.map(session => {
			const timeString = formatDate(session.updatedAt);
			// Remove newlines and other whitespace characters from title
			const title = (session.title || 'Untitled').replace(/[\r\n\t]+/g, ' ');

			// Format: "Title • 5 msgs • 2h ago"
			const messageInfo = `${session.messageCount} msg${
				session.messageCount !== 1 ? 's' : ''
			}`;
			const fullLabel = `${title} • ${messageInfo} • ${timeString}`;

			// Truncate if too long - prioritize showing the title
			let truncatedLabel = fullLabel;
			if (fullLabel.length > maxLabelWidth) {
				const ellipsis = '...';
				const suffixLength = messageInfo.length + timeString.length + 6; // " • " x2 + "..."
				const availableForTitle =
					maxLabelWidth - suffixLength - ellipsis.length;

				if (availableForTitle > 10) {
					const truncatedTitle = title.substring(0, availableForTitle);
					truncatedLabel = `${truncatedTitle}${ellipsis} • ${messageInfo} • ${timeString}`;
				} else {
					// If terminal is too narrow, just truncate the whole thing
					truncatedLabel =
						fullLabel.substring(0, maxLabelWidth - ellipsis.length) + ellipsis;
				}
			}

			return {
				label: truncatedLabel,
				value: session.id,
				isMarked: selectedSessions.has(session.id),
			};
		});
	}, [sessions, formatDate, stdout?.columns, selectedSessions]);

	const handleSelect = useCallback(
		(item: SelectItem) => {
			onSelectSession(item.value);
		},
		[onSelectSession],
	);

	const handleToggleItem = useCallback((item: SelectItem) => {
		setSelectedSessions(previous => {
			const next = new Set(previous);
			if (next.has(item.value)) {
				next.delete(item.value);
			} else {
				next.add(item.value);
			}
			return next;
		});
		setActionMessage(null);
	}, []);

	const handleDeleteSelected = useCallback(async () => {
		if (selectedSessions.size === 0) {
			setActionMessage({type: 'info', text: 'No conversations selected.'});
			return;
		}

		const ids = Array.from(selectedSessions);
		const deletionResults = await Promise.all(
			ids.map(async id => ({
				id,
				success: await sessionManager.deleteSession(id),
			})),
		);

		const succeededIds = deletionResults
			.filter(result => result.success)
			.map(result => result.id);
		const failedIds = deletionResults
			.filter(result => !result.success)
			.map(result => result.id);

		if (succeededIds.length > 0) {
			setSessions(previous =>
				previous.filter(session => !succeededIds.includes(session.id)),
			);
			setSelectedSessions(previous => {
				const next = new Set(previous);
				for (const id of succeededIds) {
					next.delete(id);
				}
				return next;
			});
		}

		if (failedIds.length > 0) {
			setActionMessage({
				type: 'error',
				text: `Failed to delete ${failedIds.length} conversation${
					failedIds.length > 1 ? 's' : ''
				}.`,
			});
		} else if (succeededIds.length > 0) {
			setActionMessage({
				type: 'info',
				text: `Deleted ${succeededIds.length} conversation${
					succeededIds.length > 1 ? 's' : ''
				}.`,
			});
		} else {
			setActionMessage({type: 'info', text: 'No conversations deleted.'});
		}
	}, [selectedSessions]);

	const handleInput = useCallback(
		(input: string, key: any) => {
			if (key.escape) {
				onBack();
				return;
			}

			if (input === 'r' || input === 'R') {
				void loadSessions();
			}
		},
		[loadSessions, onBack],
	);

	useInput(handleInput);

	if (loading) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box
					marginBottom={2}
					borderStyle="double"
					borderColor="cyan"
					paddingX={2}
					paddingY={1}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">Resume Conversation</Gradient>
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
				<Box
					marginBottom={2}
					borderStyle="double"
					borderColor="red"
					paddingX={2}
					paddingY={1}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">Resume Conversation</Gradient>
						<Text color="gray" dimColor>
							Select a conversation to resume
						</Text>
					</Box>
				</Box>

				<Box marginBottom={2}>
					<Alert variant="error">{error}</Alert>
				</Box>

				<Box flexDirection="column">
					<Alert variant="info">Press Esc to return, or R to retry</Alert>
				</Box>
			</Box>
		);
	}

	if (sessions.length === 0) {
		return (
			<Box flexDirection="column" padding={1}>
				<Box
					marginBottom={2}
					borderStyle="double"
					borderColor="cyan"
					paddingX={2}
					paddingY={1}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">Resume Conversation</Gradient>
						<Text color="gray" dimColor>
							No conversations found
						</Text>
					</Box>
				</Box>

				<Box marginBottom={2}>
					<Alert variant="info">
						No previous conversations found. Start a new conversation to create
						your first session.
					</Alert>
				</Box>

				<Box flexDirection="column">
					<Alert variant="info">Press Esc to return to chat</Alert>
				</Box>
			</Box>
		);
	}

	// Calculate available height for the list with safer bounds
	const terminalHeight = stdout?.rows || 24;
	const headerHeight = 7; // Header box height (including borders and padding)
	const footerHeight = 4; // Footer info height (including margins)
	const availableHeight = Math.max(
		5,
		terminalHeight - headerHeight - footerHeight,
	);
	const maxVisibleSessions = 10;
	const desiredListSize = Math.max(
		3,
		Math.min(maxVisibleSessions, availableHeight),
	);
	const listLimit = Math.min(selectItems.length, desiredListSize);

	const containerHeight = terminalHeight > 2 ? terminalHeight - 2 : undefined;

	return (
		<Box flexDirection="column" padding={1} height={containerHeight}>
			<Box
				marginBottom={1}
				borderStyle="double"
				borderColor="cyan"
				paddingX={2}
				paddingY={1}
			>
				<Box flexDirection="column">
					<Gradient name="rainbow">Resume Conversation</Gradient>
					<Text color="gray" dimColor>
						{sessions.length} conversation{sessions.length !== 1 ? 's' : ''}{' '}
						available
					</Text>
				</Box>
			</Box>

			<Box marginBottom={1} flexShrink={0}>
				<ScrollableSelectInput
					items={selectItems}
					limit={listLimit}
					onSelect={handleSelect}
					onToggleItem={handleToggleItem}
					onDeleteSelection={handleDeleteSelected}
					selectedValues={selectedSessions}
					indicator={({isSelected}) => (
						<Text color={isSelected ? 'green' : 'gray'}>
							{isSelected ? '❯ ' : '  '}
						</Text>
					)}
					renderItem={({isSelected, isMarked, label}) => (
						<Text>
							<Text color={isMarked ? 'green' : 'gray'}>
								{isMarked ? '✔ ' : '  '}
							</Text>
							<Text color={isMarked ? 'green' : isSelected ? 'cyan' : 'white'}>
								{label}
							</Text>
						</Text>
					)}
				/>
			</Box>

			<Box flexDirection="column" flexShrink={0}>
				{actionMessage ? (
					<Box marginBottom={1}>
						<Alert variant={actionMessage.type}>{actionMessage.text}</Alert>
					</Box>
				) : null}
				<Alert variant="info">
					↑↓ navigate • Space mark • D delete • Enter select • Esc return • R
					refresh
					{selectedSessions.size > 0
						? ` • ${selectedSessions.size} selected`
						: ''}
				</Alert>
			</Box>
		</Box>
	);
}
