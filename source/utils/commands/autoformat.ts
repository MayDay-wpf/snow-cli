import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getAutoFormatEnabled,
	setAutoFormatEnabled,
} from '../config/projectSettings.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.autoFormat;
}

// Auto-format command handler - toggle MCP filesystem auto-formatting
// Usage:
//   /auto-format        - Toggle auto-format on/off
//   /auto-format on     - Enable auto-format
//   /auto-format off    - Disable auto-format
//   /auto-format status - Show current status
registerCommand('auto-format', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();
		const enabled = getAutoFormatEnabled();
		const messages = getMessages();

		if (trimmedArgs === 'status') {
			return {
				success: true,
				message: enabled ? messages.statusEnabled : messages.statusDisabled,
			};
		}

		if (trimmedArgs === 'on') {
			setAutoFormatEnabled(true);
			return {
				success: true,
				message: messages.enabled,
			};
		}

		if (trimmedArgs === 'off') {
			setAutoFormatEnabled(false);
			return {
				success: true,
				message: messages.disabled,
			};
		}

		setAutoFormatEnabled(!enabled);
		return {
			success: true,
			message: !enabled ? messages.enabled : messages.disabled,
		};
	},
});

export default {};
