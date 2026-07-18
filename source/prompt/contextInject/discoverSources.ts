import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
	DiscoveredSource,
	ResolvedContextInjectConfig,
} from './types.js';

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

function isFile(p: string): boolean {
	try {
		return fs.existsSync(p) && fs.statSync(p).isFile();
	} catch {
		return false;
	}
}

function findGitRoot(start: string): string | null {
	let cur = path.resolve(start);
	for (;;) {
		if (isFile(path.join(cur, '.git')) || fs.existsSync(path.join(cur, '.git'))) {
			// .git may be file (worktree) or directory
			try {
				const st = fs.statSync(path.join(cur, '.git'));
				if (st.isDirectory() || st.isFile()) return cur;
			} catch {
				// continue
			}
		}
		const parent = path.dirname(cur);
		if (parent === cur) return null;
		cur = parent;
	}
}

/**
 * Pick one instruction file in a directory (Codex order):
 * AGENTS.override.md → AGENTS.md → fallbacks (e.g. CLAUDE.md)
 */
function pickAgentsFile(
	dir: string,
	primary: string,
	fallbacks: string[],
): string | null {
	const candidates = [
		'AGENTS.override.md',
		primary,
		...fallbacks.filter(f => f !== primary && f !== 'AGENTS.override.md'),
	];
	for (const name of candidates) {
		const full = path.join(dir, name);
		if (isFile(full)) {
			// Skip empty files
			try {
				const text = fs.readFileSync(full, 'utf-8').trim();
				if (text) return full;
			} catch {
				// try next
			}
		}
	}
	return null;
}

/**
 * Directories from project root down to cwd (inclusive), root first.
 */
function dirsFromRootToCwd(cwd: string): string[] {
	const resolved = path.resolve(cwd);
	const root = findGitRoot(resolved) ?? resolved;
	const rootResolved = path.resolve(root);

	// If cwd is outside root somehow, only use cwd.
	const rel = path.relative(rootResolved, resolved);
	if (rel.startsWith('..') || path.isAbsolute(rel)) {
		return [resolved];
	}

	const parts = rel ? rel.split(path.sep).filter(Boolean) : [];
	const dirs: string[] = [rootResolved];
	let cur = rootResolved;
	for (const part of parts) {
		cur = path.join(cur, part);
		dirs.push(cur);
	}
	return dirs;
}

/**
 * Discover AGENTS.md chain. Does NOT include ROLE.md.
 *
 * Order (priority ascending = earlier in prompt):
 * 1. Global ~/.snow/AGENTS.md (or override)
 * 2. Project root → cwd, one file per directory
 */
export function discoverContextSources(args: {
	cwd: string;
	config: ResolvedContextInjectConfig;
}): DiscoveredSource[] {
	const {cwd, config} = args;
	const out: DiscoveredSource[] = [];
	let priority = 0;

	// Global
	const globalDir = path.join(os.homedir(), '.snow');
	const globalFile = pickAgentsFile(
		globalDir,
		config.primaryFilename,
		config.fallbackFilenames,
	);
	if (globalFile) {
		out.push({
			kind: 'global-agents',
			absPath: globalFile,
			relLabel: `~/.snow/${path.basename(globalFile)}`,
			priority: priority++,
		});
	}

	// Project chain root → cwd
	const dirs = dirsFromRootToCwd(cwd);
	const root = dirs[0] ?? path.resolve(cwd);
	for (const dir of dirs) {
		const file = pickAgentsFile(
			dir,
			config.primaryFilename,
			config.fallbackFilenames,
		);
		if (!file) continue;
		const rel = toPosix(path.relative(root, file)) || path.basename(file);
		out.push({
			kind: 'project-agents',
			absPath: file,
			relLabel: rel.startsWith('..') ? toPosix(file) : rel,
			priority: priority++,
		});
	}

	return out;
}

/** @deprecated kept for tests that still import isExcluded — no-op style helper */
export function isExcluded(relPath: string, globs: string[]): boolean {
	const base = path.posix.basename(relPath.split(path.sep).join('/'));
	for (const g of globs) {
		if (g === base || g.endsWith('/' + base)) return true;
	}
	return false;
}
