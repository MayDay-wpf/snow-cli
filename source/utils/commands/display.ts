import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getToolDisplayMode,
	setToolDisplayMode,
	getThinkDisplayMode,
	setThinkDisplayMode,
	getSubAgentDisplayMode,
	setSubAgentDisplayMode,
	type ToolDisplayMode,
	type ThinkDisplayMode,
	type SubAgentDisplayMode,
} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';
import {configEvents} from '../config/configEvents.js';

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput;
}

function applyTool(mode: ToolDisplayMode): void {
	setToolDisplayMode(mode);
	configEvents.emitConfigChange({type: 'toolDisplayMode', value: mode});
}

function applyThink(mode: ThinkDisplayMode): void {
	setThinkDisplayMode(mode);
	configEvents.emitConfigChange({type: 'thinkDisplayMode', value: mode});
}

function applySubAgent(mode: SubAgentDisplayMode): void {
	setSubAgentDisplayMode(mode);
	configEvents.emitConfigChange({type: 'subAgentDisplayMode', value: mode});
}

function statusMessage(): string {
	const out = getMessages();
	return out.display.status(
		getToolDisplayMode(),
		getThinkDisplayMode(),
		getSubAgentDisplayMode(),
	);
}

// Unified display entry — keeps legacy /tool-display /think-display /subagent-display.
// Usage:
//   /display
//   /display status
//   /display tool [full|compact|hidden|status]
//   /display think [full|compact|status]
//   /display subagent [slots|multi|compact|hidden|status]
registerCommand('display', {
	execute: (args?: string): CommandResult => {
		const tokens = (args ?? '')
			.trim()
			.toLowerCase()
			.split(/\s+/)
			.filter(Boolean);
		const out = getMessages();

		if (tokens.length === 0) {
			return {
				success: true,
				action: 'showDisplayPanel',
				message: out.display.opening,
			};
		}

		if (tokens[0] === 'status') {
			return {success: true, message: statusMessage()};
		}

		if (tokens[0] === 'help') {
			return {
				success: true,
				message: statusMessage() + '\n' + out.display.help,
			};
		}

		const target = tokens[0];
		const modeToken = tokens[1] ?? 'status';

		if (target === 'tool' || target === 'tools') {
			const current = getToolDisplayMode();
			if (modeToken === 'status') {
				return {success: true, message: out.toolDisplay.status(current)};
			}
			if (
				modeToken === 'full' ||
				modeToken === 'compact' ||
				modeToken === 'hidden'
			) {
				const mode = modeToken as ToolDisplayMode;
				if (mode !== current) {
					applyTool(mode);
				}
				return {
					success: true,
					action: 'toggleToolDisplay',
					message: out.toolDisplay.set(mode),
				};
			}
			return {success: false, message: out.toolDisplay.invalid};
		}

		if (target === 'think' || target === 'thinking') {
			const current = getThinkDisplayMode();
			if (modeToken === 'status') {
				return {success: true, message: out.thinkDisplay.status(current)};
			}
			if (modeToken === 'full' || modeToken === 'compact') {
				const mode = modeToken as ThinkDisplayMode;
				if (mode !== current) {
					applyThink(mode);
				}
				return {
					success: true,
					action: 'toggleThinkDisplay',
					message: out.thinkDisplay.set(mode),
				};
			}
			return {success: false, message: out.thinkDisplay.invalid};
		}

		if (target === 'subagent' || target === 'sub-agent' || target === 'agent') {
			const current = getSubAgentDisplayMode();
			if (modeToken === 'status') {
				return {success: true, message: out.subAgentDisplay.status(current)};
			}
			if (
				modeToken === 'slots' ||
				modeToken === 'multi' ||
				modeToken === 'compact' ||
				modeToken === 'hidden'
			) {
				const mode = modeToken as SubAgentDisplayMode;
				if (mode !== current) {
					applySubAgent(mode);
				}
				return {
					success: true,
					message: out.subAgentDisplay.set(mode),
				};
			}
			return {success: false, message: out.subAgentDisplay.invalid};
		}

		return {success: false, message: out.display.invalid};
	},
});

export default {};
