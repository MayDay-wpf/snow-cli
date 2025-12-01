import React, {useState, useEffect, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import {useTheme} from '../contexts/ThemeContext.js';
import {useI18n} from '../../i18n/index.js';
import {
	taskManager,
	type TaskListItem,
	type Task,
} from '../../utils/task/taskManager.js';

type Props = {
	onBack: () => void;
	onResumeTask?: (taskId?: string) => void;
};

export default function TaskManagerScreen({onBack, onResumeTask}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [tasks, setTasks] = useState<TaskListItem[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [markedTasks, setMarkedTasks] = useState<Set<string>>(new Set());
	const [isLoading, setIsLoading] = useState(true);
	const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
	const [detailTask, setDetailTask] = useState<Task | null>(null);
	const [pendingAction, setPendingAction] = useState<{
		type: 'delete' | 'continue';
		taskId?: string;
		timestamp: number;
	} | null>(null);

	const VISIBLE_ITEMS = 5;

	const loadTasks = useCallback(async () => {
		setIsLoading(true);
		try {
			const taskList = await taskManager.listTasks();
			setTasks(taskList);
		} catch (error) {
			console.error('Failed to load tasks:', error);
			setTasks([]);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadTasks();
	}, [loadTasks]);

	useEffect(() => {
		if (pendingAction) {
			const timer = setTimeout(() => {
				setPendingAction(null);
			}, 2000);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [pendingAction]);

	const handleDeleteTask = useCallback(
		async (taskId: string) => {
			if (!taskId) return;
			const success = await taskManager.deleteTask(taskId);
			if (success) {
				await loadTasks();
				if (selectedIndex >= tasks.length - 1 && selectedIndex > 0) {
					setSelectedIndex(selectedIndex - 1);
				}
			}
		},
		[loadTasks, selectedIndex, tasks.length],
	);

	useInput((input, key) => {
		if (isLoading) return;

		if ((input === 'c' || input === 'C') && !key.ctrl) {
			if (viewMode === 'detail' && detailTask) {
				// 检查任务是否已完成
				if (detailTask.status !== 'completed') {
					setPendingAction({
						type: 'continue',
						taskId: detailTask.id,
						timestamp: Date.now(),
					});
					return;
				}

				if (
					pendingAction?.type === 'continue' &&
					pendingAction.taskId === detailTask.id &&
					Date.now() - pendingAction.timestamp < 2000
				) {
					setPendingAction(null);
					void (async () => {
						const sessionId = await taskManager.convertTaskToSession(
							detailTask.id,
						);
						if (sessionId && onResumeTask) {
							onResumeTask();
						}
					})();
				} else {
					setPendingAction({
						type: 'continue',
						taskId: detailTask.id,
						timestamp: Date.now(),
					});
				}
			}
			return;
		}

		if (key.escape) {
			if (viewMode === 'detail') {
				setViewMode('list');
				setDetailTask(null);
			} else {
				onBack();
			}
			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev => {
				const newIndex = Math.max(0, prev - 1);
				if (newIndex < scrollOffset) {
					setScrollOffset(newIndex);
				}
				return newIndex;
			});
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev => {
				const newIndex = Math.min(tasks.length - 1, prev + 1);
				if (newIndex >= scrollOffset + VISIBLE_ITEMS) {
					setScrollOffset(newIndex - VISIBLE_ITEMS + 1);
				}
				return newIndex;
			});
			return;
		}

		if (input === ' ') {
			const currentTask = tasks[selectedIndex];
			if (currentTask) {
				setMarkedTasks(prev => {
					const next = new Set(prev);
					if (next.has(currentTask.id)) {
						next.delete(currentTask.id);
					} else {
						next.add(currentTask.id);
					}
					return next;
				});
			}
			return;
		}

		if (input === 'd' || input === 'D') {
			if (markedTasks.size > 0) {
				if (
					pendingAction?.type === 'delete' &&
					!pendingAction.taskId &&
					Date.now() - pendingAction.timestamp < 2000
				) {
					setPendingAction(null);
					const deleteMarked = async () => {
						const ids = Array.from(markedTasks);
						await Promise.all(ids.map(id => taskManager.deleteTask(id)));
						await loadTasks();
						setMarkedTasks(new Set());
						if (selectedIndex >= tasks.length && tasks.length > 0) {
							setSelectedIndex(tasks.length - 1);
						}
					};
					void deleteMarked();
				} else {
					setPendingAction({
						type: 'delete',
						timestamp: Date.now(),
					});
				}
			} else if (tasks.length > 0) {
				const currentTaskId = tasks[selectedIndex]?.id || '';
				if (
					pendingAction?.type === 'delete' &&
					pendingAction.taskId === currentTaskId &&
					Date.now() - pendingAction.timestamp < 2000
				) {
					setPendingAction(null);
					void handleDeleteTask(currentTaskId);
				} else {
					setPendingAction({
						type: 'delete',
						taskId: currentTaskId,
						timestamp: Date.now(),
					});
				}
			}
			return;
		}

		if (input === 'r' || input === 'R') {
			if (viewMode === 'list') {
				void loadTasks();
			}
			return;
		}

		if (key.return && tasks.length > 0) {
			const selectedTask = tasks[selectedIndex];
			if (selectedTask) {
				void (async () => {
					const fullTask = await taskManager.loadTask(selectedTask.id);
					if (fullTask) {
						setDetailTask(fullTask);
						setViewMode('detail');
					}
				})();
			}
			return;
		}
	});

	const getStatusColor = useCallback((status: TaskListItem['status']) => {
		switch (status) {
			case 'pending':
				return 'yellow';
			case 'running':
				return 'cyan';
			case 'completed':
				return 'green';
			case 'failed':
				return 'red';
			default:
				return 'gray';
		}
	}, []);

	const getStatusIcon = useCallback((status: TaskListItem['status']) => {
		switch (status) {
			case 'pending':
				return '○';
			case 'running':
				return '◐';
			case 'completed':
				return '●';
			case 'failed':
				return '✗';
			default:
				return '?';
		}
	}, []);

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

	if (isLoading) {
		return (
			<Box flexDirection="column" paddingX={1}>
				<Box
					borderStyle="round"
					borderColor={theme.colors.menuInfo as any}
					paddingX={1}
				>
					<Text color={theme.colors.menuSecondary as any} dimColor>
						{t.taskManager.loadingTasks}
					</Text>
				</Box>
			</Box>
		);
	}

	if (tasks.length === 0) {
		return (
			<Box flexDirection="column" paddingX={1}>
				<Box
					borderStyle="round"
					borderColor={theme.colors.warning as any}
					paddingX={1}
				>
					<Text color={theme.colors.menuSecondary as any} dimColor>
						{t.taskManager.noTasksFound} • {t.taskManager.noTasksHint} •{' '}
						{t.taskManager.escToClose}
					</Text>
				</Box>
			</Box>
		);
	}

	if (viewMode === 'detail' && detailTask) {
		return (
			<Box flexDirection="column" paddingX={1}>
				<Box
					borderStyle="round"
					borderColor={theme.colors.menuInfo as any}
					paddingX={1}
					flexDirection="column"
				>
					<Box flexDirection="column" marginBottom={1}>
						<Text color={theme.colors.menuInfo as any} bold>
							{t.taskManager.taskDetailsTitle}
						</Text>
						<Text color={theme.colors.menuSecondary as any} dimColor>
							{t.taskManager.continueHint} • {t.taskManager.backToList}
						</Text>
					</Box>

					<Box flexDirection="column" gap={1}>
						<Box flexDirection="column">
							<Text color={theme.colors.menuSecondary as any}>
								{t.taskManager.titleLabel}
							</Text>
							<Text>{detailTask.title || t.taskManager.untitled}</Text>
						</Box>

						<Box flexDirection="column">
							<Text color={theme.colors.menuSecondary as any}>
								{t.taskManager.statusLabel}
							</Text>
							<Text color={getStatusColor(detailTask.status)}>
								{getStatusIcon(detailTask.status)} {detailTask.status}
							</Text>
						</Box>

						<Box flexDirection="column">
							<Text color={theme.colors.menuSecondary as any}>
								{t.taskManager.createdLabel}
							</Text>
							<Text>{new Date(detailTask.createdAt).toLocaleString()}</Text>
						</Box>

						<Box flexDirection="column">
							<Text color={theme.colors.menuSecondary as any}>
								{t.taskManager.updatedLabel}
							</Text>
							<Text>{new Date(detailTask.updatedAt).toLocaleString()}</Text>
						</Box>

						<Box flexDirection="column">
							<Text color={theme.colors.menuSecondary as any}>
								{t.taskManager.messagesLabel.replace(
									'{count}',
									String(detailTask.messages.length),
								)}
							</Text>
						</Box>
					</Box>
				</Box>
				{pendingAction?.type === 'continue' &&
					pendingAction.taskId === detailTask.id && (
						<Box marginTop={1}>
							<Alert variant="warning">
								{detailTask.status !== 'completed'
									? t.taskManager.taskNotCompleted
									: t.taskManager.confirmConvertToSession}
							</Alert>
						</Box>
					)}
			</Box>
		);
	}

	const visibleTasks = tasks.slice(scrollOffset, scrollOffset + VISIBLE_ITEMS);
	const hasMore = tasks.length > scrollOffset + VISIBLE_ITEMS;
	const hasPrevious = scrollOffset > 0;
	const currentTask = tasks[selectedIndex];

	return (
		<Box flexDirection="column" paddingX={1}>
			<Box
				borderStyle="round"
				borderColor={theme.colors.menuInfo as any}
				paddingX={1}
				flexDirection="column"
			>
				<Box flexDirection="column">
					<Text color={theme.colors.menuInfo as any} dimColor>
						{t.taskManager.tasksCount
							.replace('{current}', String(selectedIndex + 1))
							.replace('{total}', String(tasks.length))}
						{currentTask &&
							` • ${t.taskManager.messagesCount.replace(
								'{count}',
								String(currentTask.messageCount),
							)}`}
						{markedTasks.size > 0 && (
							<Text color={theme.colors.warning as any}>
								{' '}
								•{' '}
								{t.taskManager.markedCount.replace(
									'{count}',
									String(markedTasks.size),
								)}
							</Text>
						)}
					</Text>
					<Text color={theme.colors.menuSecondary as any} dimColor>
						{t.taskManager.navigationHint}
					</Text>
				</Box>
				{hasPrevious && (
					<Text color={theme.colors.menuSecondary as any} dimColor>
						{' '}
						{t.taskManager.moreAbove.replace('{count}', String(scrollOffset))}
					</Text>
				)}
				{visibleTasks.map((task, index) => {
					const actualIndex = scrollOffset + index;
					const isSelected = actualIndex === selectedIndex;
					const isMarked = markedTasks.has(task.id);
					const cleanTitle = (task.title || t.taskManager.untitled).replace(
						/[\r\n\t]+/g,
						' ',
					);
					const timeStr = formatDate(task.updatedAt);
					const truncatedTitle =
						cleanTitle.length > 50
							? cleanTitle.slice(0, 47) + '...'
							: cleanTitle;

					return (
						<Text key={task.id}>
							<Text
								color={
									isSelected ? (theme.colors.menuSelected as any) : 'white'
								}
							>
								{isSelected ? '❯ ' : '  '}
								{isMarked && (
									<Text color={theme.colors.warning as any} bold>
										●{' '}
									</Text>
								)}
								<Text color={getStatusColor(task.status)}>
									{getStatusIcon(task.status)}
								</Text>{' '}
								{truncatedTitle}
							</Text>
							<Text color={theme.colors.menuSecondary as any} dimColor>
								{' '}
								• {timeStr}
							</Text>
						</Text>
					);
				})}
				{hasMore && (
					<Text color={theme.colors.menuSecondary as any} dimColor>
						{' '}
						{t.taskManager.moreBelow.replace(
							'{count}',
							String(tasks.length - scrollOffset - VISIBLE_ITEMS),
						)}
					</Text>
				)}
			</Box>
			{pendingAction?.type === 'delete' && (
				<Box marginTop={1}>
					<Alert variant="warning">
						{pendingAction.taskId
							? t.taskManager.deleteConfirm
							: t.taskManager.deleteMultipleConfirm.replace(
									'{count}',
									String(markedTasks.size),
							  )}
					</Alert>
				</Box>
			)}
		</Box>
	);
}
