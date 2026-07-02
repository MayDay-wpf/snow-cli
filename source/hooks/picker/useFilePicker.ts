import {useReducer, useCallback, useRef} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {FileListRef} from '../../ui/components/tools/FileList.js';

type FilePickerState = {
	showFilePicker: boolean;
	fileSelectedIndex: number;
	fileQuery: string;
	atSymbolPosition: number;
	filteredFileCount: number;
	searchMode: 'file' | 'content'; // 'file' for @ search, 'content' for @@ search
	// When the user picks a working directory in @: mode, this holds the
	// full dir path so FileList can scope its scan.  The input box shows
	// a short tag like @[snow-app] instead of the raw path.
	workspaceFilter: string | null;
};

type FilePickerAction =
	| {
			type: 'SHOW';
			query: string;
			position: number;
			searchMode: 'file' | 'content';
			workspaceFilter?: string | null;
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
				workspaceFilter:
					action.workspaceFilter !== undefined
						? action.workspaceFilter
						: state.workspaceFilter,
			};
		case 'HIDE':
			return {
				...state,
				showFilePicker: false,
				fileSelectedIndex: 0,
				fileQuery: '',
				atSymbolPosition: -1,
				workspaceFilter: null,
			};
		case 'SELECT_FILE':
			return {
				...state,
				showFilePicker: false,
				fileSelectedIndex: 0,
				fileQuery: '',
				atSymbolPosition: -1,
				workspaceFilter: null,
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
		workspaceFilter: null,
	});

	const fileListRef = useRef<FileListRef>(null);

	// Update file picker state
	const updateFilePickerState = useCallback(
		(_text: string, cursorPos: number) => {
			// Use display text (with placeholders) instead of full text (expanded)
			// to ensure cursor position matches text content
			// Note: _text parameter is ignored, we use buffer.text instead
			const displayText = buffer.text;

			if (!displayText.includes('@')) {
				if (state.showFilePicker) {
					dispatch({type: 'HIDE'});
				}
				return;
			}

			// Find the last '@' or '@@' symbol before the cursor
			const beforeCursor = displayText.slice(0, cursorPos);

			// Look for @@ first (content search), then @ (file search)
			let searchMode: 'file' | 'content' = 'file';
			let position = -1;
			let query = '';

			// Search backwards from cursor to find @@ or @
			for (let i = beforeCursor.length - 1; i >= 0; i--) {
				if (beforeCursor[i] === '@') {
					// Check if @ is preceded by # (agent picker should handle it)
					if (i > 0 && beforeCursor[i - 1] === '#') {
						// @ is part of #@, don't activate file picker
						position = -1;
						break;
					}
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
			buffer,
			state.showFilePicker,
			state.fileQuery,
			state.atSymbolPosition,
			state.searchMode,
		],
	);

	// Handle file selection
	const handleFileSelect = useCallback(
		async (filePath: string, displayName?: string) => {
			if (state.atSymbolPosition !== -1) {
				// Use display text (with placeholders) for position calculations
				const displayText = buffer.text;
				const cursorPos = buffer.getCursorPosition();
				// Workspace selection mode: when the query starts with ":"
				// the user is picking a working directory from the list.
				// We write a short tag like @[snow-app] into the input box,
				// set workspaceFilter to the dir path, and keep the picker open
				// so the user can immediately type a fuzzy search term.
				const isWorkspaceSelection = state.fileQuery.startsWith(':');

				const beforeAt = displayText.slice(0, state.atSymbolPosition);
				const afterCursor = displayText.slice(cursorPos);
				const prefix = state.searchMode === 'content' ? '@@' : '@';

				if (isWorkspaceSelection) {
					// Write @[displayName] tag into the input box.
					// filePath is the full workspace path (ends with "/"),
					// displayName is the human-readable name for the tag.
					const tag =
						displayName ||
						filePath.replace(/\/$/, '').split('/').pop() ||
						filePath;
					const tagText = `${prefix}[${tag}]`;
					const newText = beforeAt + tagText + afterCursor;

					buffer.setText(newText);

					// Position cursor right after the ] so the user can
					// immediately start typing a search query.
					const targetPos = state.atSymbolPosition + tagText.length;
					for (let i = 0; i < targetPos; i++) {
						if (i < buffer.text.length) {
							buffer.moveRight();
						}
					}

					// Keep picker open with empty query, scoped to workspace.
					dispatch({
						type: 'SHOW',
						query: '',
						position: state.atSymbolPosition,
						searchMode: state.searchMode,
						workspaceFilter: filePath,
					});
					triggerUpdate();
					return;
				}

				// Replace query with selected file path
				// For content search (@@), the filePath already includes line number
				// For file search (@), directories can keep the picker open for deeper filtering
				const isDirectoryContinuation =
					state.searchMode === 'file' && filePath.endsWith('/');
				const suffix = isDirectoryContinuation ? '' : ' ';
				const newText = beforeAt + prefix + filePath + suffix + afterCursor;

				// Set the new text and position cursor after the inserted file path
				buffer.setText(newText);

				// Calculate cursor position after the inserted text
				const insertedLength = prefix.length + filePath.length + suffix.length;
				const targetPos = state.atSymbolPosition + insertedLength;

				// Reset cursor to beginning, then move to correct position
				for (let i = 0; i < targetPos; i++) {
					if (i < buffer.text.length) {
						buffer.moveRight();
					}
				}

				if (isDirectoryContinuation) {
					dispatch({
						type: 'SHOW',
						query: filePath,
						position: state.atSymbolPosition,
						searchMode: state.searchMode,
					});
				} else {
					dispatch({type: 'SELECT_FILE'});
				}
				triggerUpdate();
			}
		},
		[
			state.atSymbolPosition,
			state.searchMode,
			state.fileQuery,
			buffer,
			triggerUpdate,
		],
	);

	// Handle multi-file selection from the FileList checkbox picker.
	// All selected paths are inserted in one shot, replacing the active
	// @-query token. Each entry is prefixed with @ (or @@ for content search)
	// and separated by a single space. The picker closes afterwards.
	const handleMultipleFileSelect = useCallback(
		async (filePaths: string[]) => {
			if (filePaths.length === 0) {
				return;
			}
			// Note: do NOT short-circuit to handleFileSelect for single-item
			// arrays. A user who explicitly checked one entry — including a
			// directory — expects it to be inserted as `@dir/` rather than
			// drilling into the directory (which is what handleFileSelect
			// does for trailing-slash paths).

			if (state.atSymbolPosition === -1) {
				return;
			}

			const displayText = buffer.text;
			const cursorPos = buffer.getCursorPosition();
			const beforeAt = displayText.slice(0, state.atSymbolPosition);
			const afterCursor = displayText.slice(cursorPos);
			const prefix = state.searchMode === 'content' ? '@@' : '@';

			// Join every selected path with the same prefix so they all show up
			// as proper @-references. A trailing space leaves the cursor in a
			// natural spot to keep typing.
			const insertedSegment =
				filePaths.map(p => `${prefix}${p}`).join(' ') + ' ';
			const newText = beforeAt + insertedSegment + afterCursor;

			buffer.setText(newText);

			const targetPos = state.atSymbolPosition + insertedSegment.length;
			for (let i = 0; i < targetPos; i++) {
				if (i < buffer.text.length) {
					buffer.moveRight();
				}
			}

			dispatch({type: 'SELECT_FILE'});
			triggerUpdate();
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
		workspaceFilter: state.workspaceFilter,
		updateFilePickerState,
		handleFileSelect,
		handleMultipleFileSelect,
		handleFilteredCountChange,
		fileListRef,
	};
}
