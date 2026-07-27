/**
 * Pure slash-command panel matching / ranking helpers.
 *
 * Rules:
 * - Empty query → recent (top N) + frequent default list
 * - Non-empty query → full-set search
 * - Execution by exact name stays outside this module (submit path)
 */

export type CommandCategory =
	| 'frequent'
	| 'settings'
	| 'advanced'
	| 'fun'
	| 'custom';

/** Category tab filter: all + concrete categories. */
export type CommandCategoryFilter = 'all' | CommandCategory;

export const COMMAND_CATEGORY_TABS: CommandCategoryFilter[] = [
	'frequent',
	'settings',
	'advanced',
	'fun',
	'custom',
	'all', // 全部放最后：真正列出全部命令
];

export type MatchableCommand = {
	name: string;
	description: string;
	category?: CommandCategory;
	rankBoost?: number;
};

/** Lower is better. Infinity = no match. */
export type MatchTier = number;

export const MATCH_TIER = {
	exact: 0,
	prefix: 1,
	boundary: 2,
	substring: 3,
	abbreviation: 4,
	descPrefix: 5,
	descSubstring: 6,
	none: Number.POSITIVE_INFINITY,
} as const;

export const DEFAULT_VISIBLE_MAX = 20;
export const DEFAULT_RECENT_MAX = 5;

/**
 * Built-in command metadata: category + static rank boost.
 * rankBoost: higher wins within the same match tier / empty-list sort.
 */
export const BUILTIN_COMMAND_META: Record<
	string,
	{category: CommandCategory; rankBoost: number}
> = {
	// Frequent (core session / daily)
	help: {category: 'frequent', rankBoost: 100},
	clear: {category: 'frequent', rankBoost: 100},
	resume: {category: 'frequent', rankBoost: 100},
	home: {category: 'frequent', rankBoost: 100},
	quit: {category: 'frequent', rankBoost: 100},
	cut: {category: 'frequent', rankBoost: 100},
	btw: {category: 'frequent', rankBoost: 100},
	compact: {category: 'frequent', rankBoost: 100},
	models: {category: 'frequent', rankBoost: 100},
	profiles: {category: 'frequent', rankBoost: 100},
	mcp: {category: 'frequent', rankBoost: 100},
	plan: {category: 'frequent', rankBoost: 100},
	yolo: {category: 'frequent', rankBoost: 100},
	context: {category: 'frequent', rankBoost: 60},
	'agents-inject': {category: 'settings', rankBoost: 40},
	export: {category: 'frequent', rankBoost: 60},
	todolist: {category: 'frequent', rankBoost: 60},
	diff: {category: 'frequent', rankBoost: 60},
	review: {category: 'frequent', rankBoost: 60},

	// Settings / modes / display
	init: {category: 'settings', rankBoost: 30},
	role: {category: 'settings', rankBoost: 30},
	'role-subagent': {category: 'settings', rankBoost: 30},
	display: {category: 'settings', rankBoost: 35},
	'tool-display': {category: 'settings', rankBoost: 30},
	'tool-icons': {category: 'settings', rankBoost: 30},
	'tool-names': {category: 'settings', rankBoost: 30},
	'think-display': {category: 'settings', rankBoost: 30},
	'subagent-display': {category: 'settings', rankBoost: 30},
	'new-prompt': {category: 'settings', rankBoost: 30},
	team: {category: 'settings', rankBoost: 30},
	'tool-search': {category: 'settings', rankBoost: 30},
	codebase: {category: 'settings', rankBoost: 30},
	'ultra-todo': {category: 'settings', rankBoost: 30},
	'vulnerability-hunting': {category: 'settings', rankBoost: 30},
	'hybrid-compress': {category: 'settings', rankBoost: 30},
	'image-compress': {category: 'settings', rankBoost: 30},
	simple: {category: 'settings', rankBoost: 30},
	speedometer: {category: 'settings', rankBoost: 30},
	'auto-format': {category: 'settings', rankBoost: 30},
	permissions: {category: 'settings', rankBoost: 30},
	config: {category: 'settings', rankBoost: 30},
	telemetry: {category: 'settings', rankBoost: 30},
	'subagent-depth': {category: 'settings', rankBoost: 30},

	// Advanced
	branch: {category: 'advanced', rankBoost: 0},
	'del-session': {category: 'advanced', rankBoost: 0},
	'copy-last': {category: 'advanced', rankBoost: 0},
	usage: {category: 'advanced', rankBoost: 0},
	backend: {category: 'advanced', rankBoost: 0},
	loop: {category: 'advanced', rankBoost: 0},
	goal: {category: 'advanced', rankBoost: 0},
	'add-dir': {category: 'advanced', rankBoost: 0},
	worktree: {category: 'advanced', rankBoost: 0},
	gitline: {category: 'advanced', rankBoost: 0},
	reindex: {category: 'advanced', rankBoost: 0},
	deepresearch: {category: 'advanced', rankBoost: 0},
	connect: {category: 'advanced', rankBoost: 0},
	disconnect: {category: 'advanced', rankBoost: 0},
	'connection-status': {category: 'advanced', rankBoost: 0},
	custom: {category: 'advanced', rankBoost: 0},
	skills: {category: 'advanced', rankBoost: 0},
	'skills-': {category: 'advanced', rankBoost: 10},
	'agent-': {category: 'advanced', rankBoost: 10},
	'todo-': {category: 'advanced', rankBoost: 10},
	ide: {category: 'advanced', rankBoost: 0},

	// Fun
	games: {category: 'fun', rankBoost: 0},
	pixel: {category: 'fun', rankBoost: 0},
	buddy: {category: 'fun', rankBoost: 10},
};

