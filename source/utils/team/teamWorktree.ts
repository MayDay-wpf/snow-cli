import {execSync} from 'child_process';
import {existsSync} from 'fs';
import {join} from 'path';
import {mkdirSync, rmSync} from 'fs';

const WORKTREE_BASE = join(process.cwd(), '.snow', 'worktrees');

function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
}

export function getWorktreeBase(): string {
	return WORKTREE_BASE;
}

export function getWorktreePath(teamName: string, memberName: string): string {
	return join(
		WORKTREE_BASE,
		sanitizeName(teamName),
		sanitizeName(memberName),
	);
}

export async function createTeamWorktree(
	teamName: string,
	memberName: string,
): Promise<string> {
	const worktreePath = getWorktreePath(teamName, memberName);
	const branchName = `snow-team/${sanitizeName(teamName)}/${sanitizeName(memberName)}`;

	if (existsSync(worktreePath)) {
		return worktreePath;
	}

	const parentDir = join(worktreePath, '..');
	if (!existsSync(parentDir)) {
		mkdirSync(parentDir, {recursive: true});
	}

	try {
		// Create a new worktree with a new branch based on HEAD
		execSync(
			`git worktree add -b "${branchName}" "${worktreePath}" HEAD`,
			{stdio: 'pipe', encoding: 'utf8'},
		);
	} catch (error: any) {
		// Branch may already exist, try without -b
		if (error.message?.includes('already exists')) {
			try {
				execSync(
					`git worktree add "${worktreePath}" "${branchName}"`,
					{stdio: 'pipe', encoding: 'utf8'},
				);
			} catch (retryError: any) {
				throw new Error(
					`Failed to create worktree for ${memberName}: ${retryError.message}`,
				);
			}
		} else {
			throw new Error(
				`Failed to create worktree for ${memberName}: ${error.message}`,
			);
		}
	}

	return worktreePath;
}

export async function removeTeamWorktree(worktreePath: string): Promise<void> {
	if (!existsSync(worktreePath)) return;

	try {
		execSync(`git worktree remove "${worktreePath}" --force`, {
			stdio: 'pipe',
			encoding: 'utf8',
		});
	} catch {
		// If git worktree remove fails, try manual cleanup
		try {
			rmSync(worktreePath, {recursive: true, force: true});
			// Prune stale worktree entries
			execSync('git worktree prune', {stdio: 'pipe'});
		} catch {
			// Best effort
		}
	}
}

export async function removeWorktreeBranch(
	teamName: string,
	memberName: string,
): Promise<void> {
	const branchName = `snow-team/${sanitizeName(teamName)}/${sanitizeName(memberName)}`;
	try {
		execSync(`git branch -D "${branchName}"`, {stdio: 'pipe', encoding: 'utf8'});
	} catch {
		// Branch may not exist
	}
}

export async function cleanupTeamWorktrees(teamName: string): Promise<void> {
	const teamDir = join(WORKTREE_BASE, sanitizeName(teamName));
	if (!existsSync(teamDir)) return;

	try {
		const {readdirSync} = require('fs');
		const entries = readdirSync(teamDir, {withFileTypes: true});

		for (const entry of entries) {
			if (entry.isDirectory()) {
				const worktreePath = join(teamDir, entry.name);
				await removeTeamWorktree(worktreePath);
				await removeWorktreeBranch(teamName, entry.name);
			}
		}

		// Remove the team worktree directory
		rmSync(teamDir, {recursive: true, force: true});

		// Prune any stale worktree references
		execSync('git worktree prune', {stdio: 'pipe'});
	} catch {
		// Best effort cleanup
	}
}

export function listTeamWorktrees(teamName: string): string[] {
	const teamDir = join(WORKTREE_BASE, sanitizeName(teamName));
	if (!existsSync(teamDir)) return [];

	try {
		const {readdirSync} = require('fs');
		const entries = readdirSync(teamDir, {withFileTypes: true});
		return entries
			.filter((e: any) => e.isDirectory())
			.map((e: any) => join(teamDir, e.name));
	} catch {
		return [];
	}
}

// ── Merge helpers ──

export function getTeammateBranchName(teamName: string, memberName: string): string {
	return `snow-team/${sanitizeName(teamName)}/${sanitizeName(memberName)}`;
}

export function hasUncommittedChanges(worktreePath: string): boolean {
	try {
		const status = execSync('git status --porcelain', {
			cwd: worktreePath,
			encoding: 'utf8',
			stdio: 'pipe',
		});
		return status.trim().length > 0;
	} catch {
		return false;
	}
}

export function autoCommitWorktreeChanges(
	worktreePath: string,
	memberName: string,
	message?: string,
): boolean {
	if (!hasUncommittedChanges(worktreePath)) return false;

	try {
		execSync('git add -A', {cwd: worktreePath, stdio: 'pipe'});
		const commitMsg = message || `[Snow Team] ${memberName}: auto-commit work`;
		execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}"`, {
			cwd: worktreePath,
			stdio: 'pipe',
			encoding: 'utf8',
		});
		return true;
	} catch {
		return false;
	}
}

export type MergeStrategy = 'manual' | 'theirs' | 'ours' | 'auto';

export interface MergeResult {
	success: boolean;
	merged: boolean;
	commitCount: number;
	filesChanged: number;
	hasConflicts?: boolean;
	conflictFiles?: string[];
	autoResolved?: string[];
	error?: string;
}

