import {createHash} from 'crypto';
import {existsSync, mkdirSync, appendFileSync} from 'fs';
import {join} from 'path';
import type {HookType} from '../config/hooksConfig.js';

export type HookInjectDebugEntry = {
	hookType: HookType | string;
	additionalContext?: string;
	displayMessage?: string;
	promptOverride?: string;
	source?: string;
	/** Optional project root for log path (defaults to process.cwd()) */
	projectRoot?: string;
};

export type HookInjectSummary = {
	timestamp: string;
	hookType: string;
	length: number;
	hash: string;
	hasDisplay: boolean;
	hasPromptOverride: boolean;
	source?: string;
};

let lastInjectSummary: HookInjectSummary | null = null;

export function isHookInjectDebugEnabled(): boolean {
	const raw = process.env['SNOW_DEBUG_HOOKS'];
	if (!raw) return false;
	const v = raw.trim().toLowerCase();
	return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function getLastHookInjectSummary(): HookInjectSummary | null {
	return lastInjectSummary;
}

export function clearLastHookInjectSummary(): void {
	lastInjectSummary = null;
}

function shortHash(text: string): string {
	return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * When SNOW_DEBUG_HOOKS=1, append a one-line inject summary to
 * `.snow/log/hooks-inject.txt` and keep the latest entry for UI/status.
 */
export function recordHookInjectDebug(entry: HookInjectDebugEntry): void {
	const payload =
		entry.promptOverride || entry.additionalContext || entry.displayMessage;
	if (!payload) {
		return;
	}

	const text = entry.promptOverride || entry.additionalContext || '';
	const summary: HookInjectSummary = {
		timestamp: new Date().toISOString(),
		hookType: String(entry.hookType),
		length: text.length,
		hash: text ? shortHash(text) : shortHash(entry.displayMessage || ''),
		hasDisplay: Boolean(entry.displayMessage),
		hasPromptOverride: Boolean(entry.promptOverride),
		...(entry.source ? {source: entry.source} : {}),
	};
	lastInjectSummary = summary;

	if (!isHookInjectDebugEnabled()) {
		return;
	}

	try {
		const root = entry.projectRoot || process.cwd();
		const logDir = join(root, '.snow', 'log');
		if (!existsSync(logDir)) {
			mkdirSync(logDir, {recursive: true});
		}
		const line = JSON.stringify(summary);
		appendFileSync(join(logDir, 'hooks-inject.txt'), `${line}
`, 'utf8');
	} catch {
		// fail-open: never block hook flow for debug logging
	}
}
