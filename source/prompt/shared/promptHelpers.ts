/**
 * Shared helper functions for system prompt generation
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {loadCodebaseConfig} from '../../utils/config/codebaseConfig.js';
import {readSettings} from '../../utils/config/unifiedSettings.js';

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
	const tryReadRole = (rolePath: string): string | null => {
		try {
			if (!fs.existsSync(rolePath)) return null;
			const content = fs.readFileSync(rolePath, 'utf-8').trim();
			return content || null;
		} catch {
			return null;
		}
	};

	const buildRoleOverride = (roleContent: string): string =>
		[
			'These are the rules emphasized by the user, which must be adhered to 100%:',
			roleContent,
		].join('\n');

	const applyRoleOverride = (roleContent: string): string =>
		basePrompt.replace(defaultRoleText, () => buildRoleOverride(roleContent));

	const getActiveRolePath = (location: 'project' | 'global'): string | null => {
		try {
			// ROLE.md / ROLE-<id>.md live in: project root (project scope) or ~/.snow (global scope).
			// activeRoleId is now stored in the unified settings.json (.snow/settings.json).
			const baseDir =
				location === 'project'
					? process.cwd()
					: path.join(os.homedir(), '.snow');

			const settings = readSettings(location);
			const activeRoleId = settings.role?.activeRoleId;

			if (!activeRoleId || activeRoleId === 'active') {
				return path.join(baseDir, 'ROLE.md');
			}
			return path.join(baseDir, `ROLE-${activeRoleId}.md`);
		} catch {
			return null;
		}
	};

	try {
		// Priority: Project active (via .snow/role.json) > Global active (via ~/.snow/role.json)
		const projectActivePath = getActiveRolePath('project');
		if (projectActivePath) {
			const roleContent = tryReadRole(projectActivePath);
			if (roleContent) {
				return applyRoleOverride(roleContent);
			}
		}

		const globalActivePath = getActiveRolePath('global');
		if (globalActivePath) {
			const roleContent = tryReadRole(globalActivePath);
			if (roleContent) {
				return applyRoleOverride(roleContent);
			}
		}
	} catch (error) {
		console.error('Failed to read ROLE configuration:', error);
	}

	return basePrompt;
}

/**
 * Detect if running in PowerShell environment on Windows
 * Returns: 'pwsh' for PowerShell 7+, 'powershell' for Windows PowerShell 5.x, null if not PowerShell
 */
export function detectWindowsPowerShell(): 'pwsh' | 'powershell' | null {
	const psModulePath = process.env['PSModulePath'] || '';
	if (!psModulePath) return null;

	// PowerShell Core (pwsh) typically has paths containing "PowerShell\7" or similar
	if (
		psModulePath.includes('PowerShell\\7') ||
		psModulePath.includes('powershell\\7')
	) {
		return 'pwsh';
	}

	// Windows PowerShell 5.x has WindowsPowerShell in path
	if (psModulePath.toLowerCase().includes('windowspowershell')) {
		return 'powershell';
	}

	// Has PSModulePath but can't determine version, assume PowerShell
	return 'powershell';
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
		const platformType = os.platform();

		// Helper to detect Unix shell from SHELL env
		const getUnixShell = (): string | null => {
			const shellPath = process.env['SHELL'] || '';
			const shellName = path.basename(shellPath).toLowerCase();
			if (shellName.includes('zsh')) return 'zsh';
			if (shellName.includes('bash')) return 'bash';
			if (shellName.includes('fish')) return 'fish';
			if (shellName.includes('pwsh')) return 'PowerShell';
			if (shellName.includes('sh')) return 'sh';
			return shellName || null;
		};

		if (platformType === 'win32') {
			// Check for Unix-like environments first (MSYS2, Git Bash, Cygwin)
			const msystem = process.env['MSYSTEM']; // MSYS2/Git Bash
			if (msystem) {
				const unixShell = getUnixShell();
				return unixShell || 'bash';
			}

			// Fallback to native Windows shell detection
			const psType = detectWindowsPowerShell();
			if (psType) {
				if (includePowerShellVersion) {
					return psType === 'pwsh' ? 'PowerShell 7.x' : 'PowerShell 5.x';
				}
				return 'PowerShell';
			}
			return 'cmd.exe';
		}

		// On Unix-like systems, use SHELL environment variable
		return getUnixShell() || 'shell';
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
export function getCurrentTimeInfo(): {date: string} {
	const now = new Date();
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return {date: `${year}-${month}-${day}`};
}

/**
 * Append system environment and time to prompt
 */
export function appendSystemContext(
	prompt: string,
	systemEnv: string,
	timeInfo: {date: string},
): string {
	return `${prompt}

System Environment:
${systemEnv}

Current Date: ${timeInfo.date}`;
}

/**
 * Read raw content of the active ROLE file IF it is marked as "override system prompt".
 * Priority: project > global. Returns null if no active role is marked as override
 * or if the role file is missing/empty.
 */
export function getOverrideRoleContent(): string | null {
	const tryReadRole = (rolePath: string): string | null => {
		try {
			if (!fs.existsSync(rolePath)) return null;
			const content = fs.readFileSync(rolePath, 'utf-8').trim();
			return content || null;
		} catch {
			return null;
		}
	};

	const resolveActiveOverride = (
		location: 'project' | 'global',
	): {path: string; isOverride: boolean} | null => {
		try {
			// Role metadata moved to unified settings.json (.snow/settings.json).
			const baseDir =
				location === 'project'
					? process.cwd()
					: path.join(os.homedir(), '.snow');

			const settings = readSettings(location);
			const roleSettings = settings.role ?? {};
			const activeRoleId = roleSettings.activeRoleId;
			const overrideRoleIds = roleSettings.overrideRoleIds || [];

			const resolvedActiveId =
				!activeRoleId || activeRoleId === 'active' ? 'active' : activeRoleId;
			const isOverride = overrideRoleIds.includes(resolvedActiveId);
			const filePath =
				resolvedActiveId === 'active'
					? path.join(baseDir, 'ROLE.md')
					: path.join(baseDir, `ROLE-${resolvedActiveId}.md`);
			return {path: filePath, isOverride};
		} catch {
			return null;
		}
	};

	try {
		const projectInfo = resolveActiveOverride('project');
		if (projectInfo && projectInfo.isOverride) {
			const content = tryReadRole(projectInfo.path);
			if (content) return content;
		}

		const globalInfo = resolveActiveOverride('global');
		if (globalInfo && globalInfo.isOverride) {
			const content = tryReadRole(globalInfo.path);
			if (content) return content;
		}
	} catch (error) {
		console.error('Failed to read override ROLE configuration:', error);
	}

	return null;
}

/**
 * Get the tool discovery section based on whether tool search is disabled
 */
export function getToolDiscoverySection(
	toolSearchDisabled: boolean,
	sections: {preloaded: string; progressive: string},
): string {
	return toolSearchDisabled ? sections.preloaded : sections.progressive;
}
