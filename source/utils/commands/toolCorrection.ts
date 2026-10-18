import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getToolCorrectionEnabled,
	setToolCorrectionEnabled,
} from '../config/projectSettings.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.toolCorrection;
}

/**
 * Tool-call correction command handler.
 *
 * When a tool invocation fails, the basic model repairs only the arguments of
 * the same tool call and the executor retries it (at most 3 repairs).
 *
 * Usage:
 *   /tool-correction        - Toggle tool-call correction on/off
 *   /tool-correction on     - Enable tool-call correction
 *   /tool-correction off    - Disable tool-call correction
 *   /tool-correction status - Show current status
 */
registerCommand('tool-correction', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();
		const enabled = getToolCorrectionEnabled();
		const messages = getMessages();

		if (trimmedArgs === 'status') {
			return {
				success: true,
				message: enabled ? messages.statusEnabled : messages.statusDisabled,
			};
		}

		if (trimmedArgs === 'on') {
			setToolCorrectionEnabled(true);
			return {
				success: true,
				message: messages.enabled,
			};
		}

		if (trimmedArgs === 'off') {
			setToolCorrectionEnabled(false);
			return {
				success: true,
				message: messages.disabled,
			};
		}

		setToolCorrectionEnabled(!enabled);
		return {
			success: true,
			message: !enabled ? messages.enabled : messages.disabled,
		};
	},
});

export default {};
