import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';
import {
	getContextInjectEnabled,
	getContextInjectEnabledSource,
	setContextInjectEnabled,
} from '../config/contextInjectSettings.js';

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.agentsInject;
}

function formatStatus(enabled: boolean): string {
	const messages = getMessages();
	const source = getContextInjectEnabledSource();
	const sourceLabel =
		source === 'project'
			? messages.sourceProject
			: source === 'global'
				? messages.sourceGlobal
				: messages.sourceDefault;
	const base = enabled ? messages.statusEnabled : messages.statusDisabled;
	return `${base} (${sourceLabel})`;
}

// AGENTS.md user-message inject toggle
// Usage:
//   /agents-inject        - Toggle on/off (writes project .snow/settings.json)
//   /agents-inject on     - Enable
//   /agents-inject off    - Disable
//   /agents-inject status - Show current effective status
function executeAgentsInject(args?: string): CommandResult {
	const trimmedArgs = args?.trim().toLowerCase();
	const enabled = getContextInjectEnabled();
	const messages = getMessages();

	if (trimmedArgs === 'status') {
		return {
			success: true,
			message: formatStatus(enabled),
		};
	}

	if (trimmedArgs === 'on') {
		setContextInjectEnabled(true, 'project');
		return {
			success: true,
			message: messages.enabled,
		};
	}

	if (trimmedArgs === 'off') {
		setContextInjectEnabled(false, 'project');
		return {
			success: true,
			message: messages.disabled,
		};
	}

	if (!trimmedArgs) {
		const next = !enabled;
		setContextInjectEnabled(next, 'project');
		return {
			success: true,
			message: next ? messages.enabled : messages.disabled,
		};
	}

	return {
		success: false,
		message: messages.invalid,
	};
}

registerCommand('agents-inject', {
	execute: executeAgentsInject,
});


export default {};
