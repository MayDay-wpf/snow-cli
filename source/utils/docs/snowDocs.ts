import {existsSync, readdirSync, readFileSync, statSync} from 'fs';
import {dirname, join, relative, sep} from 'path';
import {fileURLToPath} from 'url';
import {getCurrentLanguage, type Language} from '../config/languageConfig.js';
import {getPackageVersion} from '../core/version.js';

export type DocsLocale = 'zh' | 'en';

export interface SnowDocEntry {
	/** Locale-relative path using forward slashes, e.g. "14.MCP配置.md" */
	id: string;
	locale: DocsLocale;
	filename: string;
	absPath: string;
	title: string;
	summary: string;
	keywords: string[];
}

export interface SnowDocsSearchHit {
	id: string;
	locale: DocsLocale;
	title: string;
	summary: string;
	score: number;
	snippet?: string;
}

const MAX_GET_CHARS = 24_000;
const MAX_SEARCH_RESULTS = 12;
const MAX_SNIPPET_CHARS = 280;

let cachedDocsRoot: string | null | undefined;
let catalogCache: Map<string, SnowDocEntry> | null = null;
let catalogRoot: string | null = null;

function normalizeSlashes(pathValue: string): string {
	return pathValue.replace(/\\/g, '/');
}

function uniquePaths(paths: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of paths) {
		const key = normalizeSlashes(value).toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(value);
	}
	return result;
}

function isDocsUsageRoot(candidate: string): boolean {
	return existsSync(join(candidate, 'zh')) || existsSync(join(candidate, 'en'));
}

function walkParents(startDir: string, maxDepth = 8): string[] {
	const parents: string[] = [];
	let current = startDir;
	for (let i = 0; i < maxDepth; i++) {
		parents.push(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return parents;
}

/**
 * Resolve bundled/dev docs root: docs/usage
 * Prefer paths next to the running bundle, then walk up from module/cwd.
 */
export function resolveSnowDocsRoot(): string | null {
	if (cachedDocsRoot !== undefined) {
		return cachedDocsRoot;
	}

	const candidates: string[] = [];

	try {
		const moduleDir = dirname(fileURLToPath(import.meta.url));
		for (const parent of walkParents(moduleDir)) {
			candidates.push(join(parent, 'docs', 'usage'));
			// Bundled layout: bundle/docs/usage next to cli.mjs / package assets
			if (parent.endsWith(`${sep}bundle`) || parent.endsWith('/bundle')) {
				candidates.push(join(parent, 'docs', 'usage'));
			}
		}
	} catch {
		// ignore import.meta resolution failures
	}

	for (const parent of walkParents(process.cwd())) {
		candidates.push(join(parent, 'docs', 'usage'));
	}

	for (const candidate of uniquePaths(candidates)) {
		if (isDocsUsageRoot(candidate)) {
			cachedDocsRoot = candidate;
			return cachedDocsRoot;
		}
	}

	cachedDocsRoot = null;
	return null;
}

/**
 * Resolve bundled built-in skills root (contains snow-docs/SKILL.md).
 */
export function resolveBuiltInSkillsRoot(): string | null {
	const candidates: string[] = [];

	try {
		const moduleDir = dirname(fileURLToPath(import.meta.url));
		for (const parent of walkParents(moduleDir)) {
			candidates.push(join(parent, 'skills'));
			candidates.push(join(parent, 'source', 'skills'));
			candidates.push(join(parent, 'bundle', 'skills'));
		}
	} catch {
		// ignore
	}

	for (const parent of walkParents(process.cwd())) {
		candidates.push(join(parent, 'skills'));
		candidates.push(join(parent, 'source', 'skills'));
		candidates.push(join(parent, 'bundle', 'skills'));
	}

	for (const candidate of uniquePaths(candidates)) {
		if (existsSync(join(candidate, 'snow-docs', 'SKILL.md'))) {
			return candidate;
		}
	}

	return null;
}

export function resolveDocsLocale(explicit?: string | null): DocsLocale {
	if (explicit === 'zh' || explicit === 'en') {
		return explicit;
	}

	const language: Language = getCurrentLanguage();
	if (language === 'zh' || language === 'zh-TW') {
		return 'zh';
	}
	return 'en';
}

function extractTitle(content: string, fallback: string): string {
	const heading = content.match(/^\s*#\s+(.+)$/m);
	if (heading?.[1]) {
		return heading[1].trim();
	}
	return fallback.replace(/\.md$/i, '');
}

function extractSummary(content: string): string {
	const lines = content.split(/\r?\n/);
	const body: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) {
			if (body.length > 0) break;
			continue;
		}
		if (trimmed.startsWith('#')) continue;
		if (trimmed.startsWith('!') || trimmed.startsWith('|')) continue;
		body.push(trimmed.replace(/^[-*]\s+/, ''));
		if (body.join(' ').length >= 160) break;
	}
	const summary = body.join(' ').replace(/\s+/g, ' ').trim();
	return summary.length > 180 ? `${summary.slice(0, 177)}...` : summary;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^\p{L}\p{N}_./-]+/u)
		.map(token => token.trim())
		.filter(token => token.length >= 2);
}

