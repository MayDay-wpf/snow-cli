import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getThinkDisplayMode,
	setThinkDisplayMode,
	type ThinkDisplayMode,
} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';
import {configEvents} from '../config/configEvents.js';

// 同步推送 thinkDisplayMode 变化到订阅者（如 useChatScreenModes），
// 避免依赖 1s 轮询导致 UI 第一次切换时拿到旧 state。
function applyThinkDisplayMode(value: ThinkDisplayMode): void {
	setThinkDisplayMode(value);
	configEvents.emitConfigChange({type: 'thinkDisplayMode', value});
}

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.thinkDisplay;
}

// Think display command handler - control how thinking content is displayed
// Usage:
//   /think-display             - Show current mode (defaults to compact)
//   /think-display full        - Move all thinking content to static area (original behavior)
//   /think-display compact     - Show compact thinking content (default)
//   /think-display status      - Show current display mode
registerCommand('think-display', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();
		const currentMode = getThinkDisplayMode();
		const messages = getMessages();

		if (trimmedArgs === 'status' || trimmedArgs === '') {
			return {
				success: true,
				message: messages.status(currentMode),
			};
		}

		if (trimmedArgs === 'full' || trimmedArgs === 'compact') {
			const mode = trimmedArgs as ThinkDisplayMode;
			if (mode !== currentMode) {
				applyThinkDisplayMode(mode);
			}
			return {
				success: true,
				// 切换显示模式后，<Static> 区域中的历史思考消息不会随 thinkDisplayMode
				// 变化自动重绘，需要返回 action 让 useCommandHandler 强制清屏 +
				// bump remountKey 重新挂载静态区域。
				action: 'toggleThinkDisplay',
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
