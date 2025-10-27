import {useReducer, useCallback, useRef} from 'react';
import {TextBuffer} from '../utils/textBuffer.js';
import {FileListRef} from '../ui/components/FileList.js';

type FilePickerState = {
	showFilePicker: boolean;
	fileSelectedIndex: number;
	fileQuery: string;
	atSymbolPosition: number;
	filteredFileCount: number;
	searchMode: 'file' | 'content'; // 'file' for @ search, 'content' for @@ search
};

type FilePickerAction =
	| {
			type: 'SHOW';
			query: string;
			position: number;
			searchMode: 'file' | 'content';
	  }
	| {type: 'HIDE'}
	| {type: 'SELECT_FILE'}
	| {type: 'SET_SELECTED_INDEX'; index: number}
	| {type: 'SET_FILTERED_COUNT'; count: number};

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
				searchMode: action.searchMode,
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

export function useFilePicker(buffer: TextBuffer, triggerUpdate: () => void) {
	const [state, dispatch] = useReducer(filePickerReducer, {
		showFilePicker: false,
		fileSelectedIndex: 0,
		fileQuery: '',
		atSymbolPosition: -1,
		filteredFileCount: 0,
		searchMode: 'file',
	});

	const fileListRef = useRef<FileListRef>(null);

	// Update file picker state
	const updateFilePickerState = useCallback(
		(text: string, cursorPos: number) => {
			if (!text.includes('@')) {
				if (state.showFilePicker) {
					dispatch({type: 'HIDE'});
				}
				return;
			}

			// Find the last '@' or '@@' symbol before the cursor
			const beforeCursor = text.slice(0, cursorPos);

			// Look for @@ first (content search), then @ (file search)
			let searchMode: 'file' | 'content' = 'file';
			let position = -1;
			let query = '';

			// Search backwards from cursor to find @@ or @
			for (let i = beforeCursor.length - 1; i >= 0; i--) {
				if (beforeCursor[i] === '@') {
					// Check if this is part of @@
					if (i > 0 && beforeCursor[i - 1] === '@') {
						// Found @@, use content search
						searchMode = 'content';
						position = i - 1; // Position of first @
						const afterDoubleAt = beforeCursor.slice(i + 1);
						// Only activate if no space/newline after @@
						if (!afterDoubleAt.includes(' ') && !afterDoubleAt.includes('\n')) {
							query = afterDoubleAt;
							break;
						} else {
							// Has space after @@, not valid
							position = -1;
							break;
						}
					} else {
						// Found single @, check if next char is also @
						if (i < beforeCursor.length - 1 && beforeCursor[i + 1] === '@') {
							// This @ is part of @@, continue searching
							continue;
						}
						// Single @, use file search
						searchMode = 'file';
						position = i;
						const afterAt = beforeCursor.slice(i + 1);
						// Only activate if no space/newline after @
						if (!afterAt.includes(' ') && !afterAt.includes('\n')) {
							query = afterAt;
							break;
						} else {
							// Has space after @, not valid
							position = -1;
							break;
						}
					}
				}
			}

			if (position !== -1) {
				// For both @ and @@, position points to where we should start replacement
				// For @@, position is the first @
				// For @, position is the single @
				if (
					!state.showFilePicker ||
					state.fileQuery !== query ||
					state.atSymbolPosition !== position ||
					state.searchMode !== searchMode
				) {
					dispatch({
						type: 'SHOW',
						query,
						position,
						searchMode,
					});
				}
			} else {
				// Hide file picker if no valid @ context found
				if (state.showFilePicker) {
					dispatch({type: 'HIDE'});
				}
			}
		},
		[
			state.showFilePicker,
			state.fileQuery,
			state.atSymbolPosition,
			state.searchMode,
		],
	);

	// Handle file selection
	const handleFileSelect = useCallback(
		async (filePath: string) => {
			if (state.atSymbolPosition !== -1) {
				const text = buffer.getFullText();
				const cursorPos = buffer.getCursorPosition();

				// Replace query with selected file path
				// For content search (@@), the filePath already includes line number
				// For file search (@), just the file path
				const beforeAt = text.slice(0, state.atSymbolPosition);
				const afterCursor = text.slice(cursorPos);

				// Construct the replacement based on search mode
				const prefix = state.searchMode === 'content' ? '@@' : '@';
				const newText = beforeAt + prefix + filePath + ' ' + afterCursor;

				// Set the new text and position cursor after the inserted file path + space
				buffer.setText(newText);

				// Calculate cursor position after the inserted text
				// prefix length + filePath length + space
				const insertedLength = prefix.length + filePath.length + 1;
				const targetPos = state.atSymbolPosition + insertedLength;

				// Reset cursor to beginning, then move to correct position
				for (let i = 0; i < targetPos; i++) {
					if (i < buffer.getFullText().length) {
						buffer.moveRight();
					}
				}

				dispatch({type: 'SELECT_FILE'});
				triggerUpdate();
			}
		},
		[state.atSymbolPosition, state.searchMode, buffer, triggerUpdate],
	);

	// Handle filtered file count change
	const handleFilteredCountChange = useCallback((count: number) => {
		dispatch({type: 'SET_FILTERED_COUNT', count});
	}, []);

	// Wrapper setters for backwards compatibility
	const setShowFilePicker = useCallback((show: boolean) => {
		if (show) {
			dispatch({
				type: 'SHOW',
				query: '',
				position: -1,
				searchMode: 'file',
			});
		} else {
			dispatch({type: 'HIDE'});
		}
	}, []);

	const setFileSelectedIndex = useCallback(
		(index: number | ((prev: number) => number)) => {
			if (typeof index === 'function') {
				// For functional updates, we need to get current state first
				// This is a simplified version - in production you might want to use a ref
				dispatch({
					type: 'SET_SELECTED_INDEX',
					index: index(state.fileSelectedIndex),
				});
			} else {
				dispatch({type: 'SET_SELECTED_INDEX', index});
			}
		},
		[state.fileSelectedIndex],
	);

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
		searchMode: state.searchMode,
		updateFilePickerState,
		handleFileSelect,
		handleFilteredCountChange,
		fileListRef,
	};
}