export function resolveCommandMeta(
	name: string,
	isCustom = false,
): {category: CommandCategory; rankBoost: number} {
	if (isCustom) {
		return {category: 'custom', rankBoost: 10};
	}
	return BUILTIN_COMMAND_META[name] ?? {category: 'advanced', rankBoost: 0};
}

export function getCommandCategory(command: MatchableCommand): CommandCategory {
	return (
		command.category ??
		resolveCommandMeta(command.name, (command as {isCustom?: boolean}).isCustom)
			.category
	);
}

/** Split command name into searchable segments (hyphen / underscore / camel). */
export function commandNameSegments(name: string): string[] {
	const lower = name.toLowerCase();
	const bySep = lower.split(/[-_]+/).filter(Boolean);
	const segments = new Set<string>(bySep);
	// camelCase leftovers (rare for slash cmds but cheap)
	for (const part of bySep) {
		const camel = part.replace(/([a-z])([A-Z])/g, '$1-$2').split('-');
		for (const c of camel) {
			if (c) segments.add(c.toLowerCase());
		}
	}
	return [...segments];
}

/**
 * Abbreviation / initials match against hyphen-separated segments.
 * e.g. "td" → tool-display, "hc" → hybrid-compress, "tdis" soft subsequence.
 */
export function matchesAbbreviation(name: string, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return false;

	const segments = name.toLowerCase().split(/[-_]+/).filter(Boolean);
	if (segments.length === 0) return false;

	// Initials: first letter of each segment in order (allow skipping trailing segs)
	const initials = segments.map(s => s[0] ?? '').join('');
	if (initials.startsWith(q) || initials === q) {
		return true;
	}

	// Sequential segment-prefix consume: each query char chain fills segment prefixes
	// e.g. "td" against ["tool","display"], "hc" against ["hybrid","compress"]
	let qi = 0;
	for (const seg of segments) {
		if (qi >= q.length) break;
		let si = 0;
		while (qi < q.length && si < seg.length && q[qi] === seg[si]) {
			qi++;
			si++;
		}
		// At least the first char of a segment should be consumed if we touch it
		// Allow skipping a segment only if no chars matched yet in this pass.
		if (si === 0 && qi < q.length) {
			// skip unused segment
			continue;
		}
	}
	if (qi === q.length) return true;

	// Fallback: whole-name subsequence (abbreviation style)
	const compact = name.toLowerCase().replace(/[-_]/g, '');
	let ci = 0;
	for (const ch of compact) {
		if (ch === q[ci]) {
			ci++;
			if (ci === q.length) return true;
		}
	}
	return false;
}

export function scoreCommandMatch(
	command: MatchableCommand,
	queryRaw: string,
): MatchTier {
	const query = queryRaw.trim().toLowerCase();
	if (!query) {
		return MATCH_TIER.exact; // unused for empty-query path
	}

	const name = command.name.toLowerCase();
	const desc = (command.description || '').toLowerCase();

	if (name === query) return MATCH_TIER.exact;
	if (name.startsWith(query)) return MATCH_TIER.prefix;

	const segments = commandNameSegments(command.name);
	if (segments.some(seg => seg.startsWith(query))) {
		return MATCH_TIER.boundary;
	}

	if (name.includes(query)) return MATCH_TIER.substring;
	if (matchesAbbreviation(command.name, query)) {
		return MATCH_TIER.abbreviation;
	}
	if (desc.startsWith(query)) return MATCH_TIER.descPrefix;
	if (desc.includes(query)) return MATCH_TIER.descSubstring;
	return MATCH_TIER.none;
}

export type RankedCommand<T extends MatchableCommand> = {
	command: T;
	matchTier: MatchTier;
	rankBoost: number;
	usageCount: number;
	lastUsed: number;
	isRecent?: boolean;
};

