import React from 'react';
import { Box, Text } from 'ink';

interface TodoItem {
	id: string;
	content: string;
	status: 'pending' | 'in_progress' | 'completed';
	parentId?: string;
}

interface TodoTreeProps {
	todos: TodoItem[];
}

/**
 * TODO Tree 组件 - 显示带复选框的任务树
 */
export default function TodoTree({ todos }: TodoTreeProps) {
	if (todos.length === 0) {
		return null;
	}

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
		switch (status) {
			case 'completed':
				return '[x]';
			case 'in_progress':
				return '[~]';
			case 'pending':
				return '[ ]';
		}
	};

	const getStatusColor = (status: TodoItem['status']) => {
		switch (status) {
			case 'completed':
				return 'green';
			case 'in_progress':
				return 'yellow';
			case 'pending':
				return 'gray';
		}
	};

	const renderTodo = (todo: TodoItem, depth: number = 0): React.ReactNode => {
		const children = childTodosMap.get(todo.id) || [];
		const indent = '  '.repeat(depth);
		const statusIcon = getStatusIcon(todo.status);
		const statusColor = getStatusColor(todo.status);

		return (
			<Box key={todo.id} flexDirection="column">
				<Box>
					<Text color={statusColor}>
						{indent}{statusIcon} {todo.content}
					</Text>
				</Box>
				{children.map(child => renderTodo(child, depth + 1))}
			</Box>
		);
	};

	return (
		<Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
			<Box marginBottom={0}>
				<Text bold color="cyan">
					TODO List
				</Text>
			</Box>
			{rootTodos.map(todo => renderTodo(todo))}
			<Box marginTop={0}>
				<Text dimColor color="gray">
					[ ] Pending · [~] In Progress · [x] Completed
				</Text>
			</Box>
		</Box>
	);
}
