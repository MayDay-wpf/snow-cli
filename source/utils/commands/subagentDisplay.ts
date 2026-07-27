import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getSubAgentDisplayMode,
	setSubAgentDisplayMode,
	type SubAgentDisplayMode,
} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';
import {configEvents} from '../config/configEvents.js';

function applySubAgentDisplayMode(value: SubAgentDisplayMode): void {
	setSubAgentDisplayMode(value);
	configEvents.emitConfigChange({type: 'subAgentDisplayMode', value});
}

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput
		.subAgentDisplay;
}

const VALID_MODES: SubAgentDisplayMode[] = [
	'slots',
	'multi',
	'compact',
	'hidden',
];

// Usage:
//   /subagent-display             - Show current mode
//   /subagent-display slots       - Agent container + single focus overwrite (default)
//   /subagent-display multi       - Agent container + recent focus history lines
//   /subagent-display compact     - Agent header only
//   /subagent-display hidden      - Disable live slots (legacy tool cards)
//   /subagent-display status      - Show current mode
registerCommand('subagent-display', {
	execute: (args?: string): CommandResult => {
		const trimmedArgs = args?.trim().toLowerCase();
		const currentMode = getSubAgentDisplayMode();
		const messages = getMessages();

		if (trimmedArgs === 'status' || trimmedArgs === '') {
			return {
				success: true,
				message: messages.status(currentMode),
			};
		}

		if (VALID_MODES.includes(trimmedArgs as SubAgentDisplayMode)) {
			const mode = trimmedArgs as SubAgentDisplayMode;
			if (mode !== currentMode) {
				applySubAgentDisplayMode(mode);
			}
			return {
				success: true,
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
