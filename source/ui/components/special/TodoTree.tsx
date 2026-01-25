import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import chalk from 'chalk';
import {useI18n} from '../../../i18n/index.js';
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
	const {t} = useI18n();

	if (todos.length === 0) {
		return null;
	}

	const PAGE_SIZE = 5;
	const totalCount = todos.length;
	const completedCount = todos.reduce(
		(acc, t) => acc + (t.status === 'completed' ? 1 : 0),
		0,
	);

	const sortedTodos = useMemo(() => {
		// 未完成优先；同一组内保持原始顺序（稳定排序）。
		return todos
			.map((t, originalIndex) => ({t, originalIndex}))
			.slice()
			.sort((a, b) => {
				const aCompleted = a.t.status === 'completed' ? 1 : 0;
				const bCompleted = b.t.status === 'completed' ? 1 : 0;
				if (aCompleted !== bCompleted) return aCompleted - bCompleted;
				return a.originalIndex - b.originalIndex;
			})
			.map(({t}) => t);
	}, [todos]);

	const pageCount = Math.max(1, Math.ceil(sortedTodos.length / PAGE_SIZE));
	const [pageIndex, setPageIndex] = useState(0);

	useEffect(() => {
		// 数据变化时，防止 pageIndex 越界。
		setPageIndex(p => Math.min(p, pageCount - 1));
	}, [pageCount]);

	useInput((_input, key) => {
		// 仅 Tab：下一页；到最后自动从头开始循环。
		if (!key.tab || pageCount <= 1) return;

		setPageIndex(p => (p + 1) % pageCount);
	});

	const visibleTodos = sortedTodos.slice(
		pageIndex * PAGE_SIZE,
		pageIndex * PAGE_SIZE + PAGE_SIZE,
	);
	const hiddenCount = Math.max(0, sortedTodos.length - visibleTodos.length);

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
			<Text key={`${todo.id}:${pageIndex}:${index}`}>
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
				<Text dimColor>
					{' '}
					[{pageIndex + 1}/{pageCount}] {t.toolConfirmation.commandPagerHint}
				</Text>
				{hiddenCount > 0 && <Text dimColor> +{hiddenCount} more</Text>}
			</Text>
			{visibleTodos.map((todo, index) => renderTodoLine(todo, index))}
		</Box>
	);
}
