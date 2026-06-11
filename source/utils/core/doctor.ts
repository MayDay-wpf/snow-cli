import {spawnSync} from 'child_process';
import fs from 'fs';
import {createRequire} from 'module';
import os from 'os';
import path from 'path';
import {translations} from '../../i18n/translations.js';
import type {TranslationKeys} from '../../i18n/types.js';
import {getCurrentLanguage} from '../config/languageConfig.js';

const nodeRequire = createRequire(import.meta.url);

const ANSI_RESET = '\x1b[0m';
const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_DIM = '\x1b[2m';
const ANSI_BOLD = '\x1b[1m';

type DoctorStatus = 'ok' | 'warn' | 'fail' | 'info';

type DoctorCheck = {
	status: DoctorStatus;
	label: string;
	message: string;
	details?: string[];
};

type CommandResult = {
	ok: boolean;
	stdout: string;
	stderr: string;
	status: number | null;
	error?: string;
};

type PackageInfo = {
	version?: string;
	engines?: {
		node?: string;
		npm?: string;
	};
};

type RipgrepModule = {
	rgPath?: string;
};

type DoctorTranslations = TranslationKeys['doctor'];

const STATUS_ORDER: Record<DoctorStatus, number> = {
	fail: 0,
	warn: 1,
	ok: 2,
	info: 3,
};

function colorize(text: string, color: string): string {
	return `${color}${text}${ANSI_RESET}`;
}

function success(text: string): string {
	return colorize(text, ANSI_GREEN);
}

function warning(text: string): string {
	return colorize(text, ANSI_YELLOW);
}

function error(text: string): string {
	return colorize(text, ANSI_RED);
}

function info(text: string): string {
	return colorize(text, ANSI_CYAN);
}

function muted(text: string): string {
	return colorize(text, ANSI_DIM);
}

