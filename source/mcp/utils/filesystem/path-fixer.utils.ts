import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';

/**
 * Attempt to fix common path issues when file is not found
 * @param originalPath - The original path that failed
 * @param basePath - Base path for resolving relative paths
 * @returns Fixed path or null if cannot be fixed
 */
export async function tryFixPath(
	originalPath: string,
	basePath: string,
): Promise<string | null> {
	try {
		// Common pattern: "source/mcp/utils/filesystem.ts" should be "source/mcp/filesystem.ts"
		// Remove unnecessary intermediate directories
		const segments = originalPath.split('/');

		// Try removing 'utils' directory if present
		if (segments.includes('utils')) {
			const withoutUtils = segments.filter(s => s !== 'utils').join('/');
			const fixedPath = resolve(basePath, withoutUtils);
			try {
				await fs.access(fixedPath);
				return withoutUtils;
			} catch {
				// Continue to next attempt
			}
		}

		// Try parent directories
		for (let i = 0; i < segments.length - 1; i++) {
			const reducedPath = [
				...segments.slice(0, i),
				segments[segments.length - 1],
			].join('/');
			const fixedPath = resolve(basePath, reducedPath);
			try {
				await fs.access(fixedPath);
				return reducedPath;
			} catch {
				// Continue to next attempt
			}
		}

		// Try searching for the file by name in common directories
		const fileName = segments[segments.length - 1];
		const commonDirs = ['source', 'src', 'lib', 'dist'];

		for (const dir of commonDirs) {
			const searchPath = `${dir}/${fileName}`;
			const fixedPath = resolve(basePath, searchPath);
			try {
				await fs.access(fixedPath);
				return searchPath;
			} catch {
				// Continue to next attempt
			}
		}

		return null;
	} catch {
		return null;
	}
}
