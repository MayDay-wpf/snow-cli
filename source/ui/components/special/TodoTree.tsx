import React from 'react';
import {Box, Text} from 'ink';
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

	// 按照层级关系组织 TODO
	const rootTodos = todos.filter(t => !t.parentId);
	const childTodosMap = new Map<string, TodoItem[]>();

	todos.forEach(todo => {
		if (todo.parentId) {
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

		return (
			<Box key={todo.id} flexDirection="column">
				<Text>
					<Text dimColor>{prefix}</Text>
					<Text color={statusColor}>{statusIcon}</Text>
					<Text color={statusColor} dimColor={todo.status === 'completed'}>
						{' '}
						{todo.content}
					</Text>
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
			</Text>
			{rootTodos.map((todo, index) =>
				renderTodo(todo, 0, index === rootTodos.length - 1, []),
			)}
		</Box>
	);
}
