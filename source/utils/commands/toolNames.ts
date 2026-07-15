import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	getToolDisplayNames,
	setToolDisplayName,
	setToolDisplayNames,
} from '../config/themeConfig.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

function getMessages() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].commandPanel.commandOutput.toolNames;
}

type Pair = {toolName: string; displayName: string};

/**
 * Parse one or more `tool:display` tokens.
 * Supports:
 *   websearch-search:网页搜索
 *   a:甲 b:乙
 *   a:甲, b:乙
 * Display may contain spaces only when a single pair uses the first `:`
 * (legacy single-pair form with spaces after colon).
 */
function parsePairs(raw: string): Pair[] | null {
	const trimmed = raw.trim();
	if (!trimmed) {
		return [];
	}

	// Prefer multi-token: split on commas / whitespace that separate pairs.
	const tokens = trimmed
		.split(/[\s,]+/)
		.map(t => t.trim())
		.filter(Boolean);

	if (tokens.length > 1) {
		const pairs: Pair[] = [];
		for (const token of tokens) {
			const colon = token.indexOf(':');
			if (colon <= 0) {
				return null;
			}
			const toolName = token.slice(0, colon).trim();
			const displayName = token.slice(colon + 1);
			if (!toolName) {
				return null;
			}
			pairs.push({toolName, displayName});
		}
		return pairs;
	}

	// Single token or single pair with spaces in display name.
	const colon = trimmed.indexOf(':');
	if (colon <= 0) {
		return null;
	}
	const toolName = trimmed.slice(0, colon).trim();
	const displayName = trimmed.slice(colon + 1);
	if (!toolName) {
		return null;
	}
	return [{toolName, displayName}];
}

function applyPairs(pairs: Pair[]): {set: number; cleared: number} {
	// Single pair: keep existing one-shot API (same events as before).
	if (pairs.length === 1) {
		const p = pairs[0]!;
		const cleared = !p.displayName || !p.displayName.trim();
		setToolDisplayName(p.toolName, p.displayName);
		return {set: cleared ? 0 : 1, cleared: cleared ? 1 : 0};
	}

	// Batch: one read-merge-write to avoid N file rewrites.
	const next = {...getToolDisplayNames()};
	let set = 0;
	let cleared = 0;
	for (const p of pairs) {
		if (!p.displayName || !p.displayName.trim()) {
			if (next[p.toolName] !== undefined) {
				delete next[p.toolName];
				cleared++;
			}
		} else {
			next[p.toolName] = p.displayName.trim();
			set++;
		}
	}
	setToolDisplayNames(Object.keys(next).length > 0 ? next : undefined);
	return {set, cleared};
}

function executeToolNames(args?: string): CommandResult {
	const raw = args?.trim() ?? '';
	const messages = getMessages();
	const overrides = getToolDisplayNames();

	if (raw === '' || raw.toLowerCase() === 'status') {
		return {
			success: true,
			message: messages.status(overrides),
		};
	}

	const lower = raw.toLowerCase();
	if (lower === 'clear' || lower === 'reset') {
		const count = Object.keys(overrides).length;
		setToolDisplayNames(undefined);
		return {
			success: true,
			message: messages.clearAll(count),
		};
	}

	const pairs = parsePairs(raw);
	if (!pairs || pairs.length === 0) {
		return {success: false, message: messages.invalid};
	}

	const {set, cleared} = applyPairs(pairs);

	if (pairs.length === 1) {
		const p = pairs[0]!;
		const wasClear = !p.displayName || !p.displayName.trim();
		return {
			success: true,
			// New tool titles pick up overrides immediately; history stays as-is.
			message: wasClear
				? messages.cleared(p.toolName)
				: messages.setOverride(p.toolName, p.displayName.trim()),
		};
	}

	return {
		success: true,
		message: messages.batch(set, cleared),
	};
}

// Usage:
//   /tool-names | /tool-name                 - List overrides
//   /tool-names status                       - Same
//   /tool-names <tool>:<display>             - Set one
//   /tool-names <tool>:                      - Clear one
//   /tool-names a:甲 b:乙                     - Batch set (preferred over editing theme.json)
//   /tool-names clear                        - Clear all overrides
const handler = {execute: executeToolNames};
registerCommand('tool-names', handler);
// Common typo / short form users type as /tool-name
registerCommand('tool-name', handler);

export default {};
