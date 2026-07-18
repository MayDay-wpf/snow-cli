import {editTextWithNotepad} from '../../../../utils/ui/externalEditor.js';
import {copyToClipboard} from '../../../../utils/core/clipboard.js';
import type {HandlerContext} from '../types.js';

export function editingHandler(ctx: HandlerContext): boolean {
	const {input, key, buffer, options, helpers} = ctx;
	const {
		showFilePicker,
		fileListRef,
		forceUpdate,
		triggerUpdate,
		onCopyInputSuccess,
		onCopyInputError,
	} = options;

	// Ctrl+T - Toggle file picker display mode when active, otherwise toggle pasted text view
	if (key.ctrl && input === 't') {
		if (showFilePicker && fileListRef.current?.toggleDisplayMode()) {
			forceUpdate({});
			return true;
		}

		helpers.flushPendingInput();
		buffer.toggleExpandedView();
		forceUpdate({});
		return true;
	}

	// Ctrl+A - Move to beginning of line
	if (key.ctrl && input === 'a') {
		helpers.flushPendingInput();
		const text = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		// Find start of current line
		const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
		buffer.setCursorPosition(lineStart);
		triggerUpdate();
		return true;
	}

	// Ctrl+E - Move to end of line
	if (key.ctrl && input === 'e') {
		helpers.flushPendingInput();
		const text = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		// Find end of current line
		let lineEnd = text.indexOf('\n', cursorPos);
		if (lineEnd === -1) lineEnd = text.length;
		buffer.setCursorPosition(lineEnd);
		triggerUpdate();
		return true;
	}

	// Ctrl+G - 使用外部编辑器编辑输入内容（Windows: Notepad）
	if (key.ctrl && input === 'g') {
		helpers.flushPendingInput();

		// 非 Windows 平台安全降级：吞掉快捷键但不执行任何操作
		if (process.platform !== 'win32') {
			return true;
		}

		const initialText = buffer.getFullText();

		// useInput 回调不是 async，这里用 Promise 链处理。
		editTextWithNotepad(initialText)
			.then(editedText => {
				// 完全覆盖输入：先清空以清理占位符/图片残留，再恢复文本（避免触发 [Paste ...]）
				buffer.setText('');
				if (editedText) {
					buffer.insertRestoredText(editedText);
					buffer.setCursorPosition(editedText.length);
				} else {
					buffer.setCursorPosition(0);
				}
				helpers.forceStateUpdate();
			})
			.catch(() => {
				// 失败时不阻断输入，只做一次刷新避免 UI 卡住
				helpers.forceStateUpdate();
			});

		return true;
	}

	// Ctrl+O - Copy current input content to system clipboard
	if (key.ctrl && input === 'o') {
		helpers.flushPendingInput();
		const contentToCopy = buffer.getFullText();
		void copyToClipboard(contentToCopy)
			.then(() => {
				onCopyInputSuccess?.();
			})
			.catch(error => {
				console.error('Failed to copy current input to clipboard:', error);
				onCopyInputError?.(
					error instanceof Error ? error.message : 'Unknown error',
				);
			});
		return true;
	}

	// Alt+F - Forward one word
	if (key.meta && input === 'f') {
		helpers.flushPendingInput();
		const text = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		const newPos = helpers.findWordBoundary(text, cursorPos, 'forward');
		buffer.setCursorPosition(newPos);
		triggerUpdate();
		return true;
	}

	// Ctrl+K - Delete from cursor to end of line (readline compatible)
	if (key.ctrl && input === 'k') {
		helpers.flushPendingInput();
		const text = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		// Find end of current line
		let lineEnd = text.indexOf('\n', cursorPos);
		if (lineEnd === -1) lineEnd = text.length;
		// Delete from cursor to end of line
		const beforeCursor = text.slice(0, cursorPos);
		const afterLine = text.slice(lineEnd);
		buffer.setText(beforeCursor + afterLine);
		helpers.forceStateUpdate();
		return true;
	}

	// Ctrl+U - Delete from cursor to beginning of line (readline compatible)
	if (key.ctrl && input === 'u') {
		helpers.flushPendingInput();
		const text = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		// Find start of current line
		const lineStart = text.lastIndexOf('\n', cursorPos - 1) + 1;
		// Delete from line start to cursor
		const beforeLine = text.slice(0, lineStart);
		const afterCursor = text.slice(cursorPos);
		buffer.setText(beforeLine + afterCursor);
		buffer.setCursorPosition(lineStart);
		helpers.forceStateUpdate();
		return true;
	}

	// Ctrl+W - Delete word before cursor
	if (key.ctrl && input === 'w') {
		helpers.flushPendingInput();
		const text = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		const wordStart = helpers.findWordBoundary(text, cursorPos, 'backward');
		// Delete from word start to cursor
		const beforeWord = text.slice(0, wordStart);
		const afterCursor = text.slice(cursorPos);
		buffer.setText(beforeWord + afterCursor);
		buffer.setCursorPosition(wordStart);
		helpers.forceStateUpdate();
		return true;
	}

	// Ctrl+D - Delete character at cursor (readline compatible)
	if (key.ctrl && input === 'd') {
		helpers.flushPendingInput();
		const text = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		if (cursorPos < text.length) {
			const beforeCursor = text.slice(0, cursorPos);
			const afterChar = text.slice(cursorPos + 1);
			buffer.setText(beforeCursor + afterChar);
			helpers.forceStateUpdate();
		}
		return true;
	}

	// Ctrl+L - Clear from cursor to beginning (legacy, kept for compatibility)
	if (key.ctrl && input === 'l') {
		helpers.flushPendingInput();
		const displayText = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		const afterCursor = displayText.slice(cursorPos);

		buffer.setText(afterCursor);
		helpers.forceStateUpdate();
		return true;
	}

	// Ctrl+R - Clear from cursor to end (legacy, kept for compatibility)
	if (key.ctrl && input === 'r') {
		helpers.flushPendingInput();
		const displayText = buffer.text;
		const cursorPos = buffer.getCursorPosition();
		const beforeCursor = displayText.slice(0, cursorPos);

		buffer.setText(beforeCursor);
		helpers.forceStateUpdate();
		return true;
	}

	return false;
}
