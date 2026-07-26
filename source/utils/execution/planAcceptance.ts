/**
 * Plan Mode acceptance checks (build + IDE diagnostics).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ACCEPTANCE_OUTPUT = 4000;

export type PlanAcceptanceSettings = {
	/** Explicit acceptance commands (run in order; any failure fails). */
	commands?: string[];
	/** Default true. When false, skip build/command acceptance. */
	runBuild?: boolean;
	/** Default true. When false, skip IDE diagnostics. */
	runDiagnostics?: boolean;
};

function truncate(text: string, max = MAX_ACCEPTANCE_OUTPUT): string {
	return text.length > max ? text.slice(0, max) + '\n... (truncated)' : text;
}

async function detectDefaultBuildCommand(cwd: string): Promise<string | null> {
	try {
		const pkgRaw = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
		const pkg = JSON.parse(pkgRaw);
		if (typeof pkg?.scripts?.build === 'string') {
			return 'npm run build';
		}
	} catch {
		// no package.json
	}
	return null;
}

/**
 * Code-level acceptance: run configured/build commands and check IDE diagnostics.
 * Missing build script / disconnected IDE are skipped, not failures.
 */
export async function runAcceptance(
	cwd: string,
	abortSignal?: AbortSignal,
	settings?: PlanAcceptanceSettings,
): Promise<{ok: boolean; output: string}> {
	const parts: string[] = [];
	const runBuild = settings?.runBuild !== false;
	const runDiagnostics = settings?.runDiagnostics !== false;

	if (abortSignal?.aborted) {
		return {ok: false, output: 'aborted'};
	}

	if (runBuild) {
		let commands: string[] =
			Array.isArray(settings?.commands) && settings!.commands!.length > 0
				? settings!.commands!.filter(c => typeof c === 'string' && c.trim())
				: [];

		if (commands.length === 0) {
			const detected = await detectDefaultBuildCommand(cwd);
			if (detected) {
				commands = [detected];
			} else {
				parts.push('build: no build script, skipped');
			}
		}

		for (const command of commands) {
			if (abortSignal?.aborted) {
				return {ok: false, output: 'aborted'};
			}
			try {
				const {terminalService} = await import('../../mcp/bash.js');
				const result = await terminalService.executeCommand(
					command,
					300000,
					abortSignal,
				);
				const exitCode = result.exitCode;
				const output = [result.stdout, result.stderr]
					.filter(Boolean)
					.join('\n');
				if (typeof exitCode === 'number' && exitCode !== 0) {
					return {
						ok: false,
						output: `build FAILED (${command}, exit ${exitCode}):\n${truncate(
							output,
						)}`,
					};
				}
				parts.push(`build: passed (${command})`);
			} catch (error) {
				return {
					ok: false,
					output: `build FAILED (${command}): ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
		}
	} else {
		parts.push('build: skipped by settings');
	}

	if (abortSignal?.aborted) {
		return {ok: false, output: 'aborted'};
	}

	if (runDiagnostics) {
		try {
			const {executeMCPTool} = await import('./mcpToolsManager.js');
			const diag = await executeMCPTool(
				'ide-get_diagnostics',
				{},
				abortSignal,
			);
			const diagText =
				typeof diag === 'string' ? diag : JSON.stringify(diag ?? '');
			const errorCount = (
				diagText.match(/"severity"\s*:\s*"?(error|1)"?/gi) || []
			).length;
			if (errorCount > 0) {
				return {
					ok: false,
					output: `${parts.join(
						'; ',
					)}; diagnostics FAILED (${errorCount} errors):\n${truncate(
						diagText,
					)}`,
				};
			}
			parts.push('diagnostics: no errors');
		} catch {
			parts.push('diagnostics: IDE not connected, skipped');
		}
	} else {
		parts.push('diagnostics: skipped by settings');
	}

	return {ok: true, output: parts.join('; ')};
}
