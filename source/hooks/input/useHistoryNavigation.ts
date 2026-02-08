import {useState, useCallback, useRef, useEffect} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {cleanIDEContext} from '../../utils/core/fileUtils.js';
import {
	historyManager,
	type HistoryEntry,
} from '../../utils/session/historyManager.js';

type ChatMessage = {
	role: string;
	content: string;
	images?: Array<{type: 'image'; data: string; mimeType: string}>;
	/** Present when a user message was directed to specific running sub-agents */
	subAgentDirected?: unknown;
};

export function useHistoryNavigation(
	buffer: TextBuffer,
	triggerUpdate: () => void,
	chatHistory: ChatMessage[],
	onHistorySelect?: (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => void,
) {
	const [showHistoryMenu, setShowHistoryMenu] = useState(false);
	const [historySelectedIndex, setHistorySelectedIndex] = useState(0);
	const [escapeKeyCount, setEscapeKeyCount] = useState(0);
	const escapeKeyTimer = useRef<NodeJS.Timeout | null>(null);

	// Terminal-style history navigation state
	const [currentHistoryIndex, setCurrentHistoryIndex] = useState(-1); // -1 means not in history mode
	const savedInput = useRef<string>(''); // Save current input when entering history mode
	const [persistentHistory, setPersistentHistory] = useState<HistoryEntry[]>(
		[],
	);
	const persistentHistoryRef = useRef<HistoryEntry[]>([]);

	// Keep ref in sync with state
	useEffect(() => {
		persistentHistoryRef.current = persistentHistory;
	}, [persistentHistory]);

	// Load persistent history on mount
	useEffect(() => {
		historyManager.getEntries().then(entries => {
			setPersistentHistory(entries);
		});
	}, []);

	// Cleanup timer on unmount
	useEffect(() => {
		return () => {
			if (escapeKeyTimer.current) {
				clearTimeout(escapeKeyTimer.current);
			}
		};
	}, []);

	// Get user messages from chat history for navigation (rollback panel).
	// Exclude messages directed to sub-agents — those belong to the sub-agent
	// flow, not the main conversation, and should not appear as rollback targets.
	const getUserMessages = useCallback(() => {
		const userMessages = chatHistory
			.map((msg, index) => ({...msg, originalIndex: index}))
			.filter(
				msg =>
					msg.role === 'user' &&
					msg.content.trim() &&
					!msg.subAgentDirected,
			);

		// Keep original order (oldest first, newest last) and map with display numbers
		return userMessages.map((msg, index) => {
			// Clean IDE context info first, then clean for display
			const cleanedContent = cleanIDEContext(msg.content);
			// Remove all newlines, control characters and extra whitespace to ensure single line display
			const cleanContent = cleanedContent
				.replace(/[\r\n\t\v\f\u0000-\u001F\u007F-\u009F]+/g, ' ')
				.replace(/\s+/g, ' ')
				.trim();
			return {
				label: `${index + 1}. ${cleanContent.slice(0, 50)}${
					cleanContent.length > 50 ? '...' : ''
				}`,
				value: msg.originalIndex.toString(),
				infoText: cleanedContent, // Use cleaned content for infoText as well
			};
		});
	}, [chatHistory]);

	const handleHistorySelect = useCallback(
		(value: string) => {
			const selectedIndex = parseInt(value, 10);
			const selectedMessage = chatHistory[selectedIndex];
			if (selectedMessage && onHistorySelect) {
				// Don't modify buffer here - let ChatInput handle everything via initialContent
				// This prevents duplicate image placeholders
				setShowHistoryMenu(false);
				onHistorySelect(
					selectedIndex,
					cleanIDEContext(selectedMessage.content), // Clean IDE context before passing
					selectedMessage.images,
				);
			}
		},
		[chatHistory, onHistorySelect],
	);

	// Terminal-style history navigation: navigate up (older)
	const navigateHistoryUp = useCallback(() => {
		const history = persistentHistoryRef.current;
		if (history.length === 0) return false;

		// Save current input when first entering history mode
		if (currentHistoryIndex === -1) {
			savedInput.current = buffer.getFullText();
		}

		// Navigate to older message (persistentHistory is already newest first)
		const newIndex =
			currentHistoryIndex === -1
				? 0
				: Math.min(history.length - 1, currentHistoryIndex + 1);

		setCurrentHistoryIndex(newIndex);
		const entry = history[newIndex];
		if (entry) {
			buffer.setText(entry.content);
			triggerUpdate();
		}
		return true;
	}, [currentHistoryIndex]); // 移除 buffer 避免循环依赖

	// Terminal-style history navigation: navigate down (newer)
	const navigateHistoryDown = useCallback(() => {
		if (currentHistoryIndex === -1) return false;

		const newIndex = currentHistoryIndex - 1;
		const history = persistentHistoryRef.current;

		if (newIndex < 0) {
			// Restore original input
			buffer.setText(savedInput.current);
			setCurrentHistoryIndex(-1);
			savedInput.current = '';
		} else {
			setCurrentHistoryIndex(newIndex);
			const entry = history[newIndex];
			if (entry) {
				buffer.setText(entry.content);
			}
		}
		triggerUpdate();
		return true;
	}, [currentHistoryIndex]); // 移除 buffer 避免循环依赖

	// Reset history navigation state
	const resetHistoryNavigation = useCallback(() => {
		setCurrentHistoryIndex(-1);
		savedInput.current = '';
	}, []);

	// Save message to persistent history
	const saveToHistory = useCallback(async (content: string) => {
		await historyManager.addEntry(content);
		// Reload history to update the list
		const entries = await historyManager.getEntries();
		setPersistentHistory(entries);
	}, []);

	return {
		showHistoryMenu,
		setShowHistoryMenu,
		historySelectedIndex,
		setHistorySelectedIndex,
		escapeKeyCount,
		setEscapeKeyCount,
		escapeKeyTimer,
		getUserMessages,
		handleHistorySelect,
		// Terminal-style history navigation
		currentHistoryIndex,
		navigateHistoryUp,
		navigateHistoryDown,
		resetHistoryNavigation,
		saveToHistory,
	};
}
