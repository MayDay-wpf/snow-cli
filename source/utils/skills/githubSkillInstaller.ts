import {homedir} from 'os';
import {join} from 'path';
import {existsSync} from 'fs';
import {mkdir, rm, readFile, writeFile, readdir} from 'fs/promises';
import {writeFile as writeJsonFile} from 'fs/promises';
import type {SkillLocation} from '../commands/skills.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parsed GitHub URL information used to download a repository archive.
 */
export interface ParsedGitHubUrl {
	/** GitHub owner / org name, e.g. "MayDay-wpf" */
	owner: string;
	/** Repository name, e.g. "snow-cli" */
	repo: string;
	/** Branch/tag/commit. When omitted the default branch is used. */
	ref?: string;
	/**
	 * Optional sub-directory inside the repository that should be treated as
	 * the skill root (the directory containing `SKILL.md`). When omitted the
	 * repository root is used.
	 */
	subDir?: string;
}

/**
 * Metadata persisted for every skill installed from GitHub so that it can be
 * updated or removed later.
 */
export interface InstalledSkillRecord {
	/** The skill id (directory name relative to the skills root). */
	id: string;
	/** Human-readable name from SKILL.md frontmatter. */
	name: string;
	/** Short description from SKILL.md frontmatter. */
	description: string;
	/** Where the skill was installed. */
	location: SkillLocation;
	/** Original GitHub URL the skill was installed from. */
	sourceUrl: string;
	/** Parsed GitHub coordinates. */
	github: ParsedGitHubUrl;
	/** ISO timestamp of the last install/update. */
	installedAt: string;
	/** Commit SHA returned by GitHub API (for update detection). */
	commitSha?: string;
}

export type SkillInstallResult = {
	success: boolean;
	skillId: string;
	path: string;
	installedAt: string;
	commitSha?: string;
	error?: string;
};

export type SkillUpdateResult = {
	success: boolean;
	skillId: string;
	updated: boolean;
	message: string;
	error?: string;
};

export type SkillUninstallResult = {
	success: boolean;
	skillId: string;
	message: string;
	error?: string;
};

/**
 * Result of a batch install operation (e.g. a GitHub URL that contains
 * multiple skills, each in its own sub-directory with a `SKILL.md`).
 */
export type SkillBatchInstallResult = {
	/** True when at least one skill was installed successfully. */
	success: boolean;
	/** Individual install result per discovered skill. */
	results: SkillInstallResult[];
	/** Number of skills that were installed successfully. */
	installedCount: number;
	/** Total number of skills discovered in the source. */
	totalCount: number;
	/** Commit SHA shared by all skills (they come from the same tarball). */
	commitSha?: string;
	/** Overall error (e.g. download / parse failure). */
	error?: string;
};

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub URL into its components.
 *
 * Supported formats:
 *  - https://github.com/owner/repo
 *  - https://github.com/owner/repo/tree/branch
 *  - https://github.com/owner/repo/tree/branch/sub/dir
 *  - https://github.com/owner/repo.git
 *  - owner/repo
 *  - owner/repo@branch
 *  - owner/repo@branch:sub/dir
 */
