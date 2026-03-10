import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import type {TodoItem} from '../../../mcp/types/todo.types.js';
import {getTodoService} from '../../../utils/execution/mcpToolsManager.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {todoEvents} from '../../../utils/events/todoEvents.js';

type Props = {
	onClose: () => void;
};

type FlattenedTodoItem = TodoItem & {
	depth: number;
	hasChildren: boolean;
};

function getStatusIcon(status: TodoItem['status']): string {
	if (status === 'completed') return '✓';
	if (status === 'inProgress') return '~';
	return '○';
}

function buildFlattenedTodos(todos: TodoItem[]): FlattenedTodoItem[] {
	const byId = new Map(todos.map(todo => [todo.id, todo]));
	const childrenMap = new Map<string | undefined, TodoItem[]>();

	for (const todo of todos) {
		const parentKey =
			todo.parentId && byId.has(todo.parentId) ? todo.parentId : undefined;
		const siblings = childrenMap.get(parentKey) ?? [];
		siblings.push(todo);
		childrenMap.set(parentKey, siblings);
	}

	const flattened: FlattenedTodoItem[] = [];
	const visited = new Set<string>();

	const walk = (todo: TodoItem, depth: number) => {
		if (visited.has(todo.id)) {
			return;
		}

		visited.add(todo.id);
		const children = childrenMap.get(todo.id) ?? [];
		flattened.push({
			...todo,
			depth,
			hasChildren: children.length > 0,
		});

		for (const child of children) {
			walk(child, depth + 1);
		}
	};

	for (const rootTodo of childrenMap.get(undefined) ?? []) {
		walk(rootTodo, 0);
	}

	for (const todo of todos) {
		if (!visited.has(todo.id)) {
			walk(todo, 0);
		}
	}

	return flattened;
}

function isDescendantOf(
	todoId: string,
	ancestorId: string,
	byId: Map<string, TodoItem>,
): boolean {
	let current = byId.get(todoId);

	while (current?.parentId) {
		if (current.parentId === ancestorId) {
			return true;
		}
		current = byId.get(current.parentId);
	}

	return false;
}