function buildKeywords(
	entry: Omit<SnowDocEntry, 'keywords'>,
	content: string,
): string[] {
	const bag = new Set<string>();
	for (const token of tokenize(
		`${entry.id} ${entry.filename} ${entry.title} ${entry.summary}`,
	)) {
		bag.add(token);
	}

	// Topic aliases for common Snow configuration tasks
	const aliasMap: Array<{match: RegExp; aliases: string[]}> = [
		{match: /mcp/i, aliases: ['mcp', 'modelcontextprotocol', '工具', 'tools']},
		{
			match: /profile|配置|config|first/i,
			aliases: ['profile', 'config', 'configuration', '配置', '首次配置'],
		},
		{match: /hook/i, aliases: ['hooks', 'hook', '自动化']},
		{match: /skill/i, aliases: ['skills', 'skill', '技能']},
		{match: /sub-?agent|子代理/i, aliases: ['subagent', 'agent', '子代理']},
		{match: /敏感|sensitive/i, aliases: ['sensitive', 'yolo', '危险命令']},
		{
			match: /proxy|代理|browser|浏览器/i,
			aliases: ['proxy', 'browser', '代理'],
		},
		{
			match: /relay|中转|header/i,
			aliases: ['relay', 'proxy-api', '中转', 'headers'],
		},
		{match: /lsp|ace/i, aliases: ['lsp', 'ace', 'language-server']},
		{match: /team/i, aliases: ['team', '多智能体']},
		{match: /sse/i, aliases: ['sse', 'server']},
		{match: /privacy|隐私/i, aliases: ['privacy', '隐私']},
		{match: /install|安装/i, aliases: ['install', 'update', '安装']},
	];

	const haystack = `${entry.filename} ${entry.title} ${entry.summary}`;
	for (const item of aliasMap) {
		if (item.match.test(haystack)) {
			for (const alias of item.aliases) bag.add(alias.toLowerCase());
		}
	}

	// Light content tokens (keep catalog cheap)
	for (const token of tokenize(content).slice(0, 80)) {
		bag.add(token);
	}

	return Array.from(bag);
}

function listMarkdownFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const files: string[] = [];
	const walk = (current: string) => {
		for (const entry of readdirSync(current, {withFileTypes: true})) {
			if (entry.name.startsWith('.')) continue;
			const full = join(current, entry.name);
			if (entry.isDirectory()) {
				walk(full);
				continue;
			}
			if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
				files.push(full);
			}
		}
	};
	walk(dir);
	return files;
}

function loadCatalog(docsRoot: string): Map<string, SnowDocEntry> {
	if (catalogCache && catalogRoot === docsRoot) {
		return catalogCache;
	}

	const map = new Map<string, SnowDocEntry>();
	for (const locale of ['zh', 'en'] as DocsLocale[]) {
		const localeDir = join(docsRoot, locale);
		for (const absPath of listMarkdownFiles(localeDir)) {
			try {
				const content = readFileSync(absPath, 'utf-8');
				const filename = relative(localeDir, absPath);
				const id = normalizeSlashes(filename);
				const title = extractTitle(content, id);
				const summary = extractSummary(content);
				const base: Omit<SnowDocEntry, 'keywords'> = {
					id,
					locale,
					filename: id,
					absPath: absPath,
					title,
					summary,
				};
				const entry: SnowDocEntry = {
					...base,
					keywords: buildKeywords(base, content),
				};
				map.set(`${locale}:${id}`, entry);
			} catch {
				// skip unreadable docs
			}
		}
	}

	catalogCache = map;
	catalogRoot = docsRoot;
	return map;
}

