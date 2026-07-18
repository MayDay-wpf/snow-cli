import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	DEFAULT_TOOL_STATUS_ICONS,
	getToolIconsEnabled,
	getToolIconOverrides,
	getToolStatusIconMap,
	getToolStatusIconsEnabled,
	setToolIconsEnabled,
	setToolIconOverride,
	setToolStatusIconOverride,
	setToolStatusIconsEnabled,
	type ToolStatusIconKey,
} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

const STATUS_KEYS: ToolStatusIconKey[] = [
	'pending',
	'success',
	'error',
	'warning',
	'running',
];

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.toolIcons;
}

function parseBool(token: string): boolean | null {
	const t = token.toLowerCase();
	if (['on', 'true', '1', 'enable', 'enabled'].includes(t)) {
		return true;
	}
	if (['off', 'false', '0', 'disable', 'disabled'].includes(t)) {
		return false;
	}
	return null;
}

function formatStatusSummary(): string {
	const enabled = getToolStatusIconsEnabled();
	const icons = getToolStatusIconMap();
	const parts = STATUS_KEYS.map(k => `${k}=${icons[k]}`).join(' ');
	return `status ${enabled ? 'on' : 'off'} [${parts}]`;
}

// Usage:
//   /tool-icons                    - Show category + status summary
//   /tool-icons status             - Same
//   /tool-icons on|off             - Category markers
//   /tool-icons status on|off      - Status prefixes
//   /tool-icons status:success:✓   - Override one status marker
//   /tool-icons status:success:    - Reset status marker to default
//   /tool-icons <tool>:<marker>    - Category marker override
//   /tool-icons <tool>:            - Clear category override
registerCommand('tool-icons', {
	execute: (args?: string): CommandResult => {
		const raw = args?.trim() ?? '';
		const messages = getMessages();
		const enabled = getToolIconsEnabled();
		const overrides = getToolIconOverrides();

		if (raw === '' || raw.toLowerCase() === 'status') {
			return {
				success: true,
				message: `${messages.status(
					enabled,
					overrides,
				)} · ${formatStatusSummary()}`,
			};
		}

		// status on|off  OR  status:<key>:<glyph>
		const statusMatch = raw.match(/^status(?:\s+|:)(.*)$/i);
		if (statusMatch) {
			const rest = (statusMatch[1] ?? '').trim();
			if (!rest || rest.toLowerCase() === 'status') {
				return {
					success: true,
					message: formatStatusSummary(),
				};
			}
			const boolVal = parseBool(rest);
			if (boolVal !== null) {
				setToolStatusIconsEnabled(boolVal);
				return {
					success: true,
					message: messages.setStatusEnabled(boolVal),
				};
			}
			// success:✓ or success:
			const colon = rest.indexOf(':');
			if (colon > 0) {
				const key = rest
					.slice(0, colon)
					.trim()
					.toLowerCase() as ToolStatusIconKey;
				const glyph = rest.slice(colon + 1);
				if (!STATUS_KEYS.includes(key)) {
					return {success: false, message: messages.invalid};
				}
				setToolStatusIconOverride(key, glyph);
				const cleared = !glyph || !glyph.trim();
				return {
					success: true,
					message: cleared
						? messages.clearedStatus(key)
						: messages.setStatusOverride(key, glyph.trim()),
				};
			}
			return {success: false, message: messages.invalid};
		}

		const boolVal = parseBool(raw);
		if (boolVal !== null) {
			if (boolVal !== enabled) {
				setToolIconsEnabled(boolVal);
			}
			return {
				success: true,
				// New tool titles pick up config immediately; history stays as-is.
				message: messages.setEnabled(boolVal),
			};
		}

		// tool:marker or tool: (clear)
		const colon = raw.indexOf(':');
		if (colon > 0) {
			const toolName = raw.slice(0, colon).trim();
			const icon = raw.slice(colon + 1);
			if (!toolName) {
				return {success: false, message: messages.invalid};
			}
			// Disallow using reserved status keys as tool names via bare form
			if (
				STATUS_KEYS.includes(toolName.toLowerCase() as ToolStatusIconKey) &&
				toolName.toLowerCase() === toolName
			) {
				// Treat as a status marker: /tool-icons success:✓
				const key = toolName.toLowerCase() as ToolStatusIconKey;
				setToolStatusIconOverride(key, icon);
				const cleared = !icon || !icon.trim();
				return {
					success: true,
					message: cleared
						? messages.clearedStatus(key)
						: messages.setStatusOverride(key, icon.trim()),
				};
			}
			setToolIconOverride(toolName, icon);
			const cleared = !icon || !icon.trim();
			return {
				success: true,
				message: cleared
					? messages.cleared(toolName)
					: messages.setOverride(toolName, icon.trim()),
			};
		}

		return {
			success: false,
			message: messages.invalid,
		};
	},
});

// silence unused default map import tree-shake edge (kept for docs / re-export)
void DEFAULT_TOOL_STATUS_ICONS;

export default {};