export function parseGitHubUrl(input: string): ParsedGitHubUrl | null {
	const trimmed = input.trim();
	if (!trimmed) {
		return null;
	}

	let working = trimmed;

	// Strip trailing slash / .git
	working = working.replace(/\.git$/, '').replace(/\/$/, '');

	// Full https / http URL
	const urlMatch = working.match(
		/^https?:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(\/.*)?)?$/i,
	);
	if (urlMatch) {
		const [, owner, repo, ref, rest] = urlMatch;
		const subDir = rest
			? rest.replace(/^\/+/, '').replace(/\/+$/, '')
			: undefined;
		return {
			owner: owner!,
			repo: repo!,
			ref: ref || undefined,
			subDir: subDir || undefined,
		};
	}

	// Shorthand: owner/repo  or  owner/repo@ref  or  owner/repo@ref:sub/dir
	const shorthandMatch = working.match(
		/^([^/\s@]+)\/([^/\s@@]+)(?:@([^:]+))?(?::(.+))?$/,
	);
	if (shorthandMatch) {
		const [, owner, repo, ref, subDir] = shorthandMatch;
		return {
			owner: owner!,
			repo: repo!,
			ref: ref || undefined,
			subDir: subDir || undefined,
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Registry (installed skills metadata)
// ---------------------------------------------------------------------------

function getRegistryPath(): string {
	// Registry is stored at ~/.snow/skills-registry.json
	return join(homedir(), '.snow', 'skills-registry.json');
}

export async function loadInstalledSkills(): Promise<InstalledSkillRecord[]> {
	const registryPath = getRegistryPath();
	if (!existsSync(registryPath)) {
		return [];
	}
	try {
		const raw = await readFile(registryPath, 'utf-8');
		const data = JSON.parse(raw);
		if (Array.isArray(data)) {
			return data as InstalledSkillRecord[];
		}
		return [];
	} catch {
		return [];
	}
}

async function saveInstalledSkills(
	records: InstalledSkillRecord[],
): Promise<void> {
	const registryPath = getRegistryPath();
	await mkdir(join(homedir(), '.snow'), {recursive: true});
	await writeJsonFile(registryPath, JSON.stringify(records, null, 2), 'utf-8');
}

function upsertRecord(record: InstalledSkillRecord): Promise<void> {
	return loadInstalledSkills().then(records => {
		const idx = records.findIndex(
			r => r.id === record.id && r.location === record.location,
		);
		if (idx >= 0) {
			records[idx] = record;
		} else {
			records.push(record);
		}
		return saveInstalledSkills(records);
	});
}

function removeRecord(skillId: string, location: SkillLocation): Promise<void> {
	return loadInstalledSkills().then(records => {
		const filtered = records.filter(
			r => !(r.id === skillId && r.location === location),
		);
		return saveInstalledSkills(filtered);
	});
}

// ---------------------------------------------------------------------------
// Skill directory helpers
// ---------------------------------------------------------------------------

function getSkillDirectory(
	skillId: string,
	location: SkillLocation,
	projectRoot?: string,
): string {
	const segments = skillId.split('/').filter(Boolean);
	if (location === 'global') {
		return join(homedir(), '.snow', 'skills', ...segments);
	}
	const root = projectRoot || process.cwd();
	return join(root, '.snow', 'skills', ...segments);
}

// ---------------------------------------------------------------------------
// GitHub API + download
// ---------------------------------------------------------------------------

/**
 * Resolve the commit SHA for the given GitHub ref. When `ref` is omitted the
 * default branch's HEAD is used.
 */
async function resolveCommitSha(
	parsed: ParsedGitHubUrl,
	abortSignal?: AbortSignal,
): Promise<{sha: string; ref: string}> {
	// Try to resolve via the refs API (works for both branch names and tags).
	const refPath = parsed.ref ?? 'HEAD';
	const url = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${refPath}`;
	const res = await fetch(url, {
		headers: {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'snow-cli',
		},
		signal: abortSignal,
	});
	if (!res.ok) {
		// Fall back to the repo endpoint for default branch info
		const repoUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
		const repoRes = await fetch(repoUrl, {
			headers: {
				Accept: 'application/vnd.github+json',
				'User-Agent': 'snow-cli',
			},
			signal: abortSignal,
		});
		if (!repoRes.ok) {
			throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
		}
		const repoData = (await repoRes.json()) as any;
		const defaultBranch = repoData.default_branch ?? 'main';
		// Now resolve the SHA of the default branch
		const shaRes2 = await fetch(
			`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${defaultBranch}`,
			{
				headers: {
					Accept: 'application/vnd.github+json',
					'User-Agent': 'snow-cli',
				},
				signal: abortSignal,
			},
		);
		if (!shaRes2.ok) {
			throw new Error(
				`Cannot resolve commit SHA for ${parsed.owner}/${parsed.repo}@${defaultBranch}`,
			);
		}
		const shaData = (await shaRes2.json()) as any;
		return {sha: shaData.sha, ref: defaultBranch};
	}
	const data = (await res.json()) as any;
	return {sha: data.sha, ref: parsed.ref ?? refPath};
}

/**
 * Download a tarball of a GitHub repo and extract it into a temporary
 * directory. Returns the path to the extracted directory.
 *
 * Uses Node's built-in `node:zlib` + `node:tar` (via dynamic import) to avoid
 * adding a tar dependency. If `node:tar` is unavailable, falls back to the
 * system `tar` command.
 */
async function downloadAndExtract(
	parsed: ParsedGitHubUrl,
	ref: string,
	targetDir: string,
	abortSignal?: AbortSignal,
): Promise<void> {
	const downloadUrl = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/tarball/${ref}`;
	const res = await fetch(downloadUrl, {
		headers: {
			Accept: 'application/vnd.github+json',
			'User-Agent': 'snow-cli',
		},
		signal: abortSignal,
	});
	if (!res.ok) {
		throw new Error(
			`Failed to download tarball: ${res.status} ${res.statusText}`,
		);
	}

	const arrayBuffer = await res.arrayBuffer();
	const buffer = Buffer.from(arrayBuffer);

	await mkdir(targetDir, {recursive: true});

	// Write the tarball to a temp file
	const tarballPath = join(targetDir, '_download.tar.gz');
	await writeFile(tarballPath, buffer);

	// Try native extraction first (node >=22 may have experimental tar),
	// otherwise fall back to the system tar command.
	let extracted = false;

	// Strategy 1: dynamic import of 'tar' npm package (bundled in devDependencies
	// but may not be present at runtime).
	if (!extracted) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			// @ts-ignore - tar is an optional dependency that may not have type declarations
			const tar = await import(/* @vite-ignore */ 'tar');
			await tar.x({
				file: tarballPath,
				C: targetDir,
				strip: 1, // remove the top-level "owner-repo-hash/" directory
				gzip: true,
			});
			extracted = true;
		} catch {
			// tar package not available or extraction failed; try next strategy
		}
	}

	// Strategy 2: use system tar command
	if (!extracted) {
		const {execFile} = await import('child_process');
		await new Promise<void>((resolve, reject) => {
			execFile(
				'tar',
				['-xzf', tarballPath, '-C', targetDir, '--strip-components=1'],
				{signal: abortSignal, maxBuffer: 10 * 1024 * 1024},
				err => {
					if (err) {
						reject(
							new Error(
								`Failed to extract tarball (tar command): ${err.message}`,
							),
						);
					} else {
						resolve();
					}
				},
			);
		});
		extracted = true;
	}

	// Clean up the tarball file
	await rm(tarballPath, {force: true});
}

