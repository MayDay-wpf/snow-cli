import React, {useState, useEffect, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {
	sessionManager,
	type SessionListItem,
} from '../../../utils/session/sessionManager.js';

type Props = {
	onSelectSession: (sessionId: string) => void;
	onClose: () => void;
};

export default function SessionListPanel({onSelectSession, onClose}: Props) {
	const [sessions, setSessions] = useState<SessionListItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [markedSessions, setMarkedSessions] = useState<Set<string>>(new Set());
	const [currentPage, setCurrentPage] = useState(0);
	const [hasMore, setHasMore] = useState(true);
	const [totalCount, setTotalCount] = useState(0);
	const [searchInput, setSearchInput] = useState('');
	const [debouncedSearch, setDebouncedSearch] = useState('');

	const VISIBLE_ITEMS = 5; // Number of items to show at once
	const PAGE_SIZE = 20; // Number of items to load per page
	const SEARCH_DEBOUNCE_MS = 300; // Debounce delay for search

	// Debounce search input
	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchInput);
		}, SEARCH_DEBOUNCE_MS);

		return () => clearTimeout(timer);
	}, [searchInput]);

	// Load initial sessions on mount or when debounced search query changes
	useEffect(() => {
		const loadSessions = async () => {
			setLoading(true);
			try {
				const result = await sessionManager.listSessionsPaginated(
					0,
					PAGE_SIZE,
					debouncedSearch,
				);
				setSessions(result.sessions);
				setHasMore(result.hasMore);
				setTotalCount(result.total);
				setCurrentPage(0);
				setSelectedIndex(0);
				setScrollOffset(0);
			} catch (error) {
				console.error('Failed to load sessions:', error);
				setSessions([]);
			} finally {
				setLoading(false);
			}
		};

		void loadSessions();
	}, [debouncedSearch]);

	// Load more sessions when scrolling near the end
	const loadMoreSessions = useCallback(async () => {
		if (loadingMore || !hasMore) return;

		setLoadingMore(true);
		try {
			const nextPage = currentPage + 1;
			const result = await sessionManager.listSessionsPaginated(
				nextPage,
				PAGE_SIZE,
				debouncedSearch,
			);
			setSessions(prev => [...prev, ...result.sessions]);
			setHasMore(result.hasMore);
			setCurrentPage(nextPage);
		} catch (error) {
			console.error('Failed to load more sessions:', error);
		} finally {
			setLoadingMore(false);
		}
	}, [currentPage, hasMore, loadingMore, debouncedSearch]);

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

		// ESC closes panel only if search is empty
		if (key.escape) {
			if (searchInput) {
				// Clear search if there's input
				setSearchInput('');
			} else {
				// Close panel if search is empty
				onClose();
			}
			return;
		}

		// Backspace removes last character from search
		if (key.backspace || key.delete) {
			setSearchInput(prev => prev.slice(0, -1));
			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev => {
				// 循环导航: 第一项 → 最后一项, 其他 → 前一项
				const newIndex = prev > 0 ? prev - 1 : sessions.length - 1;
				// Adjust scroll offset if needed
				if (newIndex < scrollOffset) {
					// Scrolling up
					setScrollOffset(newIndex);
				} else if (newIndex >= sessions.length - VISIBLE_ITEMS) {
					// Wrapped to end - scroll to show last items
					setScrollOffset(Math.max(0, sessions.length - VISIBLE_ITEMS));
				}
				return newIndex;
			});
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev => {
				// 循环导航: 最后一项 → 第一项, 其他 → 后一项
				const newIndex = prev < sessions.length - 1 ? prev + 1 : 0;

				// Check if we need to load more sessions
				// Load when approaching the end (within 5 items from the end)
				if (
					hasMore &&
					!loadingMore &&
					newIndex >= sessions.length - 5 &&
					newIndex !== 0
				) {
					void loadMoreSessions();
				}

				// Adjust scroll offset if needed
				if (newIndex >= scrollOffset + VISIBLE_ITEMS) {
					// Scrolling down
					setScrollOffset(newIndex - VISIBLE_ITEMS + 1);
				} else if (newIndex === 0) {
					// Wrapped to start - scroll to top
					setScrollOffset(0);
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
					// Reload sessions from first page
					const result = await sessionManager.listSessionsPaginated(
						0,
						PAGE_SIZE,
						debouncedSearch,
					);
					setSessions(result.sessions);
					setHasMore(result.hasMore);
					setTotalCount(result.total);
					setCurrentPage(0);
					setMarkedSessions(new Set());
					// Reset selection if needed
					if (
						selectedIndex >= result.sessions.length &&
						result.sessions.length > 0
					) {
						setSelectedIndex(result.sessions.length - 1);
					}
					setScrollOffset(0);
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

		// Add any printable character to search input (including Chinese/IME input)
		if (input && !key.ctrl && !key.meta) {
			// Accept all printable characters including Chinese characters from IME
			// Filter out arrow keys and other control sequences
			if (
				!key.upArrow &&
				!key.downArrow &&
				!key.leftArrow &&
				!key.rightArrow &&
				!key.return &&
				!key.escape &&
				!key.tab
			) {
				setSearchInput(prev => prev + input);
			}
		}
	});

	// Calculate visible sessions based on scroll offset
	const visibleSessions = sessions.slice(
		scrollOffset,
		scrollOffset + VISIBLE_ITEMS,
	);
	const hasMoreInView = sessions.length > scrollOffset + VISIBLE_ITEMS;
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
					Resume ({selectedIndex + 1}/{sessions.length}
					{totalCount > sessions.length && ` of ${totalCount}`})
					{currentSession && ` • ${currentSession.messageCount} msgs`}
					{markedSessions.size > 0 && (
						<Text color="yellow"> • {markedSessions.size} marked</Text>
					)}
					{loadingMore && <Text color="gray"> • Loading...</Text>}
				</Text>
				{searchInput ? (
					<Text color="green">
						Search: {searchInput}
						{searchInput !== debouncedSearch && (
							<Text color="gray"> (searching...)</Text>
						)}
					</Text>
				) : (
					<Text color="gray" dimColor>
						Type to search • ↑↓ navigate • Space mark • D delete • Enter select
						• ESC close
					</Text>
				)}
			</Box>
			{/* List content area - shows loading, empty state, or session list */}
			{loading ? (
				<Text color="gray" dimColor>
					Loading sessions...
				</Text>
			) : sessions.length === 0 ? (
				<Text color="gray" dimColor>
					{debouncedSearch
						? `No results for "${debouncedSearch}"`
						: 'No conversations found'}
				</Text>
			) : (
				<>
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
							cleanTitle.length > 50
								? cleanTitle.slice(0, 47) + '...'
								: cleanTitle;

						return (
							<Box key={session.id}>
								<Text color={isMarked ? 'green' : 'gray'}>
									{isMarked ? '✔ ' : '  '}
								</Text>
								<Text color={isSelected ? 'green' : 'gray'}>
									{isSelected ? '❯ ' : '  '}
								</Text>
								<Text
									color={isSelected ? 'cyan' : isMarked ? 'green' : 'white'}
								>
									{truncatedLabel}
								</Text>
								<Text color="gray" dimColor>
									{' '}
									• {timeStr}
								</Text>
							</Box>
						);
					})}
				</>
			)}
			{!loading && sessions.length > 0 && hasMoreInView && (
				<Text color="gray" dimColor>
					{' '}
					↓ {sessions.length - scrollOffset - VISIBLE_ITEMS} more below
					{hasMore && ' (scroll to load more)'}
				</Text>
			)}
		</Box>
	);
}
