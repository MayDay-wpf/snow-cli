import {readFileSync} from 'fs';
import {join, dirname} from 'path';
import {fileURLToPath} from 'url';

let cachedVersion: string = '';

/**
 * Get the current package version
 * Reads from package.json and caches the result
 * After bundling, all code is in bundle/cli.mjs, so we need to go up one level
 */
export function getPackageVersion(): string {
	if (cachedVersion) {
		return cachedVersion;
	}

	try {
		const currentDir = dirname(fileURLToPath(import.meta.url));
		const candidatePaths = [
			join(currentDir, '../package.json'),
			join(currentDir, '../../package.json'),
			join(currentDir, '../../../package.json'),
			join(process.cwd(), 'package.json'),
		];
		for (const p of candidatePaths) {
			try {
				const packageJson = JSON.parse(readFileSync(p, 'utf-8'));
				if (packageJson && packageJson.version) {
					cachedVersion = packageJson.version;
					return cachedVersion;
				}
			} catch {
				// try next candidate
			}
		}
		cachedVersion = '1.0.0';
		return cachedVersion;
	} catch {
		cachedVersion = '1.0.0';
		return cachedVersion;
	}
}

/**
 * Get version header value for API requests
 * Returns version in format: v1.0.0
 */
export function getVersionHeader(): string {
	return `v${getPackageVersion()}`;
}
