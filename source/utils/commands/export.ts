import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

const SUPPORTED_FORMATS = ['txt', 'md', 'html', 'json'] as const;
type ExportFormat = (typeof SUPPORTED_FORMATS)[number];

// Get translated messages
function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.export;
}

function parseFormat(args?: string): ExportFormat | {error: string} {
	const raw = (args ?? '').trim().toLowerCase();
	if (!raw) {
		return 'txt';
	}
	// Strip a leading dot if user typed `.md` etc.
	const normalized = raw.startsWith('.') ? raw.slice(1) : raw;
	if ((SUPPORTED_FORMATS as readonly string[]).includes(normalized)) {
		return normalized as ExportFormat;
	}
	const messages = getMessages();
	const template =
		messages.invalidFormat ??
		'Invalid export format: {format}. Supported: txt, md, html.';
	return {
		error: template.replace('{format}', raw),
	};
}

// Export command handler - exports chat conversation to txt / md / html
registerCommand('export', {
	execute: (args?: string): CommandResult => {
		const messages = getMessages();
		const parsed = parseFormat(args);
		if (typeof parsed !== 'string') {
			return {
				success: false,
				message: parsed.error,
			};
		}
		return {
			success: true,
			action: 'exportChat',
			message: messages.exporting,
			exportFormat: parsed,
		};
	},
});

export default {};
