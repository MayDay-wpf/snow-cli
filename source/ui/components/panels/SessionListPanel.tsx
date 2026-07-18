import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import {
	sessionManager,
	type SessionListItem,
} from '../../../utils/session/sessionManager.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';

type Props = {
	onSelectSession: (sessionId: string) => void;
	onClose: () => void;
	/**
	 * /goal resume 专用模式：
	 * - true：只显示带 hasGoal=true 且 goalStatus 可恢复的会话（paused/pursuing/budget-limited），
	 *   且禁用 R 键重命名、删除、搜索这些会扰动会话的功能（保持本面板只读用于挑选）。
	 *   每条会话额外渲染 goalStatus + 简短 objective。
	 * - false / undefined：常规 /resume 面板，全功能。
	 */
	goalOnly?: boolean;
};

export default function SessionListPanel({
	onSelectSession,
	onClose,
	goalOnly = false,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const {columns: terminalWidth} = useTerminalSize();
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
	const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
		null,
	);
	const [renameInput, setRenameInput] = useState('');
	const [isRenaming, setIsRenaming] = useState(false);
	const [pendingDeleteCount, setPendingDeleteCount] = useState(0);
	const pendingDeleteTimerRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		return () => {
			if (pendingDeleteTimerRef.current) {
				clearTimeout(pendingDeleteTimerRef.current);
			}
		};
	}, []);

	const VISIBLE_ITEMS = 10;
	const PAGE_SIZE = 20;
	const SEARCH_DEBOUNCE_MS = 600;

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
				// goalOnly 模式走专用 API（不分页，因为 goal 会话本身数量很少），
				// 并按搜索词在内存里过滤。
				if (goalOnly) {
					const all = await sessionManager.listGoalResumableSessions();
					const q = debouncedSearch.trim().toLowerCase();
					const filtered = q
						? all.filter(
								s =>
									s.title.toLowerCase().includes(q) ||
									(s.summary || '').toLowerCase().includes(q) ||
									s.id.toLowerCase().includes(q) ||
									(s.goalObjective || '').toLowerCase().includes(q),
						  )
						: all;
					setSessions(filtered);
					setHasMore(false);
					setTotalCount(filtered.length);
					setCurrentPage(0);
					setSelectedIndex(0);
					setScrollOffset(0);
					return;
				}
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
	}, [debouncedSearch, goalOnly]);

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

		// If in rename mode, handle rename input
		if (renamingSessionId) {
			if (key.escape) {
				setRenamingSessionId(null);
				setRenameInput('');
				return;
			}

			if (key.return && renameInput.trim()) {
				const handleRename = async () => {
					setIsRenaming(true);
					const success = await sessionManager.updateSessionTitle(
						renamingSessionId,
						renameInput.trim(),
					);
					if (success) {
						// Reload sessions to show updated title
						const result = await sessionManager.listSessionsPaginated(
							0,
							PAGE_SIZE,
							debouncedSearch,
						);
						setSessions(result.sessions);
						setHasMore(result.hasMore);
						setTotalCount(result.total);
						setCurrentPage(0);
					}
					setRenamingSessionId(null);
					setRenameInput('');
					setIsRenaming(false);
				};
				void handleRename();
				return;
			}

			if (key.backspace || key.delete) {
				setRenameInput(prev => prev.slice(0, -1));
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
					setRenameInput(prev => prev + input);
				}
			}
			return;
		}

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
			// goalOnly 模式下不允许标记选择（避免误删 goal 关键会话）
			if (goalOnly) return;
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

		if ((input === 'd' || input === 'D') && goalOnly) {
			// goalOnly 模式下禁用删除：本面板仅用于挑选要恢复的目标。
			return;
		}

		if (input === 'd' || input === 'D') {
			const idsToDelete: string[] =
				markedSessions.size > 0
					? Array.from(markedSessions)
					: sessions[selectedIndex]
					? [sessions[selectedIndex]!.id]
					: [];

			if (idsToDelete.length === 0) {
				return;
			}

			// First press: show confirmation prompt for 1 second
			if (pendingDeleteCount === 0) {
				setPendingDeleteCount(idsToDelete.length);
				if (pendingDeleteTimerRef.current) {
					clearTimeout(pendingDeleteTimerRef.current);
				}
				pendingDeleteTimerRef.current = setTimeout(() => {
					setPendingDeleteCount(0);
					pendingDeleteTimerRef.current = null;
				}, 1000);
				return;
			}

			// Second press within 1s: actually delete
			if (pendingDeleteTimerRef.current) {
				clearTimeout(pendingDeleteTimerRef.current);
				pendingDeleteTimerRef.current = null;
			}
			setPendingDeleteCount(0);

			const deleteSessions = async () => {
				await Promise.all(
					idsToDelete.map(id => sessionManager.deleteSession(id)),
				);
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
			void deleteSessions();
			return;
		}

		if (input === 'r' || input === 'R') {
			// goalOnly 模式下禁用重命名：本面板仅用于挑选。
			if (goalOnly) return;
			const currentSession = sessions[selectedIndex];
			if (currentSession) {
				setRenamingSessionId(currentSession.id);
				setRenameInput(currentSession.title || '');
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
		<Box paddingX={1} flexDirection="column">
			<Box height={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{'─'.repeat(Math.max(0, terminalWidth - 2))}
				</Text>
			</Box>
			<Box flexDirection="column">
				<Text color={theme.colors.menuInfo} bold>
					{goalOnly ? '/goal resume' : t.sessionListPanel.title} (
					{selectedIndex + 1}/{sessions.length}
					{totalCount > sessions.length && ` of ${totalCount}`})
					{currentSession &&
						` • ${
							currentSession.messageCount
						} ${t.sessionListPanel.messages.replace('{count}', '')}`}
					{markedSessions.size > 0 && (
						<Text color={theme.colors.warning}>
							{' '}
							•{' '}
							{t.sessionListPanel.marked.replace(
								'{count}',
								String(markedSessions.size),
							)}
						</Text>
					)}
					{loadingMore && (
						<Text color={theme.colors.menuSecondary}>
							{' '}
							• {t.sessionListPanel.loadingMore}
						</Text>
					)}
					{pendingDeleteCount > 0 && (
						<Text color={theme.colors.error || theme.colors.warning} bold>
							{' '}
							•{' '}
							{t.sessionListPanel.confirmDelete.replace(
								'{count}',
								String(pendingDeleteCount),
							)}
						</Text>
					)}
				</Text>
				{renamingSessionId ? (
					<Text color={theme.colors.warning}>
						{t.sessionListPanel.renamePrompt}:{' '}
						<Text color={theme.colors.text}>{renameInput}</Text>
						<Text color={theme.colors.warning}>▌</Text>
						{isRenaming && (
							<Text color={theme.colors.menuSecondary}>
								{' '}
								({t.sessionListPanel.renaming})
							</Text>
						)}
					</Text>
				) : (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.sessionListPanel.navigationHint}
					</Text>
				)}
			</Box>
			{!renamingSessionId && (
				<Box
					borderStyle="round"
					borderColor={
						searchInput ? theme.colors.success : theme.colors.menuSecondary
					}
					paddingX={1}
				>
					<Text
						color={
							searchInput ? theme.colors.success : theme.colors.menuSecondary
						}
					>
						⌕{' '}
					</Text>
					{searchInput ? (
						<Text color={theme.colors.text}>
							{searchInput}
							<Text color={theme.colors.success}>▌</Text>
						</Text>
					) : (
						<Text color={theme.colors.menuSecondary}>▌</Text>
					)}
					{searchInput && searchInput !== debouncedSearch && (
						<Text color={theme.colors.menuSecondary}>
							{' '}
							({t.sessionListPanel.searching})
						</Text>
					)}
				</Box>
			)}
			{loading ? (
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.sessionListPanel.loading}
				</Text>
			) : sessions.length === 0 ? (
				<Text color={theme.colors.menuSecondary} dimColor>
					{debouncedSearch
						? t.sessionListPanel.noResults.replace('{query}', debouncedSearch)
						: t.sessionListPanel.noConversations}
				</Text>
			) : (
				<>
					{hasPrevious && (
						<Text color={theme.colors.menuSecondary} dimColor>
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

						// goalOnly 模式：额外渲染 goalStatus + objective 摘要，
						// 用 dimColor 视觉上和会话标题区分开。
						const goalSuffix =
							goalOnly && session.goalStatus
								? ` [${session.goalStatus}${
										session.goalObjective
											? ` • ${
													session.goalObjective.length > 40
														? session.goalObjective.slice(0, 37) + '...'
														: session.goalObjective
											  }`
											: ''
								  }]`
								: '';

						return (
							<Box key={session.id}>
								<Text
									color={
										isMarked ? theme.colors.success : theme.colors.menuSecondary
									}
								>
									{isMarked ? '✔ ' : '  '}
								</Text>
								<Text
									color={
										isSelected
											? theme.colors.success
											: theme.colors.menuSecondary
									}
								>
									{isSelected ? '❯ ' : '  '}
								</Text>
								<Text
									color={
										isSelected
											? theme.colors.menuInfo
											: isMarked
											? theme.colors.success
											: theme.colors.text
									}
								>
									{truncatedLabel}
								</Text>
								<Text color={theme.colors.menuSecondary} dimColor>
									{' '}
									• {timeStr}
									{goalSuffix}
								</Text>
							</Box>
						);
					})}
				</>
			)}
			{!loading && sessions.length > 0 && hasMoreInView && (
				<Text color={theme.colors.menuSecondary} dimColor>
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