export function getTeammateDiffSummary(
	teamName: string,
	memberName: string,
): {commitCount: number; filesChanged: number; diffStat: string} | null {
	const branchName = getTeammateBranchName(teamName, memberName);
	try {
		const countStr = execSync(
			`git rev-list HEAD..${branchName} --count`,
			{encoding: 'utf8', stdio: 'pipe'},
		).trim();
		const commitCount = parseInt(countStr, 10) || 0;
		if (commitCount === 0) return null;

		const diffStat = execSync(
			`git diff HEAD...${branchName} --stat`,
			{encoding: 'utf8', stdio: 'pipe'},
		).trim();

		const filesChangedMatch = diffStat.match(/(\d+) files? changed/);
		const filesChanged = filesChangedMatch ? parseInt(filesChangedMatch[1]!, 10) : 0;

		return {commitCount, filesChanged, diffStat};
	} catch {
		return null;
	}
}

export function mergeTeammateBranch(
	teamName: string,
	memberName: string,
	strategy: MergeStrategy = 'manual',
): MergeResult {
	const branchName = getTeammateBranchName(teamName, memberName);

	try {
		const countStr = execSync(
			`git rev-list HEAD..${branchName} --count`,
			{encoding: 'utf8', stdio: 'pipe'},
		).trim();
		const commitCount = parseInt(countStr, 10) || 0;

		if (commitCount === 0) {
			return {success: true, merged: false, commitCount: 0, filesChanged: 0};
		}

		const strategyFlag = strategy === 'theirs' ? ' -X theirs'
			: strategy === 'ours' ? ' -X ours'
			: '';
		const mergeCmd = `git merge ${branchName} --no-edit${strategyFlag} -m "[Snow Team] Merge ${memberName}'s work"`;

		try {
			execSync(mergeCmd, {encoding: 'utf8', stdio: 'pipe'});

			let filesChanged = 0;
			try {
				const stat = execSync('git diff HEAD~1 --stat --numstat', {
					encoding: 'utf8',
					stdio: 'pipe',
				});
				filesChanged = stat.trim().split('\n').filter(l => l.trim()).length;
			} catch { /* best effort */ }

			return {success: true, merged: true, commitCount, filesChanged};
		} catch (mergeError: any) {
			const conflictFiles = getConflictedFiles();

			// 'auto' strategy: leave in merge state for AI-based resolution by caller
			if (strategy === 'auto' && conflictFiles.length > 0) {
				return {
					success: false,
					merged: false,
					hasConflicts: true,
					commitCount,
					filesChanged: 0,
					conflictFiles,
					error: `Merge conflicts in ${conflictFiles.length} file(s). Awaiting AI resolution.`,
				};
			}

			if (strategy !== 'manual' || conflictFiles.length === 0) {
				try { execSync('git merge --abort', {stdio: 'pipe'}); } catch { /* noop */ }
				return {
					success: false,
					merged: false,
					commitCount,
					filesChanged: 0,
					conflictFiles,
					error: conflictFiles.length > 0
						? `Merge conflicts in ${conflictFiles.length} file(s) even with strategy "${strategy}": ${conflictFiles.join(', ')}`
						: mergeError.message,
				};
			}

			// strategy === 'manual': leave conflicts in working directory for lead to resolve
			return {
				success: false,
				merged: false,
				hasConflicts: true,
				commitCount,
				filesChanged: 0,
				conflictFiles,
				error: `Merge conflicts in ${conflictFiles.length} file(s). Working directory is in merge state — edit the conflicted files to remove <<<<<<< / ======= / >>>>>>> markers, then call team-resolve_merge_conflicts.`,
			};
		}
	} catch (e: any) {
		return {
			success: false,
			merged: false,
			commitCount: 0,
			filesChanged: 0,
			error: e.message,
		};
	}
}

// ── Merge state helpers ──

export function isInMergeState(): boolean {
	try {
		execSync('git rev-parse --verify MERGE_HEAD', {stdio: 'pipe', encoding: 'utf8'});
		return true;
	} catch {
		return false;
	}
}

export function getConflictedFiles(): string[] {
	try {
		const output = execSync('git diff --name-only --diff-filter=U', {
			encoding: 'utf8',
			stdio: 'pipe',
		});
		return output.trim().split('\n').filter(f => f);
	} catch {
		return [];
	}
}

export function completeMerge(message?: string): {success: boolean; error?: string} {
	if (!isInMergeState()) {
		return {success: false, error: 'Not currently in a merge state.'};
	}

	const remaining = getConflictedFiles();
	if (remaining.length > 0) {
		return {
			success: false,
			error: `${remaining.length} file(s) still have unresolved conflicts: ${remaining.join(', ')}. Edit them to remove conflict markers first.`,
		};
	}

	try {
		execSync('git add -A', {stdio: 'pipe'});
		if (message) {
			execSync(`git commit --no-edit -m "${message.replace(/"/g, '\\"')}"`, {
				stdio: 'pipe',
				encoding: 'utf8',
			});
		} else {
			execSync('git commit --no-edit', {stdio: 'pipe', encoding: 'utf8'});
		}
		return {success: true};
	} catch (e: any) {
		return {success: false, error: e.message};
	}
}

export function abortCurrentMerge(): {success: boolean; error?: string} {
	if (!isInMergeState()) {
		return {success: false, error: 'Not currently in a merge state.'};
	}

	try {
		execSync('git merge --abort', {stdio: 'pipe'});
		return {success: true};
	} catch (e: any) {
		return {success: false, error: e.message};
	}
}

export function isGitRepo(): boolean {
	try {
		execSync('git rev-parse --is-inside-work-tree', {
			stdio: 'pipe',
			encoding: 'utf8',
		});
		return true;
	} catch {
		return false;
	}
}
