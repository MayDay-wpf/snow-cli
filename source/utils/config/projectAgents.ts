import {
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from 'fs';
import {basename, extname, join} from 'path';
import {homedir} from 'os';
import matter from 'gray-matter';
import {logger} from '../core/logger.js';
import type {SubAgent} from './subAgentConfig.js';

function listMarkdownFilesRecursive(dir: string): string[] {
	if (!existsSync(dir)) {
		return [];
	}

	const out: string[] = [];
	const entries = readdirSync(dir, {withFileTypes: true});
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...listMarkdownFilesRecursive(full));
			continue;
		}
		if (entry.isFile() && extname(entry.name).toLowerCase() === '.md') {
			out.push(full);
		}
	}
	return out;
}

function coerceTools(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map(v => (typeof v === 'string' ? v.trim() : ''))
			.filter(Boolean);
	}
	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}
	return [];
}

function stemId(filePath: string): string {
	return basename(filePath, extname(filePath));
}

/**
 * Parse a single agent markdown file into SubAgent.
 * Invalid files return null (caller logs and skips).
 */
export function parseAgentMarkdownFile(filePath: string): SubAgent | null {
	try {
		const raw = readFileSync(filePath, 'utf8');
		const parsed = matter(raw);
		const data = (parsed.data || {}) as Record<string, unknown>;
		const body = (parsed.content || '').trim();

		const idRaw =
			typeof data['id'] === 'string' && data['id'].trim()
				? data['id'].trim()
				: stemId(filePath);
		const nameRaw =
			typeof data['name'] === 'string' && data['name'].trim()
				? data['name'].trim()
				: idRaw;
		const description =
			typeof data['description'] === 'string' ? data['description'] : '';
		const roleFromFm =
			typeof data['role'] === 'string' ? data['role'].trim() : '';
		const role = roleFromFm || body;
		const tools = coerceTools(data['tools']);

		if (!idRaw) {
			return null;
		}

		let mtime: string | undefined;
		try {
			mtime = statSync(filePath).mtime.toISOString();
		} catch {
			// ignore
		}

		return {
			id: idRaw,
			name: nameRaw,
			description,
			role: role || undefined,
			tools,
			builtin: false,
			createdAt: mtime,
			updatedAt: mtime,
		};
	} catch (error) {
		logger.warn('Failed to parse project agent markdown', {
			filePath,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

export function loadAgentsFromDir(dir: string): SubAgent[] {
	const files = listMarkdownFilesRecursive(dir);
	const agents: SubAgent[] = [];
	for (const file of files) {
		const agent = parseAgentMarkdownFile(file);
		if (agent) {
			agents.push(agent);
		} else {
			logger.warn('Skipping invalid project agent file', {file});
		}
	}
	return agents;
}

export function getProjectAgentsDir(cwd: string = process.cwd()): string {
	return join(cwd, '.snow', 'agents');
}

export function getGlobalAgentsDir(): string {
	return join(homedir(), '.snow', 'agents');
}

export function loadProjectAgents(cwd: string = process.cwd()): SubAgent[] {
	return loadAgentsFromDir(getProjectAgentsDir(cwd));
}

export function loadGlobalAgents(): SubAgent[] {
	return loadAgentsFromDir(getGlobalAgentsDir());
}
