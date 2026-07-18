/**
 * Remote command builders, output parsers, tool detection and short-lived caches
 * for ACE Code Search running against an `ssh://...` basePath.
 *
 * Design constraints:
 * - We must NEVER build a remote symbol index on the local machine. All "search across
 *   the workspace" work happens on the remote host via shell commands.
 * - A short-lived cache (REMOTE_CACHE_TTL_MS) is kept per remote (prefix + root) for:
 *     1. detectRemoteTools() — avoids re-spawning `command -v` on every action.
 *     2. ctags NDJSON output — avoids re-running ctags when the user fires
 *        semantic_search several times in a row.
 *   The cache is intentionally simple (no LRU, no size limit), keyed by remote prefix
 *   + remote root, and is always rebuilt after the TTL.
 * - All inputs that ride into the shell are routed through `escapeShellArg()` so
 *   that filenames, patterns and symbol names never break out of single quotes.
 */

import type {SSHClient} from '../../../utils/ssh/sshClient.js';
import type {CodeSymbol, SymbolType} from '../../types/aceCodeSearch.types.js';
import {logger} from '../../../utils/core/logger.js';
import {TEXT_SEARCH_TIMEOUT_MS} from './constants.utils.js';
import {detectLanguage} from './language.utils.js';

/** Default short cache TTL applied to tool-detection + ctags output. */
export const REMOTE_CACHE_TTL_MS = 60 * 1000;

/** Directories we never want to recurse into on the remote side. */
export const REMOTE_EXCLUDE_DIRS = [
	'node_modules',
	'.git',
	'dist',
	'build',
	'__pycache__',
	'target',
	'.next',
	'.nuxt',
	'coverage',
	'out',
	'.cache',
	'vendor',
];

/**
 * Source code file extensions used by ctags / file enumeration on the remote.
 * Mirrors language.utils.ts but kept here so we don't reach into the file-enum logic.
 */
export const REMOTE_SOURCE_EXTENSIONS = [
	'ts',
	'tsx',
	'js',
	'jsx',
	'mjs',
	'cjs',
	'py',
	'go',
	'rs',
	'java',
	'cs',
	'rb',
	'php',
	'cpp',
	'cc',
	'cxx',
	'c',
	'h',
	'hpp',
];

export interface RemoteToolset {
	hasGrep: boolean;
	hasRg: boolean;
	hasGit: boolean;
	hasCtags: boolean;
	isGitRepo: boolean;
}

/**
 * Custom error class so the caller can distinguish "remote tool missing" from real
 * exec errors and surface a friendly message to the MCP tool result.
 */
export class RemoteToolUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RemoteToolUnavailableError';
	}
}

interface CacheBucket {
	tools?: {value: RemoteToolset; expiresAt: number};
	ctags?: {value: string; expiresAt: number};
}

const cacheByRemote: Map<string, CacheBucket> = new Map();

function getBucket(remoteKey: string): CacheBucket {
	let bucket = cacheByRemote.get(remoteKey);
	if (!bucket) {
		bucket = {};
		cacheByRemote.set(remoteKey, bucket);
	}
	return bucket;
}

export function invalidateRemoteCache(remoteKey?: string): void {
	if (remoteKey) {
		cacheByRemote.delete(remoteKey);
	} else {
		cacheByRemote.clear();
	}
}

/**
 * Safely quote an arbitrary string for use as a single shell argument under bash/sh.
 * We wrap the string in single quotes and escape any embedded single quote as `'\''`.
 * This is the standard recipe; it works regardless of $-expansion, glob, etc.
 */