export default function TodoListPanel({onClose}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [todos, setTodos] = useState<TodoItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [deleting, setDeleting] = useState(false);
	const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [markedTodoIds, setMarkedTodoIds] = useState<Set<string>>(new Set());
	const [pendingDelete, setPendingDelete] = useState(false);

	const todoService = useMemo(() => getTodoService(), []);
	const todoById = useMemo(
		() => new Map(todos.map(todo => [todo.id, todo])),
		[todos],
	);
	const flattenedTodos = useMemo(() => buildFlattenedTodos(todos), [todos]);
	const completedCount = useMemo(
		() => todos.filter(todo => todo.status === 'completed').length,
		[todos],
	);

	const maxVisibleItems = 5;

	const displayWindow = useMemo(() => {
		if (flattenedTodos.length <= maxVisibleItems) {
			return {
				items: flattenedTodos,
				startIndex: 0,
				endIndex: flattenedTodos.length,
			};
		}

		let startIndex = 0;
		if (selectedIndex >= maxVisibleItems) {
			startIndex = selectedIndex - maxVisibleItems + 1;
		}

		const endIndex = Math.min(
			flattenedTodos.length,
			startIndex + maxVisibleItems,
		);

		return {
			items: flattenedTodos.slice(startIndex, endIndex),
			startIndex,
			endIndex,
		};
	}, [flattenedTodos, selectedIndex]);

	const hiddenAboveCount = displayWindow.startIndex;
	const hiddenBelowCount = Math.max(
		0,
		flattenedTodos.length - displayWindow.endIndex,
	);
	const showOverflowHint = flattenedTodos.length > maxVisibleItems;

	const loadTodos = useCallback(async () => {
		const currentSession = sessionManager.getCurrentSession();
		setCurrentSessionId(currentSession?.id ?? null);

		if (!currentSession) {
			setTodos([]);
			setLoading(false);
			return;
		}

		setLoading(true);
		try {
			const todoList = await todoService.getTodoList(currentSession.id);
			setTodos(todoList?.todos ?? []);
		} catch (error) {
			console.error('Failed to load todo list:', error);
			setTodos([]);
		} finally {
			setLoading(false);
		}
	}, [todoService]);

	useEffect(() => {
		void loadTodos();
	}, [loadTodos]);

	useEffect(() => {
		const handleTodoUpdate = (data: {sessionId: string; todos: TodoItem[]}) => {
			if (data.sessionId === currentSessionId) {
				setTodos(data.todos);
			}
		};

		todoEvents.onTodoUpdate(handleTodoUpdate);
		return () => {
			todoEvents.offTodoUpdate(handleTodoUpdate);
		};
	}, [currentSessionId]);

	useEffect(() => {
		setSelectedIndex(prev => {
			if (flattenedTodos.length === 0) {
				return 0;
			}
			return Math.min(prev, flattenedTodos.length - 1);
		});
	}, [flattenedTodos.length]);

	useEffect(() => {
		setMarkedTodoIds(prev => {
			const next = new Set<string>();
			for (const todoId of prev) {
				if (todoById.has(todoId)) {
					next.add(todoId);
				}
			}
			return next;
		});
	}, [todoById]);

	useEffect(() => {
		if (markedTodoIds.size === 0 && pendingDelete) {
			setPendingDelete(false);
		}
	}, [markedTodoIds, pendingDelete]);

	const toggleCurrentTodo = useCallback(() => {
		const currentTodo = flattenedTodos[selectedIndex];
		if (!currentTodo) {
			return;
		}

		if (pendingDelete) {
			setPendingDelete(false);
		}

		setMarkedTodoIds(prev => {
			const next = new Set(prev);
			if (next.has(currentTodo.id)) {
				next.delete(currentTodo.id);
			} else {
				next.add(currentTodo.id);
			}
			return next;
		});
	}, [flattenedTodos, pendingDelete, selectedIndex]);

	const deleteMarkedTodos = useCallback(async () => {
		if (!currentSessionId || deleting) {
			return;
		}

		const candidateIds = Array.from(markedTodoIds);

		if (candidateIds.length === 0) {
			return;
		}

		const rootIds = candidateIds.filter(todoId => {
			return !candidateIds.some(otherId => {
				if (otherId === todoId) {
					return false;
				}
				return isDescendantOf(todoId, otherId, todoById);
			});
		});
		const rootIdSet = new Set(rootIds);
		const filteredTodos = todos.filter(todo => {
			if (rootIdSet.has(todo.id)) {
				return false;
			}

			return !rootIds.some(rootId => isDescendantOf(todo.id, rootId, todoById));
		});

		setDeleting(true);
		try {
			await todoService.saveTodoList(currentSessionId, filteredTodos);
			setTodos(filteredTodos);
			setMarkedTodoIds(new Set());
			setPendingDelete(false);
		} catch (error) {
			console.error('Failed to delete todo items:', error);
		} finally {
			setDeleting(false);
		}
	}, [currentSessionId, deleting, markedTodoIds, todoById, todoService, todos]);

	useInput((input, key) => {
		if (key.escape) {
			if (pendingDelete) {
				setPendingDelete(false);
				return;
			}

			onClose();
			return;
		}

		if (loading || deleting) {
			return;
		}

		if (pendingDelete) {
			if (
				key.return ||
				input === 'd' ||
				input === 'D' ||
				input === 'y' ||
				input === 'Y'
			) {
				void deleteMarkedTodos();
				return;
			}

			if (input === 'n' || input === 'N') {
				setPendingDelete(false);
				return;
			}

			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev =>
				prev > 0 ? prev - 1 : Math.max(0, flattenedTodos.length - 1),
			);
			return;
		}

		if (key.downArrow) {
			const maxIndex = Math.max(0, flattenedTodos.length - 1);
			setSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
			return;
		}

		if (input === ' ') {
			toggleCurrentTodo();
			return;
		}

		if (input === 'd' || input === 'D') {
			if (markedTodoIds.size > 0) {
				setPendingDelete(true);
			}
		}
	});

	if (loading) {
		return (
			<Box paddingX={1} flexDirection="column">
				<Text color={theme.colors.warning} bold>
					{t.todoListPanel.title}
				</Text>
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary}>
						<Spinner type="dots" /> {t.todoListPanel.loading}
					</Text>
				</Box>
			</Box>
		);
	}

	if (!currentSessionId) {
		return (
			<Box paddingX={1} flexDirection="column">
				<Text color={theme.colors.warning} bold>
					{t.todoListPanel.title}
				</Text>
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary}>
						{t.todoListPanel.noActiveSession}
					</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box paddingX={1} flexDirection="column">
			<Text color={theme.colors.warning} bold>
				{t.todoListPanel.title}{' '}
				<Text color={theme.colors.menuInfo}>
					({completedCount}/{todos.length})
				</Text>
			</Text>
			<Box marginTop={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{pendingDelete
						? t.todoListPanel.confirmModeHint
						: t.todoListPanel.hint}
					{showOverflowHint && hiddenAboveCount > 0 && (
						<>
							·{' '}
							{t.todoListPanel.moreAbove.replace(
								'{count}',
								hiddenAboveCount.toString(),
							)}
						</>
					)}
					{showOverflowHint && hiddenBelowCount > 0 && (
						<>
							·{' '}
							{t.todoListPanel.moreBelow.replace(
								'{count}',
								hiddenBelowCount.toString(),
							)}
						</>
					)}
				</Text>
			</Box>
			{deleting && (
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary}>
						<Spinner type="dots" /> {t.todoListPanel.deleting}
					</Text>
				</Box>
			)}
			{pendingDelete && markedTodoIds.size > 0 && (
				<Box marginTop={1}>
					<Text color={theme.colors.warning}>
						{t.todoListPanel.confirmDelete.replace(
							'{count}',
							markedTodoIds.size.toString(),
						)}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.todoListPanel.confirmDeleteHint}
					</Text>
				</Box>
			)}
			{flattenedTodos.length === 0 ? (
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary}>
						{t.todoListPanel.empty}
					</Text>
				</Box>
			) : (
				<Box marginTop={1} flexDirection="column">
					{displayWindow.items.map((todo, index) => {
						const originalIndex = displayWindow.startIndex + index;
						const isSelected = originalIndex === selectedIndex;
						const isMarked = markedTodoIds.has(todo.id);
						const indent = '  '.repeat(todo.depth);
						const branch = todo.depth > 0 ? '└─ ' : '';
						const statusIcon = getStatusIcon(todo.status);

						return (
							<Box key={todo.id} flexDirection="column">
								<Text
									color={
										isSelected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold
								>
									{isSelected ? '❯ ' : '  '}
									{isMarked ? '[x]' : '[ ]'} {indent}
									{branch}
									{statusIcon} {todo.content}
								</Text>
							</Box>
						);
					})}
				</Box>
			)}
			<Box marginTop={1}>
				<Text color={theme.colors.menuInfo}>
					{t.todoListPanel.selectedCount.replace(
						'{count}',
						markedTodoIds.size.toString(),
					)}
				</Text>
			</Box>
		</Box>
	);
}
