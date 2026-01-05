import React from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import {useTheme} from '../../contexts/ThemeContext.js';

interface TodoItem {
	id: string;
	content: string;
	// 运行时可能出现非标准值，仅将 'completed' 视为已完成；其他值一律按未完成处理。
	status: string;
	parentId?: string;
}

interface TodoTreeProps {
	todos: TodoItem[];
}

/**
 * TODO Tree 组件 - 显示紧凑任务列表
 */
export default function TodoTree({todos}: TodoTreeProps) {
	const {theme} = useTheme();

	if (todos.length === 0) {
		return null;
	}

	const MAX_VISIBLE_TOTAL = 5;
	const totalCount = todos.length;
	const completedCount = todos.reduce(
		(acc, t) => acc + (t.status === 'completed' ? 1 : 0),
		0,
	);

	let visibleTodos: TodoItem[];
	let hiddenCompletedCount = 0;

	// 全是未完成（包含非标准 status）：全部显示
	if (completedCount === 0) {
		visibleTodos = todos;
	} else if (completedCount === totalCount) {
		// 全是已完成：只显示最后 5 条
		visibleTodos = todos.slice(-MAX_VISIBLE_TOTAL);
		hiddenCompletedCount = Math.max(0, totalCount - visibleTodos.length);
	} else {
		// 混合：按规则裁剪已完成
		const pendingCount = totalCount - completedCount;
		const EXTRA_COMPLETED_WHEN_PENDING_AT_LEAST_MAX = 2;

		// 先标记所有未完成可见（未完成始终全部显示）
		const visibleMask = new Array<boolean>(totalCount).fill(false);
		for (let i = 0; i < totalCount; i++) {
			if (todos[i]!.status !== 'completed') visibleMask[i] = true;
		}

		// 再从尾部补齐已完成：
		// - 未完成 < 5：补齐到总数最多 5 条
		// - 未完成 >= 5：额外显示 2 条已完成（总可见数会超过 5）
		let remainingSlots =
			pendingCount >= MAX_VISIBLE_TOTAL
				? EXTRA_COMPLETED_WHEN_PENDING_AT_LEAST_MAX
				: MAX_VISIBLE_TOTAL - pendingCount;
		for (let i = totalCount - 1; i >= 0 && remainingSlots > 0; i--) {
			if (todos[i]!.status === 'completed' && !visibleMask[i]) {
				visibleMask[i] = true;
				remainingSlots--;
			}
		}

		visibleTodos = todos.filter((_, i) => visibleMask[i]!);

		const visibleCompletedCount = visibleTodos.reduce(
			(acc, t) => acc + (t.status === 'completed' ? 1 : 0),
			0,
		);
		hiddenCompletedCount = Math.max(0, completedCount - visibleCompletedCount);
	}

	const getStatusIcon = (status: string) => {
		return status === 'completed' ? '✓' : '○';
	};

	const getStatusColor = (status: string) => {
		return status === 'completed'
			? theme.colors.success
			: theme.colors.menuSecondary;
	};

	const renderTodoLine = (todo: TodoItem, index: number): React.ReactNode => {
		const statusIcon = getStatusIcon(todo.status);
		const statusColor = getStatusColor(todo.status);

		const applyColor = (text: string) => {
			return statusColor.startsWith('#')
				? chalk.hex(statusColor)(text)
				: (chalk as any)[statusColor]?.(text) ?? text;
		};

		return (
			<Text key={`${todo.id}:${index}`}>
				{applyColor(statusIcon)}
				{applyColor(' ' + todo.content)}
			</Text>
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
			{visibleTodos.map((todo, index) => renderTodoLine(todo, index))}
		</Box>
	);
}
