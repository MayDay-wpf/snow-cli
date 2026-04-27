import type {HandlerContext} from '../types.js';

export function regularInputHandler(ctx: HandlerContext): boolean {
	const {input, key, buffer, options, refs} = ctx;
	const {
		currentHistoryIndex,
		resetHistoryNavigation,
		ensureFocus,
		updateCommandPanelState,
		updateFilePickerState,
		updateAgentPickerState,
		updateRunningAgentsPickerState,
		pasteShortcutTimeoutMs = 800,
		pasteFlushDebounceMs = 250,
		pasteIndicatorThreshold = 300,
		triggerUpdate,
	} = options;

	// Regular character input
	if (input && !key.ctrl && !key.meta && !key.escape) {
		// Reset history navigation when user starts typing
		if (currentHistoryIndex !== -1) {
			resetHistoryNavigation();
		}

		// Ensure focus is active when user is typing (handles delayed focus events)
		// This is especially important for drag-and-drop operations where focus
		// events may arrive out of order or be filtered by sanitizeInput
		ensureFocus();

		const now = Date.now();
		const isPasteShortcutActive =
			now - refs.lastPasteShortcutAt.current <= pasteShortcutTimeoutMs;

		// ink 在 IME 场景下可能一次性提交多个字符（通常很短），这不是“粘贴”。
		// 如果仍按“多字符=粘贴/IME，延迟缓冲”处理，用户在提交前移动光标会让插入位置/显示状态产生竞态，
		// 表现为光标插入错位、内容渲染像“总是显示末尾”。
		// 因此：短的多字符输入直接落盘；只对明显的粘贴/大输入走缓冲。
		const isSingleCharInput = input.length === 1;
		const isSmallMultiCharInput = input.length > 1 && !input.includes('\n');

		// 单字符：正常键入，直接插入
		if (isSingleCharInput && !refs.isProcessingInput.current) {
			// This prevents the "disappearing text" issue at line start
			buffer.insert(input);
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateCommandPanelState(text);
			updateFilePickerState(text, cursorPos);
			updateAgentPickerState(text, cursorPos);
			updateRunningAgentsPickerState(text, cursorPos);
			return true;
		}

		// IME commit / 小段粘贴（无换行、长度不大）统一直接落盘，避免进入 100ms 缓冲。
		// 这能避免“先移动光标再输入”场景下仍走缓冲，导致插入位置/内容被错误合并。
		if (
			isSmallMultiCharInput &&
			!refs.isProcessingInput.current &&
			!isPasteShortcutActive
		) {
			ctx.helpers.flushPendingInput();
			buffer.insert(input);
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateCommandPanelState(text);
			updateFilePickerState(text, cursorPos);
			updateAgentPickerState(text, cursorPos);
			updateRunningAgentsPickerState(text, cursorPos);
			return true;
		}

		// 其余（含换行/已有缓冲会话/大段输入）：使用缓冲机制
		// Save cursor position when starting new input accumulation
		const isStartingNewInput = refs.inputBuffer.current === '';
		if (isStartingNewInput) {
			refs.inputStartCursorPos.current = buffer.getCursorPosition();
			refs.isProcessingInput.current = true; // Mark that we're processing multi-char input
			refs.inputSessionId.current += 1;
		}

		// Accumulate input for paste detection
		refs.inputBuffer.current += input;

		// Clear existing timer
		if (refs.inputTimer.current) {
			clearTimeout(refs.inputTimer.current);
		}

		const activeSessionId = refs.inputSessionId.current;
		const currentLength = refs.inputBuffer.current.length;
		const shouldShowIndicator =
			isPasteShortcutActive || currentLength > pasteIndicatorThreshold;

		// Show pasting indicator for large text or explicit paste
		// Simple static message - no progress animation
		if (shouldShowIndicator && !refs.isPasting.current) {
			refs.isPasting.current = true;
			buffer.insertPastingIndicator();
			// Trigger UI update to show the indicator
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateCommandPanelState(text);
			updateFilePickerState(text, cursorPos);
			updateAgentPickerState(text, cursorPos);
			updateRunningAgentsPickerState(text, cursorPos);
			triggerUpdate();
		}

		// Set timer to process accumulated input
		const flushDelay = isPasteShortcutActive
			? pasteShortcutTimeoutMs
			: pasteFlushDebounceMs;
		refs.inputTimer.current = setTimeout(() => {
			if (activeSessionId !== refs.inputSessionId.current) {
				return;
			}

			const accumulated = refs.inputBuffer.current;
			const savedCursorPosition = refs.inputStartCursorPos.current;
			const wasPasting = refs.isPasting.current; // Save pasting state before clearing

			refs.inputBuffer.current = '';
			refs.isPasting.current = false; // Reset pasting state
			refs.isProcessingInput.current = false; // Reset processing flag

			// If we accumulated input, insert it at the saved cursor position
			// The insert() method will automatically remove the pasting indicator
			if (accumulated) {
				// Get current cursor position to calculate if user moved cursor during input
				const currentCursor = buffer.getCursorPosition();

				// If cursor hasn't moved from where we started (or only moved due to pasting indicator),
				// insert at the saved position
				// Otherwise, insert at current position (user deliberately moved cursor)
				// Note: wasPasting check uses saved state, not current isPasting.current
				if (
					currentCursor === savedCursorPosition ||
					(wasPasting && currentCursor > savedCursorPosition)
				) {
					// Temporarily set cursor to saved position for insertion
					// This is safe because we're in a timeout, not during active cursor movement
					buffer.setCursorPosition(savedCursorPosition);
					buffer.insert(accumulated);
					// No need to restore cursor - insert() moves it naturally
				} else {
					// User moved cursor during input, insert at current position
					buffer.insert(accumulated);
				}

				// Reset inputStartCursorPos after processing to prevent stale position
				refs.inputStartCursorPos.current = buffer.getCursorPosition();

				const text = buffer.getFullText();
				const cursorPos = buffer.getCursorPosition();
				updateCommandPanelState(text);
				updateFilePickerState(text, cursorPos);
				updateAgentPickerState(text, cursorPos);
				updateRunningAgentsPickerState(text, cursorPos);
				triggerUpdate();
			}
		}, flushDelay);
		return true;
	}
	return false;
}
