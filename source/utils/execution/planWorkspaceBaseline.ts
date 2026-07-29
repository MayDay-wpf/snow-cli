import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {promisify} from 'node:util';

const execFileAsync = promisify(execFile);
const INTERNAL_PATH_PREFIXES = ['.snow/', '.trellis/'];

export type PlanWorkspaceBaseline = Record<string, string>;

export type WorkspaceBaselineCapture = {
	available: boolean;
	baseline: PlanWorkspaceBaseline;
	reason?: string;
};

function normalizeRepoPath(filePath: string): string {
	return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

function isInternalPath(filePath: string): boolean {
	const normalized = normalizeRepoPath(filePath);
	return INTERNAL_PATH_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function parsePorcelainPaths(output: string): Array<{
	path: string;
	status: string;
}> {
	const records = output.split('\0');
	const paths: Array<{path: string; status: string}> = [];
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record || record.length < 4) continue;
		const status = record.slice(0, 2);
		const filePath = normalizeRepoPath(record.slice(3));
		if (filePath && !isInternalPath(filePath)) {
			paths.push({path: filePath, status});
		}

		if (/[RC]/.test(status)) {
			const original = normalizeRepoPath(records[++index] ?? '');
			if (original && !isInternalPath(original)) {
				paths.push({path: original, status: `${status}:original`});
			}
		}
	}

	return paths;
}

async function fingerprint(cwd: string, filePath: string): Promise<string> {
	const absolute = path.resolve(cwd, filePath);
	try {
		const stat = await fs.lstat(absolute);
		if (stat.isSymbolicLink()) {
			return `symlink:${await fs.readlink(absolute)}`;
		}

		if (!stat.isFile()) {
			return `other:${stat.size}:${stat.mtimeMs}`;
		}

		const content = await fs.readFile(absolute);
		return `sha256:${createHash('sha256').update(content).digest('hex')}`;
	} catch (error: any) {
		return error?.code === 'ENOENT' ? 'missing' : `unreadable:${String(error)}`;
	}
}

/** Capture dirty and untracked files with content fingerprints. */
export async function capturePlanWorkspaceBaseline(
	cwd: string,
): Promise<WorkspaceBaselineCapture> {
	try {
		const {stdout} = await execFileAsync(
			'git',
			['status', '--porcelain=v1', '-z', '--untracked-files=all'],
			{cwd, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024},
		);
		const entries = parsePorcelainPaths(String(stdout));
		const baseline: PlanWorkspaceBaseline = {};
		for (const entry of entries) {
			baseline[entry.path] = `${entry.status}:${await fingerprint(
				cwd,
				entry.path,
			)}`;
		}

		return {available: true, baseline};
	} catch (error) {
		return {
			available: false,
			baseline: {},
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}

export function changedSinceBaseline(
	before: PlanWorkspaceBaseline,
	after: PlanWorkspaceBaseline,
): string[] {
	const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
	return [...paths]
		.filter(filePath => before[filePath] !== after[filePath])
		.sort();
}

export function findOutOfScopeChanges(
	changedFiles: string[],
	allowedFiles: string[],
): string[] {
	const allowed = new Set(
		allowedFiles
			.map(filePath =>
				normalizeRepoPath(filePath)
					.replace(/\s*\((?:new|新建|create[ds]?)\)\s*$/i, '')
					.trim(),
			)
			.filter(Boolean),
	);
	return changedFiles.filter(
		filePath => !allowed.has(normalizeRepoPath(filePath)),
	);
}
