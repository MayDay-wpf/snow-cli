import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import {splitCanonicalPath} from '../../../utils/core/canonicalPath.js';

/**
 * Attempt to fix common path issues when file is not found
 * Resolves AI hallucinations (e.g. redundant 'utils' segment, deep path errors)
 * using canonical path nodes without corrupting Windows drive letters.
 */
export async function tryFixPath(
	originalPath: string,
	basePath: string,
): Promise<string | null> {
	try {
		const {root, segments, isAbsolute} = splitCanonicalPath(originalPath);
		if (segments.length === 0) {
			return null;
		}

		const fileName = segments[segments.length - 1];

		// 1. Try removing 'utils' directory if present
		if (segments.includes('utils')) {
			const withoutUtils = segments.filter(s => s !== 'utils').join('/');
			const candidatePath = isAbsolute ? `${root}${withoutUtils}` : withoutUtils;
			const fixedPath = isAbsolute ? resolve(candidatePath) : resolve(basePath, candidatePath);
			try {
				await fs.access(fixedPath);
				return candidatePath;
			} catch {}
		}

		// 2. Try parent directories reduction (only on relative segments, keeping root intact)
		for (let i = 0; i < segments.length - 1; i++) {
			const reducedSegments = [
				...segments.slice(0, i),
				fileName,
			].join('/');
			const candidatePath = isAbsolute ? `${root}${reducedSegments}` : reducedSegments;
			const fixedPath = isAbsolute ? resolve(candidatePath) : resolve(basePath, candidatePath);
			try {
				await fs.access(fixedPath);
				return candidatePath;
			} catch {}
		}

		// 3. Try searching for the file by name in common source roots
		const commonDirs = ['source', 'src', 'lib', 'dist'];
		for (const dir of commonDirs) {
			const searchPath = `${dir}/${fileName}`;
			const fixedPath = resolve(basePath, searchPath);
			try {
				await fs.access(fixedPath);
				return searchPath;
			} catch {}
		}

		return null;
	} catch {
		return null;
	}
}

