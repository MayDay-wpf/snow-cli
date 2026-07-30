/**
 * Plan Mode acceptance checks (build + IDE diagnostics).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {PlanPhaseCheck} from './planDocument.js';
import {validatePlanCheckCommand} from './planCommandPolicy.js';

export {validatePlanCheckCommand} from './planCommandPolicy.js';

const MAX_ACCEPTANCE_OUTPUT = 4000;

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export type PlanAcceptanceSettings = {
	/** Explicit acceptance commands (run in order; any failure fails). */
	commands?: string[];
	/** Default true. When false, skip build/command acceptance. */
	runBuild?: boolean;
	/** Default true. When false, skip IDE diagnostics. */
	runDiagnostics?: boolean;
	/** Strict mode turns unavailable enabled checks into failures. */
	policy?: 'standard' | 'strict';
	/** Optional command-prefix allowlist for configured and phase commands. */
	allowedCommandPrefixes?: string[];
	/** Per-command timeout, clamped by settings normalization. */
	commandTimeoutMs?: number;
	/** Internal: enforce the restricted phase-check command policy. */
	enforceCommandPolicy?: boolean;
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

export type PlanAcceptanceDetail = {
	type: 'command' | 'diagnostics' | 'build' | 'manual';
	status: 'passed' | 'failed' | 'skipped';
	durationMs: number;
	command?: string;
	exitCode?: number;
	message?: string;
};

export type PlanAcceptanceResult = {
	ok: boolean;
	output: string;
	details: PlanAcceptanceDetail[];
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
		case 'pnpm': {
			return 'pnpm run build';
		}

		case 'yarn': {
			return 'yarn run build';
		}

		case 'bun': {
			return 'bun run build';
		}

		case 'npm':
		default: {
			return 'npm run build';
		}
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
		// No package.json or invalid JSON
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
				// Fall through to regex
			}
		}

		return (diag.match(/"severity"\s*:\s*"?(error|1)"?/gi) || []).length;
	}

	if (Array.isArray(diag)) {
		return countErrorsInArray(diag);
	}

	if (typeof diag === 'object') {
		const object = diag as Record<string, unknown>;
		if (Array.isArray(object['diagnostics'])) {
			return countErrorsInArray(object['diagnostics'] as unknown[]);
		}

		if (Array.isArray(object['items'])) {
			return countErrorsInArray(object['items'] as unknown[]);
		}

		if ('severity' in object || 'Severity' in object) {
			return isErrorSeverity(object['severity'] ?? object['Severity']) ? 1 : 0;
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
): Promise<PlanAcceptanceResult> {
	const parts: string[] = [];
	const details: PlanAcceptanceDetail[] = [];
	const runBuild = settings?.runBuild !== false;
	const runDiagnostics = settings?.runDiagnostics !== false;
	const strict = settings?.policy === 'strict';

	if (abortSignal?.aborted) {
		return {ok: false, output: 'aborted', details};
	}

	if (runBuild) {
		let commands: string[] =
			Array.isArray(settings?.commands) && settings!.commands.length > 0
				? settings!.commands.filter(c => typeof c === 'string' && c.trim())
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
				const nonNodeMessage = await detectNonNodeSkipMessage(cwd);
				const message = nonNodeMessage ?? 'build: no build script, skipped';
				details.push({
					type: 'build',
					status: 'skipped',
					durationMs: 0,
					message,
				});
				if (strict) {
					return {
						ok: false,
						output: `strict acceptance FAILED: ${message}`,
						details,
					};
				}

				parts.push(message);
			}
		}

		for (const command of commands) {
			if (abortSignal?.aborted) {
				return {ok: false, output: 'aborted', details};
			}

			const policyError = settings?.enforceCommandPolicy
				? validatePlanCheckCommand(command, settings)
				: null;
			if (policyError) {
				details.push({
					type: 'command',
					status: 'failed',
					durationMs: 0,
					command,
					message: policyError,
				});
				return {
					ok: false,
					output: `command policy FAILED (${command}): ${policyError}`,
					details,
				};
			}

			const started = Date.now();
			try {
				const {TerminalCommandService} = await import('../../mcp/bash.js');
				const terminal = new TerminalCommandService(cwd);
				const result = await terminal.executeCommand(
					command,
					settings?.commandTimeoutMs ?? 300_000,
					abortSignal,
				);
				const {exitCode} = result;
				const output = [result.stdout, result.stderr]
					.filter(Boolean)
					.join('\n');
				if (typeof exitCode === 'number' && exitCode !== 0) {
					details.push({
						type: 'command',
						status: 'failed',
						durationMs: Date.now() - started,
						command,
						exitCode,
						message: truncate(output, 1000),
					});
					return {
						ok: false,
						output: `build FAILED (${command}, exit ${exitCode}):\n${truncate(
							output,
						)}`,
						details,
					};
				}

				details.push({
					type: 'command',
					status: 'passed',
					durationMs: Date.now() - started,
					command,
					exitCode: typeof exitCode === 'number' ? exitCode : 0,
				});
				parts.push(`build: passed (${command})`);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				details.push({
					type: 'command',
					status: 'failed',
					durationMs: Date.now() - started,
					command,
					message,
				});
				return {
					ok: false,
					output: `build FAILED (${command}): ${message}`,
					details,
				};
			}
		}
	} else {
		parts.push('build: skipped by settings');
		details.push({
			type: 'build',
			status: 'skipped',
			durationMs: 0,
			message: 'disabled by settings',
		});
	}

	if (abortSignal?.aborted) {
		return {ok: false, output: 'aborted', details};
	}

	if (runDiagnostics) {
		const started = Date.now();
		try {
			const {executeMCPTool} = await import('./mcpToolsManager.js');
			const diag = await executeMCPTool('ide-get_diagnostics', {}, abortSignal);
			const diagText =
				typeof diag === 'string' ? diag : JSON.stringify(diag ?? '');
			const errorCount = countDiagnosticErrors(diag);
			if (errorCount > 0) {
				details.push({
					type: 'diagnostics',
					status: 'failed',
					durationMs: Date.now() - started,
					message: `${errorCount} errors`,
				});
				return {
					ok: false,
					output: `${parts.join(
						'; ',
					)}; diagnostics FAILED (${errorCount} errors):\n${truncate(
						diagText,
					)}`,
					details,
				};
			}

			details.push({
				type: 'diagnostics',
				status: 'passed',
				durationMs: Date.now() - started,
				message: 'no errors',
			});
			parts.push('diagnostics: no errors');
		} catch (error) {
			const message = 'IDE not connected';
			details.push({
				type: 'diagnostics',
				status: strict ? 'failed' : 'skipped',
				durationMs: Date.now() - started,
				message,
			});
			if (strict) {
				return {
					ok: false,
					output: `strict acceptance FAILED: diagnostics unavailable (${String(
						error,
					)})`,
					details,
				};
			}

			parts.push('diagnostics: IDE not connected, skipped');
		}
	} else {
		parts.push('diagnostics: skipped by settings');
		details.push({
			type: 'diagnostics',
			status: 'skipped',
			durationMs: 0,
			message: 'disabled by settings',
		});
	}

	return {ok: true, output: parts.join('; '), details};
}

