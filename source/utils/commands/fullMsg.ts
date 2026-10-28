import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getFullMessageMode, setFullMessageMode} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';
import {configEvents} from '../config/configEvents.js';

// 同步推送 fullMessageMode 变化到订阅者（如 useChatScreenLocalState），
// 避免依赖轮询导致切换后 UI 第一次仍拿到旧值。
function applyFullMessageMode(value: boolean): void {
	setFullMessageMode(value);
	configEvents.emitConfigChange({type: 'fullMessageMode', value});
}

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.fullMsg;
}

// Full message command handler - toggle UI message trimming
// Usage:
//   /full-msg             - Toggle full message mode
//   /full-msg on          - Keep the full conversation history (disable trimming)
//   /full-msg off         - Re-enable trimming (default)
//   /full-msg status      - Show current mode
registerCommand('full-msg', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase() ?? '';
		const currentMode = getFullMessageMode();
		const messages = getMessages();

		if (trimmedArgs === 'status') {
			return {
				success: true,
				message: messages.status(currentMode),
			};
		}

		let nextMode: boolean;
		if (trimmedArgs === '') {
			nextMode = !currentMode;
		} else if (
			trimmedArgs === 'on' ||
			trimmedArgs === 'true' ||
			trimmedArgs === '1'
		) {
			nextMode = true;
		} else if (
			trimmedArgs === 'off' ||
			trimmedArgs === 'false' ||
			trimmedArgs === '0'
		) {
			nextMode = false;
		} else {
			return {
				success: false,
				message: messages.invalid,
			};
		}

		if (nextMode !== currentMode) {
			applyFullMessageMode(nextMode);
		}

		return {
			success: true,
			// 切换裁剪开关后，<Static> 区域不会自动重绘，需要返回 action 让
			// useCommandHandler 强制清屏 + bump remountKey，重新载入会话消息。
			action: 'toggleFullMessage',
			message: messages.set(nextMode),
		};
	},
});

export default {};
