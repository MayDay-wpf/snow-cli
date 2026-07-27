/**
 * Plan Mode acceptance checks (build + IDE diagnostics).
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ACCEPTANCE_OUTPUT = 4000;

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type PlanAcceptanceSettings = {
	/** Explicit acceptance commands (run in order; any failure fails). */
	commands?: string[];
	/** Default true. When false, skip build/command acceptance. */
	runBuild?: boolean;
	/** Default true. When false, skip IDE diagnostics. */
	runDiagnostics?: boolean;
	/**
	 * Preferred package manager when package.json has a build script but no
	 * lockfile is present. Lockfiles always take precedence.
	 */
	preferPackageManager?: PackageManager;
	/**
	 * Optional fallback commands used only when no build script / explicit
	 * commands are available. Not auto-filled with test/typecheck by default.
	 */
	fallbackCommands?: string[];
};

const PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

function truncate(text: string, max = MAX_ACCEPTANCE_OUTPUT): string {
	return text.length > max ? text.slice(0, max) + '\n... (truncated)' : text;
}

function isPackageManager(value: unknown): value is PackageManager {
	return (
		typeof value === 'string' && (PACKAGE_MANAGERS as string[]).includes(value)
	);
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve package manager from lockfiles; fall back to settings preference,
 * then npm.
 */
export async function detectPackageManager(
	cwd: string,
	preferPackageManager?: PackageManager,
): Promise<PackageManager> {
	const lockfileChecks: Array<{pm: PackageManager; files: string[]}> = [
		{pm: 'pnpm', files: ['pnpm-lock.yaml']},
		{pm: 'yarn', files: ['yarn.lock']},
		{pm: 'bun', files: ['bun.lockb', 'bun.lock']},
		{pm: 'npm', files: ['package-lock.json']},
	];

	for (const {pm, files} of lockfileChecks) {
		for (const file of files) {
			if (await fileExists(path.join(cwd, file))) {
				return pm;
			}
		}
	}

	if (isPackageManager(preferPackageManager)) {
		return preferPackageManager;
	}

	return 'npm';
}

function buildCommandFor(pm: PackageManager): string {
	switch (pm) {
		case 'pnpm':
			return 'pnpm run build';
		case 'yarn':
			return 'yarn run build';
		case 'bun':
			return 'bun run build';
		case 'npm':
		default:
			return 'npm run build';
	}
}

/**
 * Detect a default build command for Node projects with scripts.build.
 * Returns null when there is no package.json or no build script (skip-not-fail).
 */
export async function detectDefaultBuildCommand(
	cwd: string,
	settings?: Pick<PlanAcceptanceSettings, 'preferPackageManager'>,
): Promise<string | null> {
	try {
		const pkgRaw = await fs.readFile(path.join(cwd, 'package.json'), 'utf8');
		const pkg = JSON.parse(pkgRaw);
		if (typeof pkg?.scripts?.build === 'string') {
			const pm = await detectPackageManager(
				cwd,
				settings?.preferPackageManager,
			);
			return buildCommandFor(pm);
		}
	} catch {
		// no package.json or invalid JSON
	}
	return null;
}

/**
 * Soft non-Node project markers: do not auto-run cargo/go/python builds.
 * Returns a skip message when a marker is present, else null.
 */
export async function detectNonNodeSkipMessage(
	cwd: string,
): Promise<string | null> {
	const markers: Array<{file: string; label: string}> = [
		{file: 'Cargo.toml', label: 'Cargo.toml'},
		{file: 'go.mod', label: 'go.mod'},
		{file: 'pyproject.toml', label: 'pyproject.toml'},
	];

	for (const {file, label} of markers) {
		if (await fileExists(path.join(cwd, file))) {
			return (
				`build: no build script (${label} present), skipped` +
				' (set planAcceptance.commands to configure)'
			);
		}
	}
	return null;
}

function isErrorSeverity(severity: unknown): boolean {
	if (severity === 1 || severity === '1') return true;
	if (typeof severity === 'string' && severity.toLowerCase() === 'error') {
		return true;
	}
	return false;
}

function countErrorsInArray(items: unknown[]): number {
	let count = 0;
	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		const sev =
			(item as {severity?: unknown; Severity?: unknown}).severity ??
			(item as {Severity?: unknown}).Severity;
		if (isErrorSeverity(sev)) count += 1;
	}
	return count;
}

/**
 * Count diagnostic errors from structured JSON or text.
 * Accepts severity values: "error" | "Error" | 1 | "1".
 * Falls back to regex when structured parse fails.
 */
export function countDiagnosticErrors(diag: unknown): number {
	if (diag == null) return 0;

	if (typeof diag === 'string') {
		const trimmed = diag.trim();
		if (
			(trimmed.startsWith('{') || trimmed.startsWith('[')) &&
			trimmed.length > 1
		) {
			try {
				return countDiagnosticErrors(JSON.parse(trimmed));
			} catch {
				// fall through to regex
			}
		}
		return (diag.match(/"severity"\s*:\s*"?(error|1)"?/gi) || []).length;
	}

	if (Array.isArray(diag)) {
		return countErrorsInArray(diag);
	}

	if (typeof diag === 'object') {
		const obj = diag as Record<string, unknown>;
		if (Array.isArray(obj['diagnostics'])) {
			return countErrorsInArray(obj['diagnostics'] as unknown[]);
		}
		if (Array.isArray(obj['items'])) {
			return countErrorsInArray(obj['items'] as unknown[]);
		}
		if ('severity' in obj || 'Severity' in obj) {
			return isErrorSeverity(obj['severity'] ?? obj['Severity']) ? 1 : 0;
		}

		// Last resort: stringify and regex (covers nested shapes)
		try {
			const text = JSON.stringify(diag);
			return (text.match(/"severity"\s*:\s*"?(error|1)"?/gi) || []).length;
		} catch {
			return 0;
		}
	}

	return 0;
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
			const detected = await detectDefaultBuildCommand(cwd, settings);
			if (detected) {
				commands = [detected];
			} else if (
				Array.isArray(settings?.fallbackCommands) &&
				settings.fallbackCommands.length > 0
			) {
				commands = settings.fallbackCommands.filter(
					c => typeof c === 'string' && c.trim(),
				);
			} else {
				const nonNodeMsg = await detectNonNodeSkipMessage(cwd);
				parts.push(nonNodeMsg ?? 'build: no build script, skipped');
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
			const diag = await executeMCPTool('ide-get_diagnostics', {}, abortSignal);
			const diagText =
				typeof diag === 'string' ? diag : JSON.stringify(diag ?? '');
			const errorCount = countDiagnosticErrors(diag);
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
