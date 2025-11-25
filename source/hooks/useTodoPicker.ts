import {useState, useCallback, useEffect, useMemo} from 'react';
import {TextBuffer} from '../utils/ui/textBuffer.js';
import {scanProjectTodos, type TodoItem} from '../utils/core/todoScanner.js';

export function useTodoPicker(
	buffer: TextBuffer,
	triggerUpdate: () => void,
	projectRoot: string,
) {
	const [showTodoPicker, setShowTodoPicker] = useState(false);
	const [todoSelectedIndex, setTodoSelectedIndex] = useState(0);
	const [allTodos, setAllTodos] = useState<TodoItem[]>([]);
	const [selectedTodos, setSelectedTodos] = useState<Set<string>>(new Set());
	const [isLoading, setIsLoading] = useState(false);
	const [searchQuery, setSearchQuery] = useState('');

	// Filter todos based on search query
	const filteredTodos = useMemo(() => {
		if (!searchQuery.trim()) {
			return allTodos;
		}
		const query = searchQuery.toLowerCase();
		return allTodos.filter(
			todo =>
				todo.content.toLowerCase().includes(query) ||
				todo.file.toLowerCase().includes(query),
		);
	}, [allTodos, searchQuery]);

	// Load todos when picker is shown
	useEffect(() => {
		if (showTodoPicker) {
			setIsLoading(true);
			setSearchQuery('');
			setTodoSelectedIndex(0);
			setSelectedTodos(new Set());

			// Use setTimeout to allow UI to update with loading state
			setTimeout(() => {
				const foundTodos = scanProjectTodos(projectRoot);
				setAllTodos(foundTodos);
				setIsLoading(false);
			}, 0);
		}
	}, [showTodoPicker, projectRoot]);

	// Toggle selection of current todo
	const toggleTodoSelection = useCallback(() => {
		if (filteredTodos.length > 0 && todoSelectedIndex < filteredTodos.length) {
			const todo = filteredTodos[todoSelectedIndex];
			if (todo) {
				setSelectedTodos(prev => {
					const newSet = new Set(prev);
					if (newSet.has(todo.id)) {
						newSet.delete(todo.id);
					} else {
						newSet.add(todo.id);
					}
					return newSet;
				});
				triggerUpdate();
			}
		}
	}, [filteredTodos, todoSelectedIndex, triggerUpdate]);

	// Confirm selection and insert into buffer
	const confirmTodoSelection = useCallback(() => {
		if (selectedTodos.size === 0) {
			// If no todos selected, just close the picker
			setShowTodoPicker(false);
			setTodoSelectedIndex(0);
			triggerUpdate();
			return;
		}

		// Build the text to insert
		const selectedTodoItems = allTodos.filter(todo =>
			selectedTodos.has(todo.id),
		);
		const todoTexts = selectedTodoItems.map(
			todo => `<${todo.file}:${todo.line}> ${todo.content}`,
		);

		// Clear buffer and insert selected todos
		const currentText = buffer.getFullText().trim();
		buffer.setText('');
		if (currentText) {
			buffer.insert(currentText + '\n' + todoTexts.join('\n'));
		} else {
			buffer.insert(todoTexts.join('\n'));
		}

		// Reset state
		setShowTodoPicker(false);
		setTodoSelectedIndex(0);
		setSelectedTodos(new Set());
		triggerUpdate();
	}, [buffer, allTodos, selectedTodos, triggerUpdate]);

	return {
		showTodoPicker,
		setShowTodoPicker,
		todoSelectedIndex,
		setTodoSelectedIndex,
		todos: filteredTodos,
		selectedTodos,
		toggleTodoSelection,
		confirmTodoSelection,
		isLoading,
		searchQuery,
		setSearchQuery,
		totalTodoCount: allTodos.length,
	};
}