export function escapeShellArg(value: string): string {
	if (value.length === 0) return "''";
	return "'" + value.replace(/'/g, `'\\''`) + "'";
}

/**
 * Detect which command-line tools are available on the remote host and whether the
 * remote root is inside a git working tree. Results are cached per remoteKey for
 * REMOTE_CACHE_TTL_MS so subsequent ACE calls don't pay the round-trip cost.
 */
export async function detectRemoteTools(
	client: SSHClient,
	remoteRoot: string,
	remoteKey: string,
): Promise<RemoteToolset> {
	const bucket = getBucket(remoteKey);
	const now = Date.now();
	if (bucket.tools && bucket.tools.expiresAt > now) {
		return bucket.tools.value;
	}

	// Probe everything in a single round-trip. We don't fail the call if one probe
	// errors — each `command -v` either prints a path (success) or nothing.
	const rootArg = escapeShellArg(remoteRoot);
	const probe = [
		`command -v grep >/dev/null 2>&1 && echo GREP=1 || echo GREP=0`,
		`command -v rg >/dev/null 2>&1 && echo RG=1 || echo RG=0`,
		`command -v git >/dev/null 2>&1 && echo GIT=1 || echo GIT=0`,
		`(command -v ctags >/dev/null 2>&1 && ctags --version 2>/dev/null | grep -qi universal && echo CTAGS=1) || echo CTAGS=0`,
		`(cd ${rootArg} 2>/dev/null && git rev-parse --is-inside-work-tree >/dev/null 2>&1 && echo GITREPO=1) || echo GITREPO=0`,
	].join('; ');

	let stdout = '';
	try {
		const res = await client.exec(probe, {timeout: 15_000});
		stdout = res.stdout;
	} catch (err) {
		// If even the probe failed, the remote shell is unusable. Fall through with
		// a minimal toolset; the action methods will downgrade or refuse cleanly.
		logger.warn('detectRemoteTools: probe exec failed', err);
	}

	const flag = (key: string) => new RegExp(`^${key}=1\\b`, 'm').test(stdout);
	const toolset: RemoteToolset = {
		hasGrep: flag('GREP'),
		hasRg: flag('RG'),
		hasGit: flag('GIT'),
		hasCtags: flag('CTAGS'),
		isGitRepo: flag('GITREPO'),
	};

	bucket.tools = {value: toolset, expiresAt: now + REMOTE_CACHE_TTL_MS};
	return toolset;
}

/**
 * Build a `find` command that lists source files under `remoteRoot`, honoring our
 * default excluded directories. Output is NUL-delimited if `nullSeparated` is true
 * (currently unused — left available for future streaming consumers).
 */
export function buildRemoteFindCommand(
	remoteRoot: string,
	extensions: string[] = REMOTE_SOURCE_EXTENSIONS,
): string {
	const root = escapeShellArg(remoteRoot);
	const pruneClauses = REMOTE_EXCLUDE_DIRS.map(
		d => `-path ${escapeShellArg(`*/${d}`)} -prune -o`,
	).join(' ');
	const nameClauses = extensions
		.map(ext => `-iname ${escapeShellArg(`*.${ext}`)}`)
		.join(' -o ');
	// Note: the `-print` at the end ensures only matching, non-pruned files are emitted.
	return `find ${root} ${pruneClauses} -type f \\( ${nameClauses} \\) -print`;
}

/**
 * Build a text-search command, preferring the fastest available strategy.
 * Returns the full shell command (already cd'd) plus a hint of which tool ran,
 * useful for diagnostics in logs.
 */
export function buildRemoteTextSearchCommand(opts: {
	remoteRoot: string;
	pattern: string;
	fileGlob?: string;
	isRegex: boolean;
	maxResults: number;
	toolset: RemoteToolset;
}): {command: string; tool: 'git-grep' | 'rg' | 'grep'} | null {
	const {remoteRoot, pattern, fileGlob, isRegex, maxResults, toolset} = opts;
	const root = escapeShellArg(remoteRoot);
	const cd = `cd ${root} && `;
	const limit = Math.max(1, maxResults);
	const patternArg = escapeShellArg(pattern);

	// Strategy 1: git grep when applicable.
	if (toolset.isGitRepo && toolset.hasGit) {
		let cmd = `git grep -n --no-color --untracked --ignore-case`;
		cmd += isRegex ? ` -E` : ` -F`;
		cmd += ` ${patternArg}`;
		if (fileGlob) {
			cmd += ` -- ${escapeShellArg(fileGlob)}`;
		}
		cmd += ` | head -n ${limit}`;
		return {command: cd + cmd, tool: 'git-grep'};
	}

	// Strategy 2: ripgrep.
	if (toolset.hasRg) {
		const flags: string[] = ['-n', '--no-heading', '--color=never'];
		if (!isRegex) flags.push('-F');
		if (fileGlob) {
			flags.push('-g');
			flags.push(escapeShellArg(fileGlob));
		}
		for (const dir of REMOTE_EXCLUDE_DIRS) {
			flags.push('-g');
			flags.push(escapeShellArg(`!${dir}/**`));
		}
		const cmd = `rg ${flags.join(' ')} ${patternArg} . | head -n ${limit}`;
		return {command: cd + cmd, tool: 'rg'};
	}

	// Strategy 3: plain grep.
	if (toolset.hasGrep) {
		let cmd = `grep -rn --color=never`;
		if (!isRegex) cmd += ` -F`;
		for (const dir of REMOTE_EXCLUDE_DIRS) {
			cmd += ` --exclude-dir=${escapeShellArg(dir)}`;
		}
		if (fileGlob) {
			cmd += ` --include=${escapeShellArg(fileGlob)}`;
		}
		cmd += ` ${patternArg} .`;
		cmd += ` | head -n ${limit}`;
		return {command: cd + cmd, tool: 'grep'};
	}

	return null;
}

/**
 * Build a "find references to symbolName" command. Always word-bounded.
 */
export function buildRemoteReferencesCommand(opts: {
	remoteRoot: string;
	symbolName: string;
	maxResults: number;
	toolset: RemoteToolset;
}): {command: string} | null {
	const {remoteRoot, symbolName, maxResults, toolset} = opts;
	const root = escapeShellArg(remoteRoot);
	const cd = `cd ${root} && `;
	const limit = Math.max(1, maxResults);
	const symArg = escapeShellArg(symbolName);

	if (toolset.isGitRepo && toolset.hasGit) {
		// `git grep -nw` is word-bounded by default.
		return {
			command: `${cd}git grep -n --no-color --untracked --ignore-case -w -F ${symArg} | head -n ${limit}`,
		};
	}
	if (toolset.hasRg) {
		const excludes = REMOTE_EXCLUDE_DIRS.map(
			d => `-g ${escapeShellArg(`!${d}/**`)}`,
		).join(' ');
		return {
			command: `${cd}rg -n --no-heading --color=never -w -F ${excludes} ${symArg} . | head -n ${limit}`,
		};
	}
	if (toolset.hasGrep) {
		const excludes = REMOTE_EXCLUDE_DIRS.map(
			d => `--exclude-dir=${escapeShellArg(d)}`,
		).join(' ');
		return {
			command: `${cd}grep -rnw --color=never -F ${excludes} ${symArg} . | head -n ${limit}`,
		};
	}
	return null;
}

/**
 * Build a "find definition of symbolName" command using grep patterns.
 * Targets the common definition shapes across languages.
 *
 * For ctags-based definition lookup, see `buildRemoteCtagsListCommand` and consume
 * its NDJSON output instead.
 */
export function buildRemoteDefinitionGrepCommand(opts: {
	remoteRoot: string;
	symbolName: string;
	toolset: RemoteToolset;
	maxResults: number;
}): {command: string} | null {
	const {remoteRoot, symbolName, toolset, maxResults} = opts;
	const sym = symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// Match: `function foo`, `class foo`, `interface foo`, `def foo`, `func foo`,
	// `const foo =`, `let foo =`, `var foo =`, `type foo =`, `enum foo`, `struct foo`,
	// `trait foo`, `impl foo`, `export ... foo` (handled by surrounding patterns).
	const pattern = `\\b(function|class|interface|def|func|const|let|var|type|enum|struct|trait|impl|fn)[[:space:]]+${sym}\\b`;
	const root = escapeShellArg(remoteRoot);
	const cd = `cd ${root} && `;
	const patternArg = escapeShellArg(pattern);
	const limit = Math.max(1, maxResults);

	if (toolset.isGitRepo && toolset.hasGit) {
		return {
			command: `${cd}git grep -n --no-color --untracked -E ${patternArg} | head -n ${limit}`,
		};
	}
	if (toolset.hasRg) {
		const excludes = REMOTE_EXCLUDE_DIRS.map(
			d => `-g ${escapeShellArg(`!${d}/**`)}`,
		).join(' ');
		return {
			command: `${cd}rg -n --no-heading --color=never ${excludes} ${patternArg} . | head -n ${limit}`,
		};
	}
	if (toolset.hasGrep) {
		const excludes = REMOTE_EXCLUDE_DIRS.map(
			d => `--exclude-dir=${escapeShellArg(d)}`,
		).join(' ');
		return {
			command: `${cd}grep -rnE --color=never ${excludes} ${patternArg} . | head -n ${limit}`,
		};
	}
	return null;
}

/**
 * Build a ctags NDJSON dump command. Each output line is a JSON object describing a
 * single symbol. Result is cached for REMOTE_CACHE_TTL_MS per remoteKey.
 */
export function buildRemoteCtagsListCommand(remoteRoot: string): string {
	const root = escapeShellArg(remoteRoot);
	const excludes = REMOTE_EXCLUDE_DIRS.map(
		d => `--exclude=${escapeShellArg(d)}`,
	).join(' ');
	// `-f -` writes to stdout. `--fields=+nKzs` ensures we get line number + kind + scope.
	return `cd ${root} && ctags -R --output-format=json --fields=+nKzs ${excludes} -f - .`;
}

/**
 * Map ctags `kind` strings into our `SymbolType` taxonomy.
 */
function ctagsKindToSymbolType(kind: string | undefined): SymbolType {
	const k = (kind || '').toLowerCase();
	switch (k) {
		case 'function':
		case 'func':
		case 'subroutine':
			return 'function';
		case 'method':
			return 'method';
		case 'class':
			return 'class';
		case 'interface':
			return 'interface';
		case 'enum':
		case 'enumerator':
			return 'enum';
		case 'struct':
		case 'typedef':
		case 'type':
		case 'alias':
			return 'type';
		case 'variable':
		case 'var':
		case 'field':
		case 'member':
		case 'property':
			return 'variable';
		case 'constant':
		case 'const':
		case 'macro':
			return 'constant';
		default:
			// Default to function — most "code defines a thing called X" cases parse this way.
			return 'function';
	}
}

interface CtagsJsonEntry {
	_type?: string;
	name?: string;
	path?: string;
	line?: number;
	kind?: string;
	scope?: string;
	signature?: string;
	language?: string;
}

/**
 * Parse universal-ctags NDJSON output (one JSON object per line) into CodeSymbol[].
 * Robust against malformed lines (skips them silently).
 */
export function parseCtagsJsonOutput(
	stdout: string,
	options: {
		remoteRoot: string;
		maxSymbols?: number;
	},
): CodeSymbol[] {
	const symbols: CodeSymbol[] = [];
	if (!stdout) return symbols;
	const lines = stdout.split('\n');
	for (const raw of lines) {
		const trimmed = raw.trim();
		if (!trimmed || trimmed[0] !== '{') continue;
		let entry: CtagsJsonEntry;
		try {
			entry = JSON.parse(trimmed) as CtagsJsonEntry;
		} catch {
			continue;
		}
		if (entry._type && entry._type !== 'tag') continue;
		if (!entry.name || !entry.path || typeof entry.line !== 'number') continue;
		// Normalize path: ctags emits paths relative to the cwd (which we set to remoteRoot).
		let filePath = entry.path.replace(/\\/g, '/');
		if (filePath.startsWith('./')) filePath = filePath.slice(2);
		const language =
			entry.language?.toLowerCase() ||
			detectLanguage(filePath) ||
			'plaintext';
		symbols.push({
			name: entry.name,
			type: ctagsKindToSymbolType(entry.kind),
			filePath,
			line: entry.line,
			column: 1,
			signature: entry.signature,
			scope: entry.scope,
			language,
		});
		if (options.maxSymbols && symbols.length >= options.maxSymbols) break;
	}
	return symbols;
}

/**
 * Run ctags on the remote and return the raw NDJSON stdout. The result is cached
 * for REMOTE_CACHE_TTL_MS per remoteKey, so repeated semantic_search calls within
 * the cache window pay zero remote round-trips.
 */
export async function runRemoteCtags(
	client: SSHClient,
	remoteRoot: string,
	remoteKey: string,
	abortSignal?: AbortSignal,
): Promise<string> {
	const bucket = getBucket(remoteKey);
	const now = Date.now();
	if (bucket.ctags && bucket.ctags.expiresAt > now) {
		return bucket.ctags.value;
	}
	const command = buildRemoteCtagsListCommand(remoteRoot);
	const res = await client.exec(command, {
		timeout: TEXT_SEARCH_TIMEOUT_MS,
		signal: abortSignal,
	});
	// ctags returns 0 on success; non-zero usually indicates partial parse errors —
	// the stdout we got is still useful, so we don't throw here.
	const stdout = res.stdout || '';
	bucket.ctags = {value: stdout, expiresAt: now + REMOTE_CACHE_TTL_MS};
	return stdout;
}

/**
 * Parse a `path:line:content` style grep output line into a structured record.
 * Unlike the local `parseGrepOutput`, this version preserves the raw path (used
 * by the caller to re-emit `ssh://...` URLs).
 */
export interface RemoteGrepHit {
	filePath: string;
	line: number;
	column: number;
	content: string;
}

export function parseRemoteGrepOutput(stdout: string): RemoteGrepHit[] {
	const results: RemoteGrepHit[] = [];
	if (!stdout) return results;
	const lines = stdout.split(/\r?\n/);
	for (const raw of lines) {
		if (!raw.trim()) continue;
		const first = raw.indexOf(':');
		if (first < 0) continue;
		const second = raw.indexOf(':', first + 1);
		if (second < 0) continue;
		const filePathRaw = raw.substring(0, first);
		const lineStr = raw.substring(first + 1, second);
		const content = raw.substring(second + 1);
		const lineNumber = parseInt(lineStr, 10);
		if (isNaN(lineNumber)) continue;
		// Normalize the leading `./` that recursive grep tends to emit.
		const filePath = filePathRaw.startsWith('./')
			? filePathRaw.slice(2)
			: filePathRaw;
		results.push({
			filePath: filePath.replace(/\\/g, '/'),
			line: lineNumber,
			column: 1,
			content: content.trim(),
		});
	}
	return results;
}
