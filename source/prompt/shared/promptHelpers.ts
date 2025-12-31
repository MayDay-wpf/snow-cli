/**
 * Shared helper functions for system prompt generation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {loadCodebaseConfig} from '../../utils/config/codebaseConfig.js';

/**
 * Get the system prompt with ROLE.md content if it exists
 * Priority: Project ROLE.md > Global ROLE.md > Default prompt
 * @param basePrompt - The base prompt template to modify
 * @param defaultRoleText - The default role text to replace (e.g., "You are Snow AI CLI")
 * @returns The prompt with ROLE.md content or original prompt
 */
export function getSystemPromptWithRole(
	basePrompt: string,
	defaultRoleText: string,
): string {
	try {
		const cwd = process.cwd();

		// First check project ROLE.md
		const projectRolePath = path.join(cwd, 'ROLE.md');
		if (fs.existsSync(projectRolePath)) {
			const roleContent = fs.readFileSync(projectRolePath, 'utf-8').trim();
			if (roleContent) {
				// Replace the default role description with project ROLE.md content
				return basePrompt.replace(defaultRoleText, roleContent);
			}
		}

		// If no project ROLE.md, check global ROLE.md
		const globalRolePath = path.join(os.homedir(), '.snow', 'ROLE.md');
		if (fs.existsSync(globalRolePath)) {
			const roleContent = fs.readFileSync(globalRolePath, 'utf-8').trim();
			if (roleContent) {
				// Replace the default role description with global ROLE.md content
				return basePrompt.replace(defaultRoleText, roleContent);
			}
		}
	} catch (error) {
		// If reading fails, fall back to default
		console.error('Failed to read ROLE.md:', error);
	}

	return basePrompt;
}

/**
 * Get PowerShell version
 */
function getPowerShellVersion(): string | null {
	try {
		const platformType = os.platform();
		if (platformType !== 'win32') return null;

		// Detect PowerShell version from shell path
		const shellPath = process.env['SHELL'] || process.env['ComSpec'] || '';
		const shellName = path.basename(shellPath).toLowerCase();

		// pwsh typically indicates PowerShell 7+
		if (shellName.includes('pwsh')) {
			return '7.x';
		}
		// powershell.exe is typically PowerShell 5.x
		if (shellName.includes('powershell')) {
			return '5.x';
		}

		return null;
	} catch (error) {
		return null;
	}
}

/**
 * Get system environment info
 * @param includePowerShellVersion - Whether to include PowerShell version detection
 */
export function getSystemEnvironmentInfo(
	includePowerShellVersion = false,
): string {
	const platform = (() => {
		const platformType = os.platform();
		switch (platformType) {
			case 'win32':
				return 'Windows';
			case 'darwin':
				return 'macOS';
			case 'linux':
				return 'Linux';
			default:
				return platformType;
		}
	})();

	const shell = (() => {
		const shellPath = process.env['SHELL'] || process.env['ComSpec'] || '';
		const shellName = path.basename(shellPath).toLowerCase();
		if (shellName.includes('cmd')) return 'cmd.exe';
		if (shellName.includes('powershell') || shellName.includes('pwsh')) {
			// Detect PowerShell version if requested
			if (includePowerShellVersion) {
				const psVersion = getPowerShellVersion();
				return psVersion ? `PowerShell ${psVersion}` : 'PowerShell';
			}
			return 'PowerShell';
		}
		if (shellName.includes('zsh')) return 'zsh';
		if (shellName.includes('bash')) return 'bash';
		if (shellName.includes('fish')) return 'fish';
		if (shellName.includes('sh')) return 'sh';
		return shellName || 'shell';
	})();

	const workingDirectory = process.cwd();

	return `Platform: ${platform}
Shell: ${shell}
Working Directory: ${workingDirectory}`;
}

/**
 * Check if codebase functionality is enabled
 */
export function isCodebaseEnabled(): boolean {
	try {
		const config = loadCodebaseConfig();
		return config.enabled;
	} catch (error) {
		return false;
	}
}

/**
 * Get current time information
 */
export function getCurrentTimeInfo(): {year: number; month: number} {
	const now = new Date();
	return {
		year: now.getFullYear(),
		month: now.getMonth() + 1, // getMonth() returns 0-11
	};
}

/**
 * Append system environment and time to prompt
 */
export function appendSystemContext(
	prompt: string,
	systemEnv: string,
	timeInfo: {year: number; month: number},
): string {
	return `${prompt}

## System Environment

${systemEnv}

## Current Time

Year: ${timeInfo.year}
Month: ${timeInfo.month}`;
}