export function compareRankedCommands<T extends MatchableCommand>(
	a: RankedCommand<T>,
	b: RankedCommand<T>,
	query: string,
): number {
	const q = query.trim();
	if (!q) {
		// Empty query: pin high-boost frequent commands (clear/help/...) first,
		// then recent usage, then remaining frequent by usage/boost.
		const aPinned = a.rankBoost >= 100;
		const bPinned = b.rankBoost >= 100;
		if (aPinned !== bPinned) return aPinned ? -1 : 1;
		if (aPinned && bPinned) {
			if (a.rankBoost !== b.rankBoost) return b.rankBoost - a.rankBoost;
			if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
			return a.command.name.localeCompare(b.command.name);
		}
		if (Boolean(a.isRecent) !== Boolean(b.isRecent)) {
			return a.isRecent ? -1 : 1;
		}
		if (a.isRecent && b.isRecent) {
			if (a.lastUsed !== b.lastUsed) return b.lastUsed - a.lastUsed;
			return a.command.name.localeCompare(b.command.name);
		}
		// Remaining pool: usage → boost → name
		if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
		if (a.rankBoost !== b.rankBoost) return b.rankBoost - a.rankBoost;
		return a.command.name.localeCompare(b.command.name);
	}

	if (a.matchTier !== b.matchTier) return a.matchTier - b.matchTier;
	if (a.rankBoost !== b.rankBoost) return b.rankBoost - a.rankBoost;
	if (a.usageCount !== b.usageCount) return b.usageCount - a.usageCount;
	if (a.lastUsed !== b.lastUsed) return b.lastUsed - a.lastUsed;
	if (a.command.name.length !== b.command.name.length) {
		return a.command.name.length - b.command.name.length;
	}
	return a.command.name.localeCompare(b.command.name);
}

export type FilterAndRankOptions = {
	defaultVisibleMax?: number;
	recentMax?: number;
	/** Recent command names in recency order (most recent first). */
	recentNames?: string[];
	getLastUsed?: (name: string) => number;
	/** Category tab filter; only applied when query is empty. */
	categoryFilter?: CommandCategoryFilter;
};

export function filterAndRankCommands<T extends MatchableCommand>(
	commands: T[],
	queryRaw: string,
	getUsageCount: (name: string) => number = () => 0,
	options?: FilterAndRankOptions,
): T[] {
	const query = queryRaw.trim().toLowerCase();
	const maxVisible = options?.defaultVisibleMax ?? DEFAULT_VISIBLE_MAX;
	const recentMax = options?.recentMax ?? DEFAULT_RECENT_MAX;
	const recentNames = options?.recentNames ?? [];
	const getLastUsed = options?.getLastUsed ?? (() => 0);
	const categoryFilter = options?.categoryFilter ?? 'frequent';

	const byName = new Map(commands.map(c => [c.name.toLowerCase(), c]));

	let pool: T[];
	const recentSet = new Set<string>();

	if (!query) {
		if (categoryFilter === 'frequent') {
			// 常用：最近使用 ∪ 常用分类
			const recentCmds: T[] = [];
			for (const name of recentNames) {
				if (recentCmds.length >= recentMax) break;
				const cmd = byName.get(name.toLowerCase());
				if (!cmd) continue;
				const key = cmd.name.toLowerCase();
				if (recentSet.has(key)) continue;
				recentSet.add(key);
				recentCmds.push(cmd);
			}

			const frequent = commands.filter(cmd => {
				const category = getCommandCategory(cmd);
				return (
					category === 'frequent' && !recentSet.has(cmd.name.toLowerCase())
				);
			});
			pool = [...recentCmds, ...frequent];
		} else if (categoryFilter === 'all') {
			// 全部：真正列出全部命令
			pool = commands;
		} else {
			// 其他分类 tab：只显示该分类
			pool = commands.filter(cmd => getCommandCategory(cmd) === categoryFilter);
		}
	} else {
		// Query search always uses full set (category tab does not hide matches)
		pool = commands;
	}

	const ranked: Array<RankedCommand<T>> = [];
	for (const command of pool) {
		const matchTier = query
			? scoreCommandMatch(command, query)
			: MATCH_TIER.exact;
		if (query && matchTier === MATCH_TIER.none) continue;

		const meta = resolveCommandMeta(
			command.name,
			(command as {isCustom?: boolean}).isCustom,
		);
		ranked.push({
			command,
			matchTier,
			rankBoost: command.rankBoost ?? meta.rankBoost,
			usageCount: getUsageCount(command.name),
			lastUsed: getLastUsed(command.name),
			isRecent: !query && recentSet.has(command.name.toLowerCase()),
		});
	}

	ranked.sort((a, b) => compareRankedCommands(a, b, query));

	const sorted = ranked.map(r => r.command);
	// 全部分类不截断；常用等默认列表仍限制可见数量
	if (!query && categoryFilter !== 'all' && sorted.length > maxVisible) {
		return sorted.slice(0, maxVisible);
	}
	return sorted;
}

/** Index of exact name match in a ranked list (case-insensitive). */
export function findExactMatchIndex<T extends {name: string}>(
	commands: T[],
	queryRaw: string,
): number {
	const query = queryRaw.trim().toLowerCase();
	if (!query) return -1;
	return commands.findIndex(c => c.name.toLowerCase() === query);
}

export function cycleCategoryFilter(
	current: CommandCategoryFilter,
	direction: 1 | -1,
): CommandCategoryFilter {
	const idx = COMMAND_CATEGORY_TABS.indexOf(current);
	const base = idx >= 0 ? idx : 0;
	const next =
		(base + direction + COMMAND_CATEGORY_TABS.length) %
		COMMAND_CATEGORY_TABS.length;
	return COMMAND_CATEGORY_TABS[next]!;
}