function getCatalog(): {docsRoot: string; catalog: Map<string, SnowDocEntry>} {
	const docsRoot = resolveSnowDocsRoot();
	if (!docsRoot) {
		throw new Error(
			'Snow usage docs are not available in this installation. Expected docs/usage next to the CLI bundle or repository root.',
		);
	}
	return {docsRoot, catalog: loadCatalog(docsRoot)};
}

function scoreEntry(
	entry: SnowDocEntry,
	query: string,
	tokens: string[],
): number {
	const q = query.toLowerCase().trim();
	if (!q) return 0;

	let score = 0;
	const idLower = entry.id.toLowerCase();
	const titleLower = entry.title.toLowerCase();
	const summaryLower = entry.summary.toLowerCase();

	if (idLower === q || titleLower === q) score += 100;
	if (idLower.includes(q)) score += 40;
	if (titleLower.includes(q)) score += 35;
	if (summaryLower.includes(q)) score += 15;

	for (const token of tokens) {
		if (entry.keywords.includes(token)) score += 8;
		if (idLower.includes(token)) score += 6;
		if (titleLower.includes(token)) score += 5;
		if (summaryLower.includes(token)) score += 2;
	}

	// Prefer catalogue / numbered guides slightly when ties happen
	if (/^0[\.\s]/.test(entry.id) || /catalogue|目录/i.test(entry.id)) {
		score += 1;
	}

	return score;
}

function findSnippet(
	content: string,
	query: string,
	tokens: string[],
): string | undefined {
	const lower = content.toLowerCase();
	const needles = [query.toLowerCase(), ...tokens].filter(Boolean);
	let index = -1;
	let matched = '';
	for (const needle of needles) {
		const at = lower.indexOf(needle);
		if (at >= 0) {
			index = at;
			matched = needle;
			break;
		}
	}
	if (index < 0) return undefined;

	const start = Math.max(0, index - 80);
	const end = Math.min(content.length, index + matched.length + 160);
	let snippet = content.slice(start, end).replace(/\s+/g, ' ').trim();
	if (start > 0) snippet = `...${snippet}`;
	if (end < content.length) snippet = `${snippet}...`;
	if (snippet.length > MAX_SNIPPET_CHARS) {
		snippet = `${snippet.slice(0, MAX_SNIPPET_CHARS - 3)}...`;
	}
	return snippet;
}

function listLocaleEntries(locale: DocsLocale): SnowDocEntry[] {
	const {catalog} = getCatalog();
	return Array.from(catalog.values())
		.filter(entry => entry.locale === locale)
		.sort((a, b) => a.id.localeCompare(b.id, undefined, {numeric: true}));
}

export function listSnowDocs(options?: {
	locale?: string | null;
	includeOtherLocale?: boolean;
}): {
	version: string;
	docsRoot: string;
	locale: DocsLocale;
	docs: Array<Pick<SnowDocEntry, 'id' | 'locale' | 'title' | 'summary'>>;
} {
	const {docsRoot} = getCatalog();
	const locale = resolveDocsLocale(options?.locale);
	const docs = listLocaleEntries(locale).map(entry => ({
		id: entry.id,
		locale: entry.locale,
		title: entry.title,
		summary: entry.summary,
	}));

	return {
		version: getPackageVersion(),
		docsRoot,
		locale,
		docs,
	};
}

export function searchSnowDocs(options: {
	query: string;
	locale?: string | null;
	maxResults?: number;
}): {
	version: string;
	locale: DocsLocale;
	query: string;
	hits: SnowDocsSearchHit[];
} {
	const query = (options.query || '').trim();
	if (!query) {
		throw new Error('query is required');
	}

	const locale = resolveDocsLocale(options.locale);
	const maxResults = Math.min(
		Math.max(options.maxResults ?? 8, 1),
		MAX_SEARCH_RESULTS,
	);
	const tokens = tokenize(query);
	const entries = listLocaleEntries(locale);

	const hits: SnowDocsSearchHit[] = [];
	for (const entry of entries) {
		const score = scoreEntry(entry, query, tokens);
		if (score <= 0) continue;
		let snippet: string | undefined;
		try {
			const content = readFileSync(entry.absPath, 'utf-8');
			snippet = findSnippet(content, query, tokens);
		} catch {
			// ignore snippet errors
		}
		hits.push({
			id: entry.id,
			locale: entry.locale,
			title: entry.title,
			summary: entry.summary,
			score,
			snippet,
		});
	}
	hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
	const limitedHits = hits.slice(0, maxResults);

	// Fallback: if current locale is sparse, try the other locale for discovery only
	if (limitedHits.length === 0) {
		const other: DocsLocale = locale === 'zh' ? 'en' : 'zh';
		const otherHits: SnowDocsSearchHit[] = [];
		for (const entry of listLocaleEntries(other)) {
			const score = scoreEntry(entry, query, tokens);
			if (score <= 0) continue;
			otherHits.push({
				id: entry.id,
				locale: entry.locale,
				title: entry.title,
				summary: entry.summary,
				score,
			});
		}
		otherHits.sort((a, b) => b.score - a.score);
		const limitedOtherHits = otherHits.slice(0, maxResults);
		return {
			version: getPackageVersion(),
			locale,
			query,
			hits: limitedOtherHits,
		};
	}

	return {
		version: getPackageVersion(),
		locale,
		query,
		hits: limitedHits,
	};
}

