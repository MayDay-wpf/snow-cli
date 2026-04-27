import type {HandlerContext} from '../../types.js';

export function historyMenuHandler(ctx: HandlerContext): boolean {
	const {key, options} = ctx;
	const {
		showHistoryMenu,
		getUserMessages,
		setHistorySelectedIndex,
		historySelectedIndex,
		handleHistorySelect,
	} = options;

	if (!showHistoryMenu) return false;
	const userMessages = getUserMessages();

	// Up arrow in history menu - 循环导航:第一项 → 最后一项
	if (key.upArrow) {
		setHistorySelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, userMessages.length - 1),
		);
		return true;
	}

	// Down arrow in history menu - 循环导航:最后一项 → 第一项
	if (key.downArrow) {
		const maxIndex = Math.max(0, userMessages.length - 1);
		setHistorySelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Enter - select history item
	if (key.return) {
		if (
			userMessages.length > 0 &&
			historySelectedIndex < userMessages.length
		) {
			const selectedMessage = userMessages[historySelectedIndex];
			if (selectedMessage) {
				handleHistorySelect(selectedMessage.value);
			}
		}
		return true;
	}

	// For any other key in history menu, just return to prevent interference
	return true;
}