/**
 * Read SKILL.md frontmatter from an extracted skill directory.
 */
async function readSkillMetadata(
	skillDir: string,
): Promise<{name: string; description: string} | null> {
	const skillFile = join(skillDir, 'SKILL.md');
	if (!existsSync(skillFile)) {
		return null;
	}
	try {
		const {readFile: rf} = await import('fs/promises');
		const content = await rf(skillFile, 'utf-8');
		// Parse frontmatter
		const match = content.match(/^---\s*([\s\S]*?)---/);
		if (!match) {
			return null;
		}
		const frontmatter = match[1] ?? '';
		const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
		const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
		return {
			name: nameMatch?.[1]?.trim() || '',
			description: descMatch?.[1]?.trim() || '',
		};
	} catch {
		return null;
	}
}

/**
 * Recursively copy a directory.
 */
async function copyDir(src: string, dest: string): Promise<void> {
	await mkdir(dest, {recursive: true});
	const entries = await readdir(src, {withFileTypes: true});
	for (const entry of entries) {
		const srcPath = join(src, entry.name);
		const destPath = join(dest, entry.name);
		if (entry.isDirectory()) {
			await copyDir(srcPath, destPath);
		} else if (entry.isFile()) {
			const {copyFile} = await import('fs/promises');
			await copyFile(srcPath, destPath);
		}
	}
}

/**
 * Recursively remove a directory if it exists.
 */
