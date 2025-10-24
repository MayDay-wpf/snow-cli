import { useReducer, useCallback, useRef } from 'react';
import { TextBuffer } from '../utils/textBuffer.js';
import { FileListRef } from '../ui/components/FileList.js';

type FilePickerState = {
	showFilePicker: boolean;
	fileSelectedIndex: number;
	fileQuery: string;
	atSymbolPosition: number;
	filteredFileCount: number;
};

type FilePickerAction =
	| { type: 'SHOW'; query: string; position: number }
	| { type: 'HIDE' }
	| { type: 'SELECT_FILE' }
	| { type: 'SET_SELECTED_INDEX'; index: number }
	| { type: 'SET_FILTERED_COUNT'; count: number };

function filePickerReducer(
	state: FilePickerState,
	action: FilePickerAction,
): FilePickerState {
	switch (action.type) {
		case 'SHOW':
			return {
				...state,
				showFilePicker: true,
				fileSelectedIndex: 0,
				fileQuery: action.query,
				atSymbolPosition: action.position,
			};
		case 'HIDE':
			return {
				...state,
				showFilePicker: false,
				fileSelectedIndex: 0,
				fileQuery: '',
				atSymbolPosition: -1,
			};
		case 'SELECT_FILE':
			return {
				...state,
				showFilePicker: false,
				fileSelectedIndex: 0,
				fileQuery: '',
				atSymbolPosition: -1,
			};
		case 'SET_SELECTED_INDEX':
			return {
				...state,
				fileSelectedIndex: action.index,
			};
		case 'SET_FILTERED_COUNT':
			return {
				...state,
				filteredFileCount: action.count,
			};
		default:
			return state;
	}
}

export function useFilePicker(
	buffer: TextBuffer,
	triggerUpdate: () => void,
) {
	const [state, dispatch] = useReducer(filePickerReducer, {
		showFilePicker: false,
		fileSelectedIndex: 0,
		fileQuery: '',
		atSymbolPosition: -1,
		filteredFileCount: 0,
	});

	const fileListRef = useRef<FileListRef>(null);

	// Update file picker state
	const updateFilePickerState = useCallback(
		(text: string, cursorPos: number) => {
			if (!text.includes('@')) {
				if (state.showFilePicker) {
					dispatch({ type: 'HIDE' });
				}
				return;
			}

			// Find the last '@' symbol before the cursor
			const beforeCursor = text.slice(0, cursorPos);
			const lastAtIndex = beforeCursor.lastIndexOf('@');

			if (lastAtIndex !== -1) {
				// Check if there's no space between '@' and cursor
				const afterAt = beforeCursor.slice(lastAtIndex + 1);
				if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
					if (
						!state.showFilePicker ||
						state.fileQuery !== afterAt ||
						state.atSymbolPosition !== lastAtIndex
					) {
						dispatch({ type: 'SHOW', query: afterAt, position: lastAtIndex });
					}
					return;
				}
			}

			// Hide file picker if no valid @ context found
			if (state.showFilePicker) {
				dispatch({ type: 'HIDE' });
			}
		},
		[state.showFilePicker, state.fileQuery, state.atSymbolPosition],
	);

	// Handle file selection
	const handleFileSelect = useCallback(
		async (filePath: string) => {
			if (state.atSymbolPosition !== -1) {
				const text = buffer.getFullText();
				const cursorPos = buffer.getCursorPosition();

				// Replace @query with @filePath + space
				const beforeAt = text.slice(0, state.atSymbolPosition);
				const afterCursor = text.slice(cursorPos);
				const newText = beforeAt + '@' + filePath + ' ' + afterCursor;

				// Set the new text and position cursor after the inserted file path + space
				buffer.setText(newText);

				// Calculate cursor position after the inserted file path + space
				// Reset cursor to beginning, then move to correct position
				for (let i = 0; i < state.atSymbolPosition + filePath.length + 2; i++) {
					// +2 for @ and space
					if (i < buffer.getFullText().length) {
						buffer.moveRight();
					}
				}

				dispatch({ type: 'SELECT_FILE' });
				triggerUpdate();
			}
		},
		[state.atSymbolPosition, buffer],
	);

	// Handle filtered file count change
	const handleFilteredCountChange = useCallback((count: number) => {
		dispatch({ type: 'SET_FILTERED_COUNT', count });
	}, []);

	// Wrapper setters for backwards compatibility
	const setShowFilePicker = useCallback((show: boolean) => {
		dispatch({ type: show ? 'SHOW' : 'HIDE', query: '', position: -1 });
	}, []);

	const setFileSelectedIndex = useCallback((index: number | ((prev: number) => number)) => {
		if (typeof index === 'function') {
			// For functional updates, we need to get current state first
			// This is a simplified version - in production you might want to use a ref
			dispatch({ type: 'SET_SELECTED_INDEX', index: index(state.fileSelectedIndex) });
		} else {
			dispatch({ type: 'SET_SELECTED_INDEX', index });
		}
	}, [state.fileSelectedIndex]);

	return {
		showFilePicker: state.showFilePicker,
		setShowFilePicker,
		fileSelectedIndex: state.fileSelectedIndex,
		setFileSelectedIndex,
		fileQuery: state.fileQuery,
		setFileQuery: (_query: string) => {
			// Not used, but kept for compatibility
		},
		atSymbolPosition: state.atSymbolPosition,
		setAtSymbolPosition: (_pos: number) => {
			// Not used, but kept for compatibility
		},
		filteredFileCount: state.filteredFileCount,
		updateFilePickerState,
		handleFileSelect,
		handleFilteredCountChange,
		fileListRef,
	};
}
