import * as fs from 'fs';
import * as path from 'path';

export interface SessionListItem {
	id: string;
	title: string;
	updatedAt: number;
	messageCount: number;
}

export interface SessionListResult {
	sessions: SessionListItem[];
	total: number;
	hasMore: boolean;
}

export class ProjectDataManager {
	// Get project file list
	async getFileList(): Promise<string[]> {
		const result: string[] = [];
		const maxFiles = 500;
		const rootDir = process.cwd();
		const ignoreDirs = new Set([
			'node_modules',
			'dist',
			'build',
			'coverage',
			'.git',
			'.vscode',
			'.idea',
			'bin',
			'obj',
			'target',
		]);

		const walk = async (dir: string): Promise<void> => {
			if (result.length >= maxFiles) {
				return;
			}
			const entries = await fs.promises.readdir(dir, {withFileTypes: true});
			for (const entry of entries) {
				if (result.length >= maxFiles) {
					return;
				}
				if (entry.name.startsWith('.') && entry.name !== '.snow') {
					continue;
				}
				if (ignoreDirs.has(entry.name)) {
					continue;
				}
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(fullPath);
					continue;
				}
				const relativePath = path
					.relative(rootDir, fullPath)
					.replace(/\\/g, '/');
				result.push(
					relativePath.startsWith('.') ? relativePath : `./${relativePath}`,
				);
			}
		};

		await walk(rootDir);
		return result;
	}

	// Get project session list
	async getSessionList(
		page = 0,
		pageSize = 20,
		searchQuery = '',
	): Promise<SessionListResult> {
		const {sessionManager} = await import('../session/sessionManager.js');
		const safePage = Math.max(0, Number.isFinite(page) ? page : 0);
		const safePageSize = Math.min(
			100,
			Math.max(1, Number.isFinite(pageSize) ? pageSize : 20),
		);
		const result = await sessionManager.listSessionsPaginated(
			safePage,
			safePageSize,
			searchQuery || '',
		);
		return {
			sessions: result.sessions.map(session => ({
				id: session.id,
				title: session.title,
				updatedAt: session.updatedAt,
				messageCount: session.messageCount,
			})),
			total: result.total,
			hasMore: result.hasMore,
		};
	}
}
