import {existsSync, readFileSync} from 'fs';
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
		const packageJsonPath = [
			// Bundled code: bundle/cli.mjs -> ../package.json
			join(currentDir, '../package.json'),
			// Source code: source/utils/core/version.ts -> ../../../package.json
			join(currentDir, '../../../package.json'),
			// Test/dev runners may relocate modules while retaining the project cwd.
			join(process.cwd(), 'package.json'),
		].find(existsSync);
		if (!packageJsonPath) {
			throw new Error('package.json not found');
		}
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
		cachedVersion = packageJson.version || '1.0.0';
		return cachedVersion;
	} catch (error) {
		// Fallback version if reading fails
		console.error('Failed to read version from package.json:', error);
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