function heading(text: string): string {
	return colorize(text, `${ANSI_BOLD}${ANSI_CYAN}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getDoctorTranslations(): DoctorTranslations {
	return translations[getCurrentLanguage()].doctor;
}

function formatTemplate(
	template: string,
	values: Record<string, string | number>,
): string {
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		template,
	);
}

function formatExitCode(
	t: DoctorTranslations,
	status: number | null,
	withColon = true,
): string {
	return formatTemplate(withColon ? t.exitCodeColon : t.exitCode, {
		code: status ?? t.unknown,
	});
}

function commandFailureReason(
	result: CommandResult,
	t: DoctorTranslations,
): string {
	return (
		result.error || result.stderr || formatExitCode(t, result.status, false)
	);
}

function runCommand(command: string, args: string[]): CommandResult {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
		timeout: 5000,
	});

	return {
		ok: !result.error && result.status === 0,
		stdout: (result.stdout || '').trim(),
		stderr: (result.stderr || '').trim(),
		status: result.status,
		error: result.error
			? result.error instanceof Error
				? result.error.message
				: String(result.error)
			: undefined,
	};
}

function readJsonFile(filePath: string): {
	exists: boolean;
	value?: unknown;
	error?: string;
} {
	if (!fs.existsSync(filePath)) {
		return {exists: false};
	}

	try {
		const content = fs.readFileSync(filePath, 'utf8');
		if (!content.trim()) {
			return {exists: true, value: {}};
		}

		return {exists: true, value: JSON.parse(content)};
	} catch (parseError) {
		return {
			exists: true,
			error:
				parseError instanceof Error ? parseError.message : String(parseError),
		};
	}
}

function countJsonFiles(directoryPath: string): number {
	try {
		if (!fs.existsSync(directoryPath)) {
			return 0;
		}

		return fs
			.readdirSync(directoryPath)
			.filter(fileName => fileName.endsWith('.json')).length;
	} catch {
		return 0;
	}
}

function countMcpServers(settings: unknown): number {
	if (!isRecord(settings) || !isRecord(settings['mcpServers'])) {
		return 0;
	}

	return Object.keys(settings['mcpServers']).length;
}

function getActiveProfileName(snowDir: string): string {
	const activeProfileFile = path.join(snowDir, 'active-profile.json');
	const activeProfile = readJsonFile(activeProfileFile);

	if (
		isRecord(activeProfile.value) &&
		typeof activeProfile.value['activeProfile'] === 'string'
	) {
		return activeProfile.value['activeProfile'];
	}

	const legacyActiveProfileFile = path.join(snowDir, 'active-profile.txt');
	try {
		if (fs.existsSync(legacyActiveProfileFile)) {
			return (
				fs.readFileSync(legacyActiveProfileFile, 'utf8').trim() || 'default'
			);
		}
	} catch {}

	return 'default';
}

function extractNodeRequiredMajor(
	engine: string | undefined,
): number | undefined {
	if (!engine) {
		return undefined;
	}

	const match = />=\s*(\d+)/.exec(engine);
	if (!match?.[1]) {
		return undefined;
	}

	return Number.parseInt(match[1], 10);
}

function getCurrentNodeMajor(): number {
	return Number.parseInt(process.version.slice(1).split('.')[0] || '0', 10);
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (processError) {
		const code = (processError as NodeJS.ErrnoException).code;
		return code === 'EPERM';
	}
}

function getAliveSseDaemonCount(snowDir: string): {
	total: number;
	alive: number;
	stale: number;
} {
	const daemonDir = path.join(snowDir, 'sse-daemons');
	let total = 0;
	let alive = 0;
	let stale = 0;

	try {
		if (!fs.existsSync(daemonDir)) {
			return {total, alive, stale};
		}

		for (const fileName of fs.readdirSync(daemonDir)) {
			if (!fileName.endsWith('.pid')) {
				continue;
			}

			total++;
			const pidFile = readJsonFile(path.join(daemonDir, fileName));
			const pid = isRecord(pidFile.value) ? pidFile.value['pid'] : undefined;
			if (
				typeof pid === 'number' &&
				Number.isInteger(pid) &&
				isProcessAlive(pid)
			) {
				alive++;
			} else {
				stale++;
			}
		}
	} catch {
		return {total, alive, stale};
	}

	return {total, alive, stale};
}

function hasConfiguredApiKey(profileConfig: unknown): boolean {
	if (!isRecord(profileConfig) || !isRecord(profileConfig['snowcfg'])) {
		return false;
	}

	const apiKey = profileConfig['snowcfg']['apiKey'];
	return typeof apiKey === 'string' && apiKey.trim().length > 0;
}

function getPrivacySummary(
	globalSettings: unknown,
	projectSettings: unknown,
	t: DoctorTranslations,
): string {
	const projectPrivacy = isRecord(projectSettings)
		? projectSettings['privacy']
		: undefined;
	const globalPrivacy = isRecord(globalSettings)
		? globalSettings['privacy']
		: undefined;
	const effectivePrivacy = isRecord(projectPrivacy)
		? projectPrivacy
		: globalPrivacy;

	if (!isRecord(effectivePrivacy)) {
		return t.privacyNotConfigured;
	}

	const enabled = effectivePrivacy['enabled'] === true;
	const mode =
		typeof effectivePrivacy['mode'] === 'string'
			? effectivePrivacy['mode']
			: 'api';
	return `${enabled ? t.privacyEnabled : t.privacyDisabled} (${mode})`;
}

function statusLabel(status: DoctorStatus): string {
	switch (status) {
		case 'ok': {
			return success('[OK]');
		}

		case 'warn': {
			return warning('[!]');
		}

		case 'fail': {
			return error('[x]');
		}

		case 'info': {
			return info('[i]');
		}
	}
}

function printCheck(check: DoctorCheck): void {
	console.log(`${statusLabel(check.status)} ${check.label}: ${check.message}`);
	for (const detail of check.details ?? []) {
		console.log(muted(`  > ${detail}`));
	}
}

function addCommandCheck(
	checks: DoctorCheck[],
	command: string,
	args: string[],
	label: string,
	t: DoctorTranslations,
): void {
	const result = runCommand(command, args);
	if (result.ok) {
		checks.push({status: 'ok', label, message: result.stdout || t.available});
		return;
	}

	checks.push({
		status: 'warn',
		label,
		message: t.unavailableOrFailed,
		details: [
			result.error,
			result.stderr,
			result.status === null ? undefined : formatExitCode(t, result.status),
		].filter((detail): detail is string => Boolean(detail)),
	});
}

function getBundledRipgrepPath(t: DoctorTranslations): {
	path?: string;
	error?: string;
} {
	try {
		const ripgrep = nodeRequire('@vscode/ripgrep') as RipgrepModule;
		const rgPath = typeof ripgrep.rgPath === 'string' ? ripgrep.rgPath : '';
		if (rgPath.length === 0) {
			return {error: t.bundledRipgrepMissingPath};
		}

		return {path: rgPath};
	} catch (loadError) {
		return {
			error: loadError instanceof Error ? loadError.message : String(loadError),
		};
	}
}

function addRipgrepCheck(checks: DoctorCheck[], t: DoctorTranslations): void {
	const bundledRipgrep = getBundledRipgrepPath(t);
	if (bundledRipgrep.path) {
		const bundledResult = runCommand(bundledRipgrep.path, ['--version']);
		if (bundledResult.ok) {
			checks.push({
				status: 'ok',
				label: 'ripgrep',
				message: formatTemplate(t.bundledRipgrep, {
					version: bundledResult.stdout.split(/\r?\n/)[0] || t.available,
				}),
				details: [bundledRipgrep.path],
			});
			return;
		}

		const systemResult = runCommand('rg', ['--version']);
		if (systemResult.ok) {
			checks.push({
				status: 'ok',
				label: 'ripgrep',
				message: formatTemplate(t.systemRg, {
					version: systemResult.stdout.split(/\r?\n/)[0] || t.available,
				}),
				details: [
					formatTemplate(t.bundledRipgrepFailed, {
						reason: commandFailureReason(bundledResult, t),
					}),
				],
			});
			return;
		}

		checks.push({
			status: 'warn',
			label: 'ripgrep',
			message: t.bothRipgrepUnavailable,
			details: [
				formatTemplate(t.bundledPath, {path: bundledRipgrep.path}),
				formatTemplate(t.bundledError, {
					reason: commandFailureReason(bundledResult, t),
				}),
				formatTemplate(t.systemError, {
					reason: commandFailureReason(systemResult, t),
				}),
			],
		});
		return;
	}

	const systemResult = runCommand('rg', ['--version']);
	if (systemResult.ok) {
		checks.push({
			status: 'ok',
			label: 'ripgrep',
			message: formatTemplate(t.systemRg, {
				version: systemResult.stdout.split(/\r?\n/)[0] || t.available,
			}),
			details: bundledRipgrep.error
				? [
						formatTemplate(t.bundledRipgrepUnavailable, {
							reason: bundledRipgrep.error,
						}),
				  ]
				: undefined,
		});
		return;
	}

	checks.push({
		status: 'warn',
		label: 'ripgrep',
		message: t.unavailableOrFailed,
		details: [
			bundledRipgrep.error
				? formatTemplate(t.bundledRipgrep, {version: bundledRipgrep.error})
				: undefined,
			systemResult.error,
			systemResult.stderr,
			systemResult.status === null
				? undefined
				: formatExitCode(t, systemResult.status),
		].filter((detail): detail is string => Boolean(detail)),
	});
}

export function runDoctorAndExit(
	currentVersion: string,
	packageInfo: PackageInfo,
): never {
	const checks: DoctorCheck[] = [];
	const t = getDoctorTranslations();
	const snowDir = path.join(os.homedir(), '.snow');
	const projectSnowDir = path.join(process.cwd(), '.snow');
	const globalSettingsPath = path.join(snowDir, 'settings.json');
	const projectSettingsPath = path.join(projectSnowDir, 'settings.json');
	const profilesDir = path.join(snowDir, 'profiles');
	const tasksDir = path.join(snowDir, 'tasks');

	checks.push({
		status: 'info',
		label: 'Snow CLI',
		message: formatTemplate(t.version, {
			version: currentVersion || packageInfo.version || t.unknown,
		}),
	});

	const requiredNodeMajor = extractNodeRequiredMajor(packageInfo.engines?.node);
	const currentNodeMajor = getCurrentNodeMajor();
	checks.push({
		status:
			requiredNodeMajor && currentNodeMajor < requiredNodeMajor ? 'fail' : 'ok',
		label: 'Node.js',
		message: `${process.version}${
			packageInfo.engines?.node
				? formatTemplate(t.required, {version: packageInfo.engines.node})
				: ''
		}`,
	});

	addCommandCheck(checks, 'npm', ['--version'], 'npm', t);
	addCommandCheck(checks, 'git', ['--version'], 'git', t);
	addRipgrepCheck(checks, t);

	const npmRegistry = runCommand('npm', ['config', 'get', 'registry']);
	checks.push({
		status: npmRegistry.ok ? 'info' : 'warn',
		label: t.npmRegistry,
		message: npmRegistry.ok ? npmRegistry.stdout : t.readFailed,
		details: npmRegistry.ok
			? undefined
			: [npmRegistry.error, npmRegistry.stderr].filter(
					(detail): detail is string => Boolean(detail),
			  ),
	});

	checks.push({
		status: fs.existsSync(process.cwd()) ? 'ok' : 'fail',
		label: t.workingDirectory,
		message: process.cwd(),
	});

	const workspacePackagePath = path.join(process.cwd(), 'package.json');
	const workspacePackage = readJsonFile(workspacePackagePath);
	checks.push({
		status: workspacePackage.exists
			? workspacePackage.error
				? 'warn'
				: 'ok'
			: 'info',
		label: t.projectPackageJson,
		message: workspacePackage.exists
			? workspacePackage.error
				? t.parseFailed
				: t.found
			: t.notFoundInCurrentDirectory,
		details: workspacePackage.error
			? [workspacePackagePath, workspacePackage.error]
			: [workspacePackagePath],
	});

	if (fs.existsSync(snowDir)) {
		try {
			fs.accessSync(snowDir, fs.constants.R_OK | fs.constants.W_OK);
			checks.push({
				status: 'ok',
				label: t.userConfigDirectory,
				message: snowDir,
			});
		} catch (accessError) {
			checks.push({
				status: 'fail',
				label: t.userConfigDirectory,
				message: t.notReadableWritable,
				details: [
					snowDir,
					accessError instanceof Error
						? accessError.message
						: String(accessError),
				],
			});
		}
	} else {
		checks.push({
			status: 'warn',
			label: t.userConfigDirectory,
			message: t.userConfigDirectoryMissing,
			details: [snowDir],
		});
	}

	const globalSettings = readJsonFile(globalSettingsPath);
	checks.push({
		status: globalSettings.exists
			? globalSettings.error
				? 'fail'
				: 'ok'
			: 'warn',
		label: t.globalSettingsJson,
		message: globalSettings.exists
			? globalSettings.error
				? t.parseFailed
				: t.readable
			: t.notCreated,
		details: globalSettings.error
			? [globalSettingsPath, globalSettings.error]
			: [globalSettingsPath],
	});

	const projectSettings = readJsonFile(projectSettingsPath);
	checks.push({
		status: projectSettings.exists
			? projectSettings.error
				? 'fail'
				: 'ok'
			: 'info',
		label: t.projectSettingsJson,
		message: projectSettings.exists
			? projectSettings.error
				? t.parseFailed
				: t.readable
			: t.projectSettingsNotConfigured,
		details: projectSettings.error
			? [projectSettingsPath, projectSettings.error]
			: [projectSettingsPath],
	});

	const activeProfileName = getActiveProfileName(snowDir);
	const activeProfilePath = path.join(profilesDir, `${activeProfileName}.json`);
	const activeProfile = readJsonFile(activeProfilePath);
	checks.push({
		status: activeProfile.exists
			? activeProfile.error
				? 'fail'
				: 'ok'
			: 'warn',
		label: t.activeProfile,
		message: activeProfile.exists
			? activeProfileName
			: formatTemplate(t.profileMissing, {profile: activeProfileName}),
		details: activeProfile.error
			? [activeProfilePath, activeProfile.error]
			: [activeProfilePath],
	});

	checks.push({
		status: hasConfiguredApiKey(activeProfile.value) ? 'ok' : 'warn',
		label: 'API Key',
		message: hasConfiguredApiKey(activeProfile.value)
			? t.apiKeyConfigured
			: t.apiKeyMissing,
	});

	checks.push({
		status: fs.existsSync(profilesDir) ? 'ok' : 'warn',
		label: 'Profiles',
		message: formatTemplate(t.profileCount, {
			count: countJsonFiles(profilesDir),
		}),
		details: [profilesDir],
	});

	const globalMcpCount = countMcpServers(globalSettings.value);
	const projectMcpCount = countMcpServers(projectSettings.value);
	checks.push({
		status: globalMcpCount + projectMcpCount > 0 ? 'ok' : 'info',
		label: t.mcpServices,
		message: formatTemplate(t.mcpServerCount, {
			global: globalMcpCount,
			project: projectMcpCount,
		}),
	});

	checks.push({
		status: 'info',
		label: t.privacyFilter,
		message: getPrivacySummary(globalSettings.value, projectSettings.value, t),
	});

	checks.push({
		status: fs.existsSync(tasksDir) ? 'ok' : 'info',
		label: t.asyncTasks,
		message: formatTemplate(t.taskFileCount, {count: countJsonFiles(tasksDir)}),
		details: [tasksDir],
	});

	const sseDaemonStatus = getAliveSseDaemonCount(snowDir);
	checks.push({
		status: sseDaemonStatus.stale > 0 ? 'warn' : 'info',
		label: 'SSE daemon',
		message: formatTemplate(t.sseDaemonRecordCount, {
			total: sseDaemonStatus.total,
			alive: sseDaemonStatus.alive,
			stale: sseDaemonStatus.stale,
		}),
	});

	const nodeOptions = process.env['NODE_OPTIONS'];
	checks.push({
		status: nodeOptions ? 'warn' : 'ok',
		label: 'NODE_OPTIONS',
		message: nodeOptions ? t.nodeOptionsMayAffect : t.notSet,
		details: nodeOptions ? [nodeOptions] : undefined,
	});

	const proxyValues = [
		process.env['HTTPS_PROXY'] || process.env['https_proxy'],
		process.env['HTTP_PROXY'] || process.env['http_proxy'],
	].filter((value): value is string => Boolean(value));
	checks.push({
		status: proxyValues.length > 0 ? 'info' : 'ok',
		label: t.proxyEnvironmentVariables,
		message:
			proxyValues.length > 0
				? formatTemplate(t.setItemCount, {count: proxyValues.length})
				: t.notSet,
		details: proxyValues,
	});

	checks.sort(
		(left, right) => STATUS_ORDER[left.status] - STATUS_ORDER[right.status],
	);

	console.log(`${heading(t.title)}\n`);
	for (const check of checks) {
		printCheck(check);
	}

	const failedCount = checks.filter(check => check.status === 'fail').length;
	const warningCount = checks.filter(check => check.status === 'warn').length;
	const okCount = checks.filter(check => check.status === 'ok').length;
	const infoCount = checks.filter(check => check.status === 'info').length;

	console.log(
		`\n${heading(t.summary)}: ${success(
			formatTemplate(t.summaryOk, {count: okCount}),
		)}, ${warning(
			formatTemplate(t.summaryWarning, {count: warningCount}),
		)}, ${error(formatTemplate(t.summaryFailed, {count: failedCount}))}, ${info(
			formatTemplate(t.summaryInfo, {count: infoCount}),
		)}`,
	);

	if (failedCount > 0) {
		console.log(error(t.blockingIssues));
		process.exit(1);
	}

	if (warningCount > 0) {
		console.log(warning(t.completedWithWarnings));
		process.exit(0);
	}

	console.log(success(t.completedSuccessfully));
	process.exit(0);
}
