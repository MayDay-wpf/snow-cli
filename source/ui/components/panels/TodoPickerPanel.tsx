import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import type {TodoItem} from '../../../utils/core/todoScanner.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import PickerList from '../common/PickerList.js';

interface Props {
	todos: TodoItem[];
	selectedIndex: number;
	selectedTodos: Set<string>;
	visible: boolean;
	maxHeight?: number;
	isLoading?: boolean;
	searchQuery?: string;
	totalCount?: number;
}

const TodoPickerPanel = memo(
	({
		todos,
		selectedIndex,
		selectedTodos,
		visible,
		maxHeight,
		isLoading = false,
		searchQuery = '',
		totalCount = 0,
	}: Props) => {
		const {t} = useI18n();
		const {theme} = useTheme();

		if (!visible) {
			return null;
		}

		if (isLoading) {
			return (
				<Box flexDirection="column">
					<Box width="100%" flexDirection="column">
						<Box>
							<Text color={theme.colors.warning} bold>
								{t.todoPickerPanel.title}
							</Text>
						</Box>
						<Box marginTop={1}>
							<Alert variant="info">{t.todoPickerPanel.scanning}</Alert>
						</Box>
					</Box>
				</Box>
			);
		}

		if (todos.length === 0 && !searchQuery) {
			return (
				<Box flexDirection="column">
					<Box width="100%" flexDirection="column">
						<Box>
							<Text color={theme.colors.warning} bold>
								{t.todoPickerPanel.title}
							</Text>
						</Box>
						<Box marginTop={1}>
							<Alert variant="info">{t.todoPickerPanel.noTodosFound}</Alert>
						</Box>
					</Box>
				</Box>
			);
		}

		if (todos.length === 0 && searchQuery) {
			return (
				<Box flexDirection="column">
					<Box width="100%" flexDirection="column">
						<Box>
							<Text color={theme.colors.warning} bold>
								{t.todoPickerPanel.title}
							</Text>
						</Box>
						<Box marginTop={1}>
							<Alert variant="warning">
								{t.todoPickerPanel.noMatchSearch
									.replace('{searchQuery}', searchQuery)
									.replace('{totalCount}', totalCount.toString())}
							</Alert>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.todoPickerPanel.typeToClearSearch}
							</Text>
						</Box>
					</Box>
				</Box>
			);
		}

		return (
			<PickerList
				items={todos}
				selectedIndex={selectedIndex}
				visible={visible}
				maxDisplayItems={maxHeight}
				getItemKey={(todo: TodoItem) => todo.id}
				title={
					<Text color={theme.colors.warning} bold>
						{t.todoPickerPanel.selectTodos}{' '}
						{todos.length > 5 && `(${selectedIndex + 1}/${todos.length})`}
						{searchQuery &&
							` ${t.todoPickerPanel.filteringLabel.replace(
								'{searchQuery}',
								searchQuery,
							)}`}
						{searchQuery &&
							totalCount > todos.length &&
							` (${todos.length}/${totalCount})`}
					</Text>
				}
				header={
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{searchQuery
								? t.todoPickerPanel.typeToFilterHint
								: t.todoPickerPanel.typeToSearchHint}
						</Text>
					</Box>
				}
				footer={
					selectedTodos.size > 0 ? (
						<Box marginTop={1}>
							<Text color={theme.colors.menuInfo}>
								{t.todoPickerPanel.selectedCount.replace(
									'{count}',
									selectedTodos.size.toString(),
								)}
							</Text>
						</Box>
					) : undefined
				}
				scrollHintFormat={(above, below) => (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.commandPanel.scrollHint}
						{above > 0 && (
							<>
								·{' '}
								{t.commandPanel.moreAbove.replace('{count}', above.toString())}
							</>
						)}
						{below > 0 && (
							<>
								·{' '}
								{t.commandPanel.moreBelow.replace('{count}', below.toString())}
							</>
						)}
					</Text>
				)}
				renderItem={(todo: TodoItem, isSelected: boolean) => {
					const isChecked = selectedTodos.has(todo.id);
					return (
						<>
							<Text
								color={
									isSelected
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold
							>
								{isSelected ? '❯ ' : '  '}
								{isChecked ? '[✓]' : '[ ]'} {todo.file}:{todo.line}
							</Text>
							<Box marginLeft={5} overflow="hidden">
								<Text
									color={
										isSelected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									dimColor={!isSelected}
									wrap="truncate-end"
								>
									└─ {todo.content}
								</Text>
							</Box>
						</>
					);
				}}
			/>
		);
	},
);

TodoPickerPanel.displayName = 'TodoPickerPanel';

export default TodoPickerPanel;
