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
								TODO Selection
							</Text>
						</Box>
						<Box marginTop={1}>
							<Alert variant="info">
								Scanning project for TODO comments...
							</Alert>
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
								TODO Selection
							</Text>
						</Box>
						<Box marginTop={1}>
							<Alert variant="info">
								No TODO comments found in the project
							</Alert>
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
								TODO Selection
							</Text>
						</Box>
						<Box marginTop={1}>
							<Alert variant="warning">
								No TODOs match "{searchQuery}" (Total: {totalCount})
							</Alert>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								Type to filter · Backspace to clear search
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
						Select TODOs{' '}
						{todos.length > 5 &&
							`(${selectedIndex + 1}/${todos.length})`}
						{searchQuery && ` - Filtering: "${searchQuery}"`}
						{searchQuery &&
							totalCount > todos.length &&
							` (${todos.length}/${totalCount})`}
					</Text>
				}
				header={
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{searchQuery
								? 'Type to filter · Backspace to clear · Space: toggle · Enter: confirm'
								: 'Type to search · Space: toggle · Enter: confirm · Esc: cancel'}
						</Text>
					</Box>
				}
				footer={
					selectedTodos.size > 0 ? (
						<Box marginTop={1}>
							<Text color={theme.colors.menuInfo}>
								{selectedTodos.size} TODO(s) selected
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
								{t.commandPanel.moreAbove.replace(
									'{count}',
									above.toString(),
								)}
							</>
						)}
						{below > 0 && (
							<>
								·{' '}
								{t.commandPanel.moreBelow.replace(
									'{count}',
									below.toString(),
								)}
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
