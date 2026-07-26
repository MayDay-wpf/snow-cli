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

/**
 * Default User-Agent for API requests when no custom headers are configured.
 * Claude-style product token: snow-cli/<version> (cli)
 * Version is always read from package.json (auto-updates with releases).
 */
export function getDefaultUserAgent(): string {
	return `snow-cli/${getPackageVersion()} (cli)`;
}

/**
 * Merge base request headers with optional custom headers.
 * When custom headers are empty/absent, inject User-Agent: snow-cli/<version> (cli).
 * Always attaches x-snow (custom headers may override it).
 */
export function mergeApiRequestHeaders(
	baseHeaders: Record<string, string>,
	customHeaders?: Record<string, string> | null,
): Record<string, string> {
	const custom = customHeaders ?? {};
	const hasCustom = Object.keys(custom).length > 0;

	return {
		...baseHeaders,
		'x-snow': getVersionHeader(),
		...(hasCustom ? custom : {'User-Agent': getDefaultUserAgent()}),
	};
}
