import React, {useState, useEffect, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {
	sessionManager,
	type SessionListItem,
} from '../../utils/sessionManager.js';

type Props = {
	onSelectSession: (sessionId: string) => void;
	onClose: () => void;
};

export default function SessionListPanel({onSelectSession, onClose}: Props) {
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [markedSessions, setMarkedSessions] = useState<Set<string>>(new Set());

	const VISIBLE_ITEMS = 5; // Number of items to show at once

	// Load sessions on mount
	useEffect(() => {
		const loadSessions = async () => {
			setLoading(true);
			try {
				const sessionList = await sessionManager.listSessions();
				setSessions(sessionList);
			} catch (error) {
				console.error('Failed to load sessions:', error);
				setSessions([]);
			} finally {
				setLoading(false);
			}
		};

		void loadSessions();
	}, []);

	// Format date to relative time
	const formatDate = useCallback((timestamp: number): string => {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMinutes = Math.floor(diffMs / (1000 * 60));
		const diffHours = Math.floor(diffMinutes / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMinutes < 1) return 'now';
		if (diffMinutes < 60) return `${diffMinutes}m`;
		if (diffHours < 24) return `${diffHours}h`;
		if (diffDays < 7) return `${diffDays}d`;
		return date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
	}, []);

	// Handle keyboard input
	useInput((input, key) => {
		if (loading) return;

		if (key.escape) {
			onClose();
			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev => {
				const newIndex = Math.max(0, prev - 1);
				// Adjust scroll offset if needed
				if (newIndex < scrollOffset) {
					setScrollOffset(newIndex);
				}
				return newIndex;
			});
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev => {
				const newIndex = Math.min(sessions.length - 1, prev + 1);
				// Adjust scroll offset if needed
				if (newIndex >= scrollOffset + VISIBLE_ITEMS) {
					setScrollOffset(newIndex - VISIBLE_ITEMS + 1);
				}
				return newIndex;
			});
			return;
		}

		// Space to toggle mark
		if (input === ' ') {
			const currentSession = sessions[selectedIndex];
			if (currentSession) {
				setMarkedSessions(prev => {
					const next = new Set(prev);
					if (next.has(currentSession.id)) {
						next.delete(currentSession.id);
					} else {
						next.add(currentSession.id);
					}
					return next;
				});
			}
			return;
		}

		// D to delete marked sessions
		if (input === 'd' || input === 'D') {
			if (markedSessions.size > 0) {
				const deleteMarked = async () => {
					const ids = Array.from(markedSessions);
					await Promise.all(ids.map(id => sessionManager.deleteSession(id)));
					// Reload sessions
					const sessionList = await sessionManager.listSessions();
					setSessions(sessionList);
					setMarkedSessions(new Set());
					// Reset selection if needed
					if (selectedIndex >= sessionList.length && sessionList.length > 0) {
						setSelectedIndex(sessionList.length - 1);
					}
				};
				void deleteMarked();
			}
			return;
		}

		if (key.return && sessions.length > 0) {
			const selectedSession = sessions[selectedIndex];
			if (selectedSession) {
				onSelectSession(selectedSession.id);
			}
			return;
		}
	});

	if (loading) {
		return (
			<Box borderStyle="round" borderColor="cyan" paddingX={1}>
				<Text color="gray" dimColor>
					Loading sessions...
				</Text>
			</Box>
		);
	}

	if (sessions.length === 0) {
		return (
			<Box borderStyle="round" borderColor="yellow" paddingX={1}>
				<Text color="gray" dimColor>
					No conversations found • Press ESC to close
				</Text>
			</Box>
		);
	}

	// Calculate visible sessions based on scroll offset
	const visibleSessions = sessions.slice(
		scrollOffset,
		scrollOffset + VISIBLE_ITEMS,
	);
	const hasMore = sessions.length > scrollOffset + VISIBLE_ITEMS;
	const hasPrevious = scrollOffset > 0;
	const currentSession = sessions[selectedIndex];

	return (
		<Box
			borderStyle="round"
			borderColor="cyan"
			paddingX={1}
			flexDirection="column"
		>
			<Box flexDirection="column">
				<Text color="cyan" dimColor>
					Resume ({selectedIndex + 1}/{sessions.length})
					{currentSession && ` • ${currentSession.messageCount} msgs`}
					{markedSessions.size > 0 && (
						<Text color="yellow"> • {markedSessions.size} marked</Text>
					)}
				</Text>
				<Text color="gray" dimColor>
					↑↓ navigate • Space mark • D delete • Enter select • ESC close
				</Text>
			</Box>
			{hasPrevious && (
				<Text color="gray" dimColor>
					{' '}
					↑ {scrollOffset} more above
				</Text>
			)}
			{visibleSessions.map((session, index) => {
				const actualIndex = scrollOffset + index;
				const isSelected = actualIndex === selectedIndex;
				const isMarked = markedSessions.has(session.id);
				// Remove newlines and other whitespace characters from title
				const cleanTitle = (session.title || 'Untitled').replace(
					/[\r\n\t]+/g,
					' ',
				);
				const timeStr = formatDate(session.updatedAt);
				const truncatedLabel =
					cleanTitle.length > 50 ? cleanTitle.slice(0, 47) + '...' : cleanTitle;

				return (
					<Box key={session.id}>
						<Text color={isMarked ? 'green' : 'gray'}>
							{isMarked ? '✔ ' : '  '}
						</Text>
						<Text color={isSelected ? 'green' : 'gray'}>
							{isSelected ? '❯ ' : '  '}
						</Text>
						<Text color={isSelected ? 'cyan' : isMarked ? 'green' : 'white'}>
							{truncatedLabel}
						</Text>
						<Text color="gray" dimColor>
							{' '}
							• {timeStr}
						</Text>
					</Box>
				);
			})}
			{hasMore && (
				<Text color="gray" dimColor>
					{' '}
					↓ {sessions.length - scrollOffset - VISIBLE_ITEMS} more below
				</Text>
			)}
		</Box>
	);
}