function resolveDocEntry(pathOrId: string, locale: DocsLocale): SnowDocEntry {
	const {catalog} = getCatalog();
	const raw = normalizeSlashes(pathOrId.trim()).replace(/^\.\//, '');
	if (!raw) {
		throw new Error('path is required');
	}

	const directKeys = [
		`${locale}:${raw}`,
		`${locale}:${raw}.md`,
		`zh:${raw}`,
		`en:${raw}`,
		`zh:${raw}.md`,
		`en:${raw}.md`,
	];

	for (const key of directKeys) {
		const hit = catalog.get(key);
		if (hit) return hit;
	}

	// Allow locale-prefixed ids: "zh/14.MCP配置.md"
	const localePrefixed = raw.match(/^(zh|en)\/(.*)$/i);
	if (localePrefixed?.[1] && localePrefixed[2] !== undefined) {
		const prefLocale = localePrefixed[1].toLowerCase() as DocsLocale;
		const rest = localePrefixed[2];
		const hit =
			catalog.get(`${prefLocale}:${rest}`) ||
			catalog.get(`${prefLocale}:${rest}.md`);
		if (hit) return hit;
	}

	// Fuzzy contains match on id/title within preferred locale first
	const needle = raw.toLowerCase();
	const preferred = listLocaleEntries(locale).filter(
		entry =>
			entry.id.toLowerCase().includes(needle) ||
			entry.title.toLowerCase().includes(needle),
	);
	if (preferred.length === 1) return preferred[0]!;
	if (preferred.length > 1) {
		const options = preferred
			.slice(0, 8)
			.map(entry => `- ${entry.id} — ${entry.title}`)
			.join('\n');
		throw new Error(
			`Ambiguous document path "${pathOrId}". Candidates:\n${options}`,
		);
	}

	const any = Array.from(catalog.values()).filter(
		entry =>
			entry.id.toLowerCase().includes(needle) ||
			entry.title.toLowerCase().includes(needle),
	);
	if (any.length === 1) return any[0]!;

	throw new Error(
		`Document not found: "${pathOrId}". Use snow-docs-list or snow-docs-search first.`,
	);
}

export function getSnowDoc(options: {
	path: string;
	locale?: string | null;
	maxChars?: number;
}): {
	version: string;
	locale: DocsLocale;
	id: string;
	title: string;
	absPath: string;
	truncated: boolean;
	content: string;
} {
	const locale = resolveDocsLocale(options.locale);
	const entry = resolveDocEntry(options.path, locale);
	const maxChars = Math.min(
		Math.max(options.maxChars ?? MAX_GET_CHARS, 1000),
		60_000,
	);

	const stat = statSync(entry.absPath);
	if (!stat.isFile()) {
		throw new Error(`Not a file: ${entry.absPath}`);
	}

	const raw = readFileSync(entry.absPath, 'utf-8');
	const truncated = raw.length > maxChars;
	const content = truncated
		? `${raw.slice(0, maxChars)}\n\n...[truncated ${
				raw.length - maxChars
		  } chars; call again with a higher maxChars or a more specific section via search]...`
		: raw;

	return {
		version: getPackageVersion(),
		locale: entry.locale,
		id: entry.id,
		title: entry.title,
		absPath: entry.absPath,
		truncated,
		content,
	};
}

/** Test helper / cache invalidation after packaging changes */
export function resetSnowDocsCache(): void {
	cachedDocsRoot = undefined;
	catalogCache = null;
	catalogRoot = null;
}