async function removeDir(dir: string): Promise<void> {
	if (existsSync(dir)) {
		await rm(dir, {recursive: true, force: true});
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive a filesystem-safe skill id from SKILL.md frontmatter `name` or fall
 * back to the repository name.
 */
function deriveSkillId(metadata: {name: string} | null, repo: string): string {
	if (metadata?.name) {
		const id = metadata.name
			.toLowerCase()
			.replace(/[^a-z0-9/-]/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-|-$/g, '');
		if (id) {
			return id;
		}
	}
	return repo.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Install a single skill from an already-extracted source directory into the
 * destination skills directory and persist its registry record.
 *
 * Returns the individual install result. `subDirOverride` is used to record
 * the precise sub-directory path (relative to the repo root) for each skill in
 * a multi-skill repository, so that registry entries are accurate.
 */
async function installSingleSkillFromDir(
	skillSourceDir: string,
	parsed: ParsedGitHubUrl,
	shaInfo: {sha: string; ref: string},
	location: SkillLocation,
	projectRoot: string | undefined,
	rawUrl: string,
	subDirOverride?: string,
): Promise<SkillInstallResult> {
	const metadata = await readSkillMetadata(skillSourceDir);
	const skillId = deriveSkillId(metadata, parsed.repo);

	// Copy to destination
	const destDir = getSkillDirectory(skillId, location, projectRoot);
	await removeDir(destDir);
	await copyDir(skillSourceDir, destDir);

	// Persist registry
	const record: InstalledSkillRecord = {
		id: skillId,
		name: metadata?.name || skillId,
		description: metadata?.description || '',
		location,
		sourceUrl: rawUrl,
		github: {...parsed, subDir: subDirOverride ?? parsed.subDir},
		installedAt: new Date().toISOString(),
		commitSha: shaInfo.sha,
	};
	await upsertRecord(record);

	return {
		success: true,
		skillId,
		path: destDir,
		installedAt: record.installedAt,
		commitSha: shaInfo.sha,
	};
}

/**
 * Discover all skill source directories inside `baseDir`.
 *
 * - If `baseDir` itself contains a `SKILL.md`, it is treated as a single skill
 *   and `[baseDir]` is returned.
 * - Otherwise every immediate sub-directory that contains a `SKILL.md` is
 *   collected (supports repositories that host multiple skills, e.g.
 *   `https://github.com/MiniMax-AI/skills/tree/main/skills`).
 * - Returns an empty array when no `SKILL.md` can be found.
 */
async function discoverSkillDirs(baseDir: string): Promise<string[]> {
	if (existsSync(join(baseDir, 'SKILL.md'))) {
		return [baseDir];
	}
	const entries = await readdir(baseDir, {withFileTypes: true});
	const skillDirs: string[] = [];
	for (const entry of entries) {
		if (
			entry.isDirectory() &&
			existsSync(join(baseDir, entry.name, 'SKILL.md'))
		) {
			skillDirs.push(join(baseDir, entry.name));
		}
	}
	return skillDirs;
}

/**
 * Install (or re-install) skill(s) from a GitHub URL.
 *
 * When the URL points to a directory that itself contains a `SKILL.md`, a
 * single skill is installed (backward-compatible behaviour). When the URL
 * points to a directory that contains **multiple** sub-directories each with
 * their own `SKILL.md` (e.g. a skills collection repository), every skill is
 * installed individually.
 *
 * Steps:
 *  1. Parse the URL.
 *  2. Resolve the commit SHA.
 *  3. Download the tarball to a temp dir.
 *  4. Discover all skill directories (root or every sub-dir with SKILL.md).
 *  5. Install each skill + persist its registry record.
 *  6. Return a batch result.
 */
export async function installSkillFromGithub(
	rawUrl: string,
	location: SkillLocation,
	projectRoot?: string,
	abortSignal?: AbortSignal,
): Promise<SkillBatchInstallResult> {
	const parsed = parseGitHubUrl(rawUrl);
	if (!parsed) {
		return {
			success: false,
			results: [],
			installedCount: 0,
			totalCount: 0,
			error: `Invalid GitHub URL: ${rawUrl}`,
		};
	}

	// 1. Resolve commit SHA
	let shaInfo: {sha: string; ref: string};
	try {
		shaInfo = await resolveCommitSha(parsed, abortSignal);
	} catch (error) {
		return {
			success: false,
			results: [],
			installedCount: 0,
			totalCount: 0,
			error:
				error instanceof Error ? error.message : 'Failed to resolve commit SHA',
		};
	}

	// 2. Create temp directory
	const os = await import('os');
	const tmpDir = join(os.tmpdir(), `snow-skill-${Date.now()}`);
	await mkdir(tmpDir, {recursive: true});

	try {
		// 3. Download + extract
		await downloadAndExtract(parsed, shaInfo.ref, tmpDir, abortSignal);

		// 4. Determine the base search directory (apply subDir if present)
		const baseDir = parsed.subDir ? join(tmpDir, parsed.subDir) : tmpDir;
		if (!existsSync(baseDir)) {
			return {
				success: false,
				results: [],
				installedCount: 0,
				totalCount: 0,
				commitSha: shaInfo.sha,
				error: `Directory "${parsed.subDir}" not found in repository ${parsed.owner}/${parsed.repo}. Make sure the path is correct.`,
			};
		}

		// 5. Discover all skill directories
		const skillDirs = await discoverSkillDirs(baseDir);
		if (skillDirs.length === 0) {
			return {
				success: false,
				results: [],
				installedCount: 0,
				totalCount: 0,
				commitSha: shaInfo.sha,
				error: `SKILL.md not found in repository ${parsed.owner}/${
					parsed.repo
				}${
					parsed.subDir ? `/${parsed.subDir}` : ''
				}. Make sure the repository contains a SKILL.md file (either at the root or inside a sub-directory).`,
			};
		}

		// 6. Install each discovered skill
		const results: SkillInstallResult[] = [];
		for (const skillSourceDir of skillDirs) {
			try {
				// Compute the sub-directory relative to the repo root for an
				// accurate registry record. For a single skill at the base dir
				// this equals parsed.subDir; for a multi-skill repo it is
				// `<parsed.subDir>/<skillDirName>`.
				let subDirOverride = parsed.subDir;
				if (skillSourceDir !== baseDir) {
					const skillDirName = skillSourceDir.substring(baseDir.length + 1);
					subDirOverride = parsed.subDir
						? `${parsed.subDir}/${skillDirName}`
						: skillDirName;
				}
				const result = await installSingleSkillFromDir(
					skillSourceDir,
					parsed,
					shaInfo,
					location,
					projectRoot,
					rawUrl,
					subDirOverride,
				);
				results.push(result);
			} catch (error) {
				results.push({
					success: false,
					skillId: '',
					path: '',
					installedAt: new Date().toISOString(),
					error:
						error instanceof Error ? error.message : 'Failed to install skill',
				});
			}
		}

		const installedCount = results.filter(r => r.success).length;
		return {
			success: installedCount > 0,
			results,
			installedCount,
			totalCount: results.length,
			commitSha: shaInfo.sha,
		};
	} finally {
		// Clean up temp directory
		await removeDir(tmpDir);
	}
}

/**
 * Update all GitHub-installed skills. Re-downloads each skill from its
 * recorded source URL and only replaces the files if the commit SHA changed.
 */
export async function updateAllGithubSkills(
	projectRoot?: string,
	abortSignal?: AbortSignal,
): Promise<SkillUpdateResult[]> {
	const records = await loadInstalledSkills();
	const results: SkillUpdateResult[] = [];

	// Group records by sourceUrl so each repository is downloaded only once.
	const bySourceUrl = new Map<string, typeof records>();
	for (const record of records) {
		const key = record.sourceUrl;
		const group = bySourceUrl.get(key);
		if (group) {
			group.push(record);
		} else {
			bySourceUrl.set(key, [record]);
		}
	}

	for (const [sourceUrl, groupRecords] of bySourceUrl) {
		if (groupRecords.length === 0) continue;
		// Download the repo once.
		let batchResult: SkillBatchInstallResult;
		try {
			batchResult = await installSkillFromGithub(
				sourceUrl,
				groupRecords[0]!.location,
				projectRoot,
				abortSignal,
			);
		} catch (error) {
			// Network error etc. — mark all skills in this group as failed.
			const msg = error instanceof Error ? error.message : 'Update failed';
			const seenFailIds = new Set<string>();
			for (const record of groupRecords) {
				if (seenFailIds.has(record.id)) continue;
				seenFailIds.add(record.id);
				results.push({
					success: false,
					skillId: record.id,
					updated: false,
					message: msg,
					error: msg,
				});
			}
			continue;
		}

		// For each registered skill in this group, check the batch result.
		// Deduplicate by skillId — registry may contain duplicate entries.
		const seenIds = new Set<string>();
		for (const record of groupRecords) {
			if (seenIds.has(record.id)) continue;
			seenIds.add(record.id);
			const matched = batchResult.results.find(r => r.skillId === record.id);
			if (!matched) {
				results.push({
					success: false,
					skillId: record.id,
					updated: false,
					message: `Skill "${record.id}" was not found in the updated repository. The skill may have been removed or renamed upstream.`,
				});
				continue;
			}
			if (!matched.success) {
				results.push({
					success: false,
					skillId: record.id,
					updated: false,
					message: matched.error || 'Update failed',
					error: matched.error,
				});
				continue;
			}
			const wasUpdated = batchResult.commitSha !== record.commitSha;
			results.push({
				success: true,
				skillId: record.id,
				updated: wasUpdated,
				message: wasUpdated
					? `Updated to ${batchResult.commitSha?.slice(0, 7) ?? 'latest'}`
					: 'Already up to date',
			});
		}
	}

	return results;
}

/**
 * Update a single GitHub-installed skill by id.
 */
export async function updateSingleGithubSkill(
	skillId: string,
	projectRoot?: string,
	abortSignal?: AbortSignal,
): Promise<SkillUpdateResult> {
	const records = await loadInstalledSkills();
	const record = records.find(r => r.id === skillId);
	if (!record) {
		return {
			success: false,
			skillId,
			updated: false,
			message: `Skill "${skillId}" is not installed from GitHub`,
		};
	}

	// Re-install (a single GitHub URL may contain multiple skills, so we
	// filter the batch result for the specific skill we are updating).
	const batchResult = await installSkillFromGithub(
		record.sourceUrl,
		record.location,
		projectRoot,
		abortSignal,
	);

	if (!batchResult.success) {
		return {
			success: false,
			skillId,
			updated: false,
			message: batchResult.error || 'Update failed',
			error: batchResult.error,
		};
	}

	// Find the individual result matching this skill id.
	const matched = batchResult.results.find(r => r.skillId === skillId);
	if (!matched) {
		return {
			success: false,
			skillId,
			updated: false,
			message: `Skill "${skillId}" was not found in the updated repository. The skill may have been removed or renamed upstream.`,
		};
	}
	if (!matched.success) {
		return {
			success: false,
			skillId,
			updated: false,
			message: matched.error || 'Update failed',
			error: matched.error,
		};
	}

	const wasUpdated = batchResult.commitSha !== record.commitSha;
	return {
		success: true,
		skillId,
		updated: wasUpdated,
		message: wasUpdated
			? `Updated to ${batchResult.commitSha?.slice(0, 7) ?? 'latest'}`
			: 'Already up to date',
	};
}

/**
 * Uninstall a skill that was installed from GitHub.
 */
export async function uninstallGithubSkill(
	skillId: string,
	projectRoot?: string,
): Promise<SkillUninstallResult> {
	const records = await loadInstalledSkills();
	const record = records.find(r => r.id === skillId);
	if (!record) {
		return {
			success: false,
			skillId,
			message: `Skill "${skillId}" is not installed from GitHub`,
		};
	}

	// Remove the skill directory
	const skillDir = getSkillDirectory(skillId, record.location, projectRoot);
	await removeDir(skillDir);

	// Remove from registry
	await removeRecord(skillId, record.location);

	return {
		success: true,
		skillId,
		message: `Skill "${skillId}" uninstalled`,
	};
}

/**
 * List all skills installed from GitHub.
 */
export async function listGithubSkills(): Promise<InstalledSkillRecord[]> {
	return loadInstalledSkills();
}
