import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import type {TodoItem} from '../../utils/todoScanner.js';

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
		// Fixed maximum display items to prevent rendering issues
		const MAX_DISPLAY_ITEMS = 5;
		const effectiveMaxItems = maxHeight
			? Math.min(maxHeight, MAX_DISPLAY_ITEMS)
			: MAX_DISPLAY_ITEMS;

		// Limit displayed todos
		const displayedTodos = useMemo(() => {
			if (todos.length <= effectiveMaxItems) {
				return todos;
			}

			// Show todos around the selected index
			const halfWindow = Math.floor(effectiveMaxItems / 2);
			let startIndex = Math.max(0, selectedIndex - halfWindow);
			let endIndex = Math.min(todos.length, startIndex + effectiveMaxItems);

			// Adjust if we're near the end
			if (endIndex - startIndex < effectiveMaxItems) {
				startIndex = Math.max(0, endIndex - effectiveMaxItems);
			}

			return todos.slice(startIndex, endIndex);
		}, [todos, selectedIndex, effectiveMaxItems]);

		// Calculate actual selected index in the displayed subset
		const displayedSelectedIndex = useMemo(() => {
			return displayedTodos.findIndex(todo => {
				const originalIndex = todos.indexOf(todo);
				return originalIndex === selectedIndex;
			});
		}, [displayedTodos, todos, selectedIndex]);

		// Don't show panel if not visible
		if (!visible) {
			return null;
		}

		// Show loading state
		if (isLoading) {
			return (
				<Box flexDirection="column">
					<Box width="100%">
						<Box flexDirection="column" width="100%">
							<Box>
								<Text color="yellow" bold>
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
				</Box>
			);
		}

		// Show message if no todos found
		if (todos.length === 0 && !searchQuery) {
			return (
				<Box flexDirection="column">
					<Box width="100%">
						<Box flexDirection="column" width="100%">
							<Box>
								<Text color="yellow" bold>
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
				</Box>
			);
		}

		// Show message if search has no results
		if (todos.length === 0 && searchQuery) {
			return (
				<Box flexDirection="column">
					<Box width="100%">
						<Box flexDirection="column" width="100%">
							<Box>
								<Text color="yellow" bold>
									TODO Selection
								</Text>
							</Box>
							<Box marginTop={1}>
								<Alert variant="warning">
									No TODOs match "{searchQuery}" (Total: {totalCount})
								</Alert>
							</Box>
							<Box marginTop={1}>
								<Text color="gray" dimColor>
									Type to filter · Backspace to clear search
								</Text>
							</Box>
						</Box>
					</Box>
				</Box>
			);
		}

		return (
			<Box flexDirection="column">
				<Box width="100%">
					<Box flexDirection="column" width="100%">
						<Box>
							<Text color="yellow" bold>
								Select TODOs{' '}
								{todos.length > effectiveMaxItems &&
									`(${selectedIndex + 1}/${todos.length})`}
								{searchQuery && ` - Filtering: "${searchQuery}"`}
								{searchQuery &&
									totalCount > todos.length &&
									` (${todos.length}/${totalCount})`}
							</Text>
						</Box>
						<Box marginTop={1}>
							<Text color="gray" dimColor>
								{searchQuery
									? 'Type to filter · Backspace to clear · Space: toggle · Enter: confirm'
									: 'Type to search · Space: toggle · Enter: confirm · Esc: cancel'}
							</Text>
						</Box>
						{displayedTodos.map((todo, index) => {
							const isSelected = index === displayedSelectedIndex;
							const isChecked = selectedTodos.has(todo.id);

							return (
								<Box key={todo.id} flexDirection="column" width="100%">
									<Text color={isSelected ? 'green' : 'gray'} bold>
										{isSelected ? '❯ ' : '  '}
										{isChecked ? '[✓]' : '[ ]'} {todo.file}:{todo.line}
									</Text>
									<Box marginLeft={5}>
										<Text
											color={isSelected ? 'green' : 'gray'}
											dimColor={!isSelected}
										>
											└─ {todo.content}
										</Text>
									</Box>
								</Box>
							);
						})}
						{todos.length > effectiveMaxItems && (
							<Box marginTop={1}>
								<Text color="gray" dimColor>
									↑↓ to scroll · {todos.length - effectiveMaxItems} more hidden
								</Text>
							</Box>
						)}
						{selectedTodos.size > 0 && (
							<Box marginTop={1}>
								<Text color="cyan">{selectedTodos.size} TODO(s) selected</Text>
							</Box>
						)}
					</Box>
				</Box>
			</Box>
		);
	},
);

TodoPickerPanel.displayName = 'TodoPickerPanel';

export default TodoPickerPanel;
