import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

/**
 * Check if the target directory is the user's home directory or filesystem root.
 */
export function isHomeOrRootDirectory(dirPath: string): boolean {
	try {
		const resolved = path.resolve(dirPath);
		const home = path.resolve(os.homedir());
		const isWin = process.platform === 'win32';

		const compareEqual = (a: string, b: string) =>
			isWin ? a.toLowerCase() === b.toLowerCase() : a === b;

		if (compareEqual(resolved, home)) {
			return true;
		}

		// POSIX & symlink protection: resolve actual canonical physical paths
		try {
			const realResolved = fs.realpathSync.native(resolved);
			const realHome = fs.realpathSync.native(home);
			if (compareEqual(realResolved, realHome)) {
				return true;
			}
		} catch {
			// Ignore filesystem resolution failures for virtual or unmounted paths
		}

		const root = path.parse(resolved).root;

		// Guard against multi-user root directories (e.g. C:\Users, /home, /Users)
		const usersParent = path.dirname(home);
		if (
			usersParent &&
			usersParent !== home &&
			!compareEqual(usersParent, root) &&
			compareEqual(resolved, usersParent)
		) {
			return true;
		}

		if (
			compareEqual(resolved, root) ||
			compareEqual(path.dirname(resolved), resolved)
		) {
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

/**
 * Validate that .gitignore file exists in the project
 * @param workingDirectory - The root directory to check
 * @returns Object with isValid flag and optional error message
 */
export function validateGitignore(workingDirectory: string): {
	isValid: boolean;
	isHomeOrRoot?: boolean;
	error?: string;
} {
	if (isHomeOrRootDirectory(workingDirectory)) {
		return {
			isValid: false,
			isHomeOrRoot: true,
			error: 'Codebase indexing skipped: working directory is user home or filesystem root',
		};
	}

	const gitignorePath = path.join(workingDirectory, '.gitignore');

	if (!fs.existsSync(gitignorePath)) {
		const currentLanguage = getCurrentLanguage();
		const t = translations[currentLanguage];

		return {
			isValid: false,
			error: t.codebaseConfig.gitignoreNotFound,
		};
	}

	return {isValid: true};
}
