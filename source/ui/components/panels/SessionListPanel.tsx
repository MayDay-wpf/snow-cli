import React, {useState, useEffect, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {
	sessionManager,
	type SessionListItem,
} from '../../../utils/session/sessionManager.js';
import {useI18n} from '../../../i18n/index.js';

type Props = {
	onSelectSession: (sessionId: string) => void;
	onClose: () => void;
};

export default function SessionListPanel({onSelectSession, onClose}: Props) {
	const {t} = useI18n();
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

	const VISIBLE_ITEMS = 5;
	const PAGE_SIZE = 20;
	const SEARCH_DEBOUNCE_MS = 300;

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchInput);
		}, SEARCH_DEBOUNCE_MS);

		return () => clearTimeout(timer);
	}, [searchInput]);

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

	const formatDate = useCallback(
		(timestamp: number): string => {
			const date = new Date(timestamp);
			const now = new Date();
			const diffMs = now.getTime() - date.getTime();
			const diffMinutes = Math.floor(diffMs / (1000 * 60));
			const diffHours = Math.floor(diffMinutes / 60);
			const diffDays = Math.floor(diffHours / 24);

			if (diffMinutes < 1) return t.sessionListPanel.now;
			if (diffMinutes < 60) return `${diffMinutes}m`;
			if (diffHours < 24) return `${diffHours}h`;
			if (diffDays < 7) return `${diffDays}d`;
			return date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'});
		},
		[t],
	);

	useInput((input, key) => {
		if (loading) return;

		if (key.escape) {
			if (searchInput) {
				setSearchInput('');
			} else {
				onClose();
			}
			return;
		}

		if (key.backspace || key.delete) {
			setSearchInput(prev => prev.slice(0, -1));
			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev => {
				const newIndex = prev > 0 ? prev - 1 : sessions.length - 1;
				if (newIndex < scrollOffset) {
					setScrollOffset(newIndex);
				} else if (newIndex >= sessions.length - VISIBLE_ITEMS) {
					setScrollOffset(Math.max(0, sessions.length - VISIBLE_ITEMS));
				}
				return newIndex;
			});
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev => {
				const newIndex = prev < sessions.length - 1 ? prev + 1 : 0;

				if (
					hasMore &&
					!loadingMore &&
					newIndex >= sessions.length - 5 &&
					newIndex !== 0
				) {
					void loadMoreSessions();
				}

				if (newIndex >= scrollOffset + VISIBLE_ITEMS) {
					setScrollOffset(newIndex - VISIBLE_ITEMS + 1);
				} else if (newIndex === 0) {
					setScrollOffset(0);
				}
				return newIndex;
			});
			return;
		}

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

		if (input === 'd' || input === 'D') {
			if (markedSessions.size > 0) {
				const deleteMarked = async () => {
					const ids = Array.from(markedSessions);
					await Promise.all(ids.map(id => sessionManager.deleteSession(id)));
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

		if (input && !key.ctrl && !key.meta) {
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
					{t.sessionListPanel.title} ({selectedIndex + 1}/{sessions.length}
					{totalCount > sessions.length && ` of ${totalCount}`})
					{currentSession &&
						` • ${currentSession.messageCount} ${t.sessionListPanel.messages.replace('{count}', '')}`}
					{markedSessions.size > 0 && (
						<Text color="yellow">
							{' '}
							•{' '}
							{t.sessionListPanel.marked.replace(
								'{count}',
								String(markedSessions.size),
							)}
						</Text>
					)}
					{loadingMore && (
						<Text color="gray"> • {t.sessionListPanel.loadingMore}</Text>
					)}
				</Text>
				{searchInput ? (
					<Text color="green">
						{t.sessionListPanel.searchLabel} {searchInput}
						{searchInput !== debouncedSearch && (
							<Text color="gray"> ({t.sessionListPanel.searching})</Text>
						)}
					</Text>
				) : (
					<Text color="gray" dimColor>
						{t.sessionListPanel.navigationHint}
					</Text>
				)}
			</Box>
			{loading ? (
				<Text color="gray" dimColor>
					{t.sessionListPanel.loading}
				</Text>
			) : sessions.length === 0 ? (
				<Text color="gray" dimColor>
					{debouncedSearch
						? t.sessionListPanel.noResults.replace('{query}', debouncedSearch)
						: t.sessionListPanel.noConversations}
				</Text>
			) : (
				<>
					{hasPrevious && (
						<Text color="gray" dimColor>
							{' '}
							{t.sessionListPanel.moreAbove.replace(
								'{count}',
								String(scrollOffset),
							)}
						</Text>
					)}
					{visibleSessions.map((session, index) => {
						const actualIndex = scrollOffset + index;
						const isSelected = actualIndex === selectedIndex;
						const isMarked = markedSessions.has(session.id);
						const cleanTitle = (
							session.title || t.sessionListPanel.untitled
						).replace(/[\r\n\t]+/g, ' ');
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
					{t.sessionListPanel.moreBelow.replace(
						'{count}',
						String(sessions.length - scrollOffset - VISIBLE_ITEMS),
					)}
					{hasMore && ` ${t.sessionListPanel.scrollToLoadMore}`}
				</Text>
			)}
		</Box>
	);
}
