import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getToolDisplayMode,
	setToolDisplayMode,
	type ToolDisplayMode,
} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';
import {configEvents} from '../config/configEvents.js';

// 同步推送 toolDisplayMode 变化到订阅者（如 useChatScreenModes），
// 避免依赖 1s 轮询导致 UI 第一次切换时拿到旧 state。
function applyToolDisplayMode(value: ToolDisplayMode): void {
	setToolDisplayMode(value);
	configEvents.emitConfigChange({type: 'toolDisplayMode', value});
}

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.toolDisplay;
}

// Tool display command handler - control how tool calls and results are displayed
// Usage:
//   /tool-display             - Show current mode (defaults to full)
//   /tool-display full        - Show tool name + args + result (default)
//   /tool-display compact     - Show only tool name + brief status
//   /tool-display hidden      - Hide all tool call process, show only AI reply
//   /tool-display status      - Show current display mode
registerCommand('tool-display', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();
		const currentMode = getToolDisplayMode();
		const messages = getMessages();

		if (trimmedArgs === 'status' || trimmedArgs === '') {
			return {
				success: true,
				message: messages.status(currentMode),
			};
		}

		if (
			trimmedArgs === 'full' ||
			trimmedArgs === 'compact' ||
			trimmedArgs === 'hidden'
		) {
			const mode = trimmedArgs as ToolDisplayMode;
			if (mode !== currentMode) {
				applyToolDisplayMode(mode);
			}
			return {
				success: true,
				// 切换显示模式后，<Static> 区域中的历史工具消息不会随 toolDisplayMode
				// 变化自动重绘，需要返回 action 让 useCommandHandler 强制清屏 +
				// bump remountKey 重新挂载静态区域。
				action: 'toggleToolDisplay',
				message: messages.set(mode),
			};
		}

		return {
			success: false,
			message: messages.invalid,
		};
	},
});

export default {};
