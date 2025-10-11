import { useState, useCallback, useRef } from 'react';
import { TextBuffer } from '../utils/textBuffer.js';
import { FileListRef } from '../ui/components/FileList.js';

export function useFilePicker(
	buffer: TextBuffer,
	triggerUpdate: () => void,
) {
	const [showFilePicker, setShowFilePicker] = useState(false);
	const [fileSelectedIndex, setFileSelectedIndex] = useState(0);
	const [fileQuery, setFileQuery] = useState('');
	const [atSymbolPosition, setAtSymbolPosition] = useState(-1);
	const [filteredFileCount, setFilteredFileCount] = useState(0);
	const fileListRef = useRef<FileListRef>(null);

	// Update file picker state
	const updateFilePickerState = useCallback(
		(text: string, cursorPos: number) => {
			if (!text.includes('@')) {
				if (showFilePicker) {
					setShowFilePicker(false);
					setFileSelectedIndex(0);
					setFileQuery('');
					setAtSymbolPosition(-1);
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
						!showFilePicker ||
						fileQuery !== afterAt ||
						atSymbolPosition !== lastAtIndex
					) {
						setShowFilePicker(true);
						setFileSelectedIndex(0);
						setFileQuery(afterAt);
						setAtSymbolPosition(lastAtIndex);
					}
					return;
				}
			}

			// Hide file picker if no valid @ context found
			if (showFilePicker) {
				setShowFilePicker(false);
				setFileSelectedIndex(0);
				setFileQuery('');
				setAtSymbolPosition(-1);
			}
		},
		[showFilePicker, fileQuery, atSymbolPosition],
	);

	// Handle file selection
	const handleFileSelect = useCallback(
		async (filePath: string) => {
			if (atSymbolPosition !== -1) {
				const text = buffer.getFullText();
				const cursorPos = buffer.getCursorPosition();

				// Replace @query with @filePath + space
				const beforeAt = text.slice(0, atSymbolPosition);
				const afterCursor = text.slice(cursorPos);
				const newText = beforeAt + '@' + filePath + ' ' + afterCursor;

				// Set the new text and position cursor after the inserted file path + space
				buffer.setText(newText);

				// Calculate cursor position after the inserted file path + space
				// Reset cursor to beginning, then move to correct position
				for (let i = 0; i < atSymbolPosition + filePath.length + 2; i++) {
					// +2 for @ and space
					if (i < buffer.getFullText().length) {
						buffer.moveRight();
					}
				}

				setShowFilePicker(false);
				setFileSelectedIndex(0);
				setFileQuery('');
				setAtSymbolPosition(-1);
				triggerUpdate();
			}
		},
		[atSymbolPosition, buffer, triggerUpdate],
	);

	// Handle filtered file count change
	const handleFilteredCountChange = useCallback((count: number) => {
		setFilteredFileCount(count);
	}, []);

	return {
		showFilePicker,
		setShowFilePicker,
		fileSelectedIndex,
		setFileSelectedIndex,
		fileQuery,
		setFileQuery,
		atSymbolPosition,
		setAtSymbolPosition,
		filteredFileCount,
		updateFilePickerState,
		handleFileSelect,
		handleFilteredCountChange,
		fileListRef,
	};
}
