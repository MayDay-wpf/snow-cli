import {readFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

let cachedVersion = '';

function parsePackageVersion(content: string): string | undefined {
	const parsed: unknown = JSON.parse(content);
	if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
		return undefined;
	}

	const {version} = parsed as {version?: unknown};
	return typeof version === 'string' && version ? version : undefined;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
	return (
		error instanceof Error &&
		'code' in error &&
		(error as NodeJS.ErrnoException).code === 'ENOENT'
	);
}

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
		const candidates = [
			join(currentDir, '../package.json'),
			join(currentDir, '../../../package.json'),
		];
		for (const packageJsonPath of candidates) {
			try {
				const version = parsePackageVersion(
					readFileSync(packageJsonPath, 'utf8'),
				);
				if (version) {
					cachedVersion = version;
					return cachedVersion;
				}
			} catch (error: unknown) {
				if (!isMissingFile(error)) throw error;
			}
		}

		throw new Error(
			'package.json was not found from the source or bundle path',
		);
	} catch (error: unknown) {
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
	customHeaders?: Record<string, string> | undefined,
): Record<string, string> {
	const custom = customHeaders ?? {};
	const hasCustom = Object.keys(custom).length > 0;

	return {
		...baseHeaders,
		'x-snow': getVersionHeader(),
		...(hasCustom ? custom : {'User-Agent': getDefaultUserAgent()}),
	};
}
