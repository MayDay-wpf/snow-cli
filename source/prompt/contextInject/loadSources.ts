import fs from 'node:fs';
import type {
	DiscoveredSource,
	LoadedSource,
	ResolvedContextInjectConfig,
} from './types.js';

function stripFrontmatter(raw: string): string {
	if (!raw.startsWith('---')) {
		return raw;
	}
	const end = raw.indexOf('\n---', 3);
	if (end === -1) {
		return raw;
	}
	return raw.slice(end + 4).replace(/^\r?\n/, '');
}

/**
 * Soft-cap helper (still used by tests / optional callers).
 */
export function summarizeAgentsMd(raw: string, maxChars: number): string {
	const body = stripFrontmatter(raw).trim();
	if (!body) return '';
	if (body.length <= maxChars) return body;
	const keep = Math.max(0, maxChars - 20);
	return body.slice(0, keep) + '\n...(truncated)';
}

function truncateText(
	text: string,
	maxChars: number,
): {text: string; truncated: boolean} {
	if (text.length <= maxChars) {
		return {text, truncated: false};
	}
	const keep = Math.max(0, maxChars - 20);
	return {text: text.slice(0, keep) + '\n...(truncated)', truncated: true};
}

/**
 * Load AGENTS files with per-file cap. Fail-open per file.
 */
export function loadContextSources(
	sources: DiscoveredSource[],
	config: ResolvedContextInjectConfig,
): LoadedSource[] {
	const loaded: LoadedSource[] = [];

	for (const source of sources) {
		try {
			const stat = fs.statSync(source.absPath);
			if (!stat.isFile()) continue;

			const raw = fs.readFileSync(source.absPath, 'utf-8');
			const body = stripFrontmatter(raw).trim();
			if (!body) continue;

			const {text, truncated} = truncateText(body, config.perFileMax);
			loaded.push({
				...source,
				content: text,
				chars: text.length,
				truncated,
				mtimeMs: stat.mtimeMs,
			});
		} catch {
			// fail-open
		}
	}

	return loaded;
}
