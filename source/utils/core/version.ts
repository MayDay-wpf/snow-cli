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
		// In bundled code, __filename points to bundle/cli.mjs
		// So we need to go up one level to reach package.json
		const currentDir = dirname(fileURLToPath(import.meta.url));
		const packageJsonPath = join(currentDir, '../package.json');
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
