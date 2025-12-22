import path from 'node:path';
import fs from 'node:fs';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

/**
 * Validate that .gitignore file exists in the project
 * @param workingDirectory - The root directory to check
 * @returns Object with isValid flag and optional error message
 */
export function validateGitignore(workingDirectory: string): {
	isValid: boolean;
	error?: string;
} {
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
