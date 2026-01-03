import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import {useTheme} from '../../contexts/ThemeContext.js';

interface TodoItem {
	id: string;
	content: string;
	status: 'pending' | 'completed';
	parentId?: string;
}

interface TodoTreeProps {
	todos: TodoItem[];
}

/**
 * TODO Tree 组件 - 显示带连接线的紧凑任务树
 */
export default function TodoTree({todos}: TodoTreeProps) {
	const {theme} = useTheme();

	if (todos.length === 0) {
		return null;
	}

	// 统计完成进度
	const completedCount = todos.filter(t => t.status === 'completed').length;
	const totalCount = todos.length;

	// 已完成项隐藏逻辑：保底5条，溢出部分隐藏
	// pending 永远全部展示
	const MAX_VISIBLE_COMPLETED = 5;
	const pendingTodos = todos.filter(t => t.status === 'pending');
	const completedTodos = todos.filter(t => t.status === 'completed');

	// 已完成项按时间倒序（假设id包含时间戳，后创建的id更大）
	// 只保留最近的 MAX_VISIBLE_COMPLETED 条
	const visibleCompletedTodos = completedTodos.slice(-MAX_VISIBLE_COMPLETED);
	const hiddenCompletedCount =
		completedTodos.length - visibleCompletedTodos.length;

	// 可见的todo集合
	const visibleTodoIds = new Set([
		...pendingTodos.map(t => t.id),
		...visibleCompletedTodos.map(t => t.id),
	]);
	const visibleTodos = [...pendingTodos, ...visibleCompletedTodos];

	// 按照层级关系组织 TODO（仅基于可见的todos）
	// 若父节点不可见但子节点可见，子节点提升为root
	const rootTodos = visibleTodos.filter(
		t => !t.parentId || !visibleTodoIds.has(t.parentId),
	);
	const childTodosMap = new Map<string, TodoItem[]>();

	visibleTodos.forEach(todo => {
		// 只有当父节点也可见时，才作为子节点
		if (todo.parentId && visibleTodoIds.has(todo.parentId)) {
			const children = childTodosMap.get(todo.parentId) || [];
			children.push(todo);
			childTodosMap.set(todo.parentId, children);
		}
	});

	const getStatusIcon = (status: TodoItem['status']) => {
		return status === 'completed' ? '✓' : '○';
	};

	const getStatusColor = (status: TodoItem['status']) => {
		return status === 'completed'
			? theme.colors.success
			: theme.colors.menuSecondary;
	};

	// 渲染单个 TODO 项，带连接线
	const renderTodo = (
		todo: TodoItem,
		depth: number = 0,
		isLast: boolean = true,
		parentPrefixes: string[] = [],
	): React.ReactNode => {
		const children = childTodosMap.get(todo.id) || [];
		const statusIcon = getStatusIcon(todo.status);
		const statusColor = getStatusColor(todo.status);

		// 构建前缀：继承父级的连接线状态
		let prefix = '';
		if (depth > 0) {
			prefix = parentPrefixes.join('');
			prefix += isLast ? '└─' : '├─';
		}

		// 为子节点准备的前缀
		const childPrefixes = [...parentPrefixes];
		if (depth > 0) {
			childPrefixes.push(isLast ? '  ' : '│ ');
		}

		// 使用 chalk 直接着色，避免 ink 自动换行时颜色丢失
		// statusColor 可能是命名颜色(如 'gray')或 hex 格式(如 '#666666')
		const applyColor = (text: string) => {
			return statusColor.startsWith('#')
				? chalk.hex(statusColor)(text)
				: (chalk as any)[statusColor]?.(text) ?? text;
		};

		return (
			<Box key={todo.id} flexDirection="column">
				<Text>
					{applyColor(prefix)}
					{applyColor(statusIcon)}
					{applyColor(' ' + todo.content)}
				</Text>
				{children.map((child, index) =>
					renderTodo(
						child,
						depth + 1,
						index === children.length - 1,
						childPrefixes,
					),
				)}
			</Box>
		);
	};

	return (
		<Box flexDirection="column" paddingLeft={2}>
			<Text>
				<Text dimColor>TODO </Text>
				<Text color={theme.colors.menuInfo}>
					({completedCount}/{totalCount})
				</Text>
				{hiddenCompletedCount > 0 && (
					<Text dimColor> +{hiddenCompletedCount} completed hidden</Text>
				)}
			</Text>
			{rootTodos.map((todo, index) =>
				renderTodo(todo, 0, index === rootTodos.length - 1, []),
			)}
		</Box>
	);
}
