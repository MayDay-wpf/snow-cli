import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getSimpleMode, setSimpleMode} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';
import {configEvents} from '../config/configEvents.js';

// 同步推送 simpleMode 变化到订阅者（如 useChatScreenModes），
// 避免依赖 1s 轮询导致 ChatHeader 第一次切换时拿到旧 state。
function applySimpleMode(value: boolean): void {
	setSimpleMode(value);
	configEvents.emitConfigChange({type: 'simpleMode', value});
}

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.simpleMode;
}

// Simple mode command handler - toggle theme simple mode
// Usage:
//   /simple        - Toggle simple mode on/off
//   /simple on     - Enable simple mode
//   /simple off    - Disable simple mode
//   /simple status - Show current status
//
// 切换时返回 toggleSimple action，由 useCommandHandler 触发清屏 + Static 重挂载，
// 否则静态区域（如 ChatHeader）无法跟随简易模式变化即时重绘。
registerCommand('simple', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();
		const enabled = getSimpleMode();
		const messages = getMessages();

		if (trimmedArgs === 'status') {
			return {
				success: true,
				message: enabled ? messages.statusEnabled : messages.statusDisabled,
			};
		}

		if (trimmedArgs === 'on') {
			if (!enabled) {
				applySimpleMode(true);
				return {
					success: true,
					action: 'toggleSimple',
					message: messages.enabled,
				};
			}
			return {
				success: true,
				message: messages.enabled,
			};
		}

		if (trimmedArgs === 'off') {
			if (enabled) {
				applySimpleMode(false);
				return {
					success: true,
					action: 'toggleSimple',
					message: messages.disabled,
				};
			}
			return {
				success: true,
				message: messages.disabled,
			};
		}

		applySimpleMode(!enabled);
		return {
			success: true,
			action: 'toggleSimple',
			message: !enabled ? messages.enabled : messages.disabled,
		};
	},
});

export default {};
