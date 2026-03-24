import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {StatusLineHookDefinition} from './types.js';

const GIT_BRANCH_REFRESH_INTERVAL_MS = 10000;
const execFileAsync = promisify(execFile);

async function getGitBranch(cwd: string): Promise<string | undefined> {
	try {
		const {stdout} = await execFileAsync(
			'git',
			['rev-parse', '--abbrev-ref', 'HEAD'],
			{
				timeout: 2000,
				maxBuffer: 1024,
				cwd,
			},
		);
		const branch = stdout.trim();
		return branch || undefined;
	} catch {
		return undefined;
	}
}

export const gitBranchStatusLineHook: StatusLineHookDefinition = {
	id: 'builtin.git-branch',
	refreshIntervalMs: GIT_BRANCH_REFRESH_INTERVAL_MS,
	async getItems(context) {
		const branch = await getGitBranch(context.cwd);
		if (!branch) {
			return undefined;
		}

		return {
			id: 'git-branch',
			text: `⑂ ${branch}`,
			detailedText: `⑂ ${context.labels.gitBranch}: ${branch}`,
			color: '#F472B6',
			priority: 100,
		};
	},
};

export default gitBranchStatusLineHook;
