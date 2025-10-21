/**
 * Browser detection utilities for web search
 */

import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {platform} from 'node:os';

/**
 * Detect system Chrome/Edge browser executable path
 * @returns Browser executable path or null if not found
 */
export function findBrowserExecutable(): string | null {
	const os = platform();
	const paths: string[] = [];

	if (os === 'win32') {
		// Windows: Prioritize Edge (built-in), then Chrome
		const edgePaths = [
			'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
			'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		];
		const chromePaths = [
			'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
			'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
			process.env['LOCALAPPDATA'] + '\\Google\\Chrome\\Application\\chrome.exe',
		];
		paths.push(...edgePaths, ...chromePaths);
	} else if (os === 'darwin') {
		// macOS
		paths.push(
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Chromium.app/Contents/MacOS/Chromium',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		);
	} else {
		// Linux
		const binPaths = [
			'google-chrome',
			'chromium',
			'chromium-browser',
			'microsoft-edge',
		];
		for (const bin of binPaths) {
			try {
				const path = execSync(`which ${bin}`, {encoding: 'utf8'}).trim();
				if (path) {
					return path;
				}
			} catch {
				// Continue to next binary
			}
		}
	}

	// Check if any path exists
	for (const path of paths) {
		if (path && existsSync(path)) {
			return path;
		}
	}

	return null;
}