/** Execute checks declared by one plan phase before global acceptance. */
export async function runPhaseChecks(
	cwd: string,
	checks: PlanPhaseCheck[],
	manualConfirmations: string[] = [],
	abortSignal?: AbortSignal,
	settings?: PlanAcceptanceSettings,
): Promise<PlanAcceptanceResult> {
	if (checks.length === 0) {
		return {ok: true, output: 'phase checks: none declared', details: []};
	}

	const confirmed = new Set(manualConfirmations.map(value => value.trim()));
	const missingManual = checks
		.filter(
			(check): check is Extract<PlanPhaseCheck, {type: 'manual'}> =>
				check.type === 'manual',
		)
		.map(check => check.description)
		.filter(description => !confirmed.has(description));
	if (missingManual.length > 0) {
		return {
			ok: false,
			output:
				'manual checks not confirmed: ' +
				missingManual.map(description => `"${description}"`).join(', '),
			details: missingManual.map(description => ({
				type: 'manual' as const,
				status: 'failed' as const,
				durationMs: 0,
				message: description,
			})),
		};
	}

	const commands = checks
		.filter(
			(check): check is Extract<PlanPhaseCheck, {type: 'command'}> =>
				check.type === 'command',
		)
		.map(check => check.command);
	const runDiagnostics = checks.some(check => check.type === 'diagnostics');
	const automated =
		commands.length > 0 || runDiagnostics
			? await runAcceptance(cwd, abortSignal, {
					...settings,
					commands,
					runBuild: commands.length > 0,
					runDiagnostics,
					enforceCommandPolicy: true,
			  })
			: {ok: true, output: 'automated checks: none', details: []};
	if (!automated.ok) return automated;

	const manualCount = checks.filter(check => check.type === 'manual').length;
	return {
		ok: true,
		output: `${automated.output}; manual checks confirmed: ${manualCount}`,
		details: [
			...automated.details,
			...checks
				.filter(
					(check): check is Extract<PlanPhaseCheck, {type: 'manual'}> =>
						check.type === 'manual',
				)
				.map(check => ({
					type: 'manual' as const,
					status: 'passed' as const,
					durationMs: 0,
					message: check.description,
				})),
		],
	};
}
