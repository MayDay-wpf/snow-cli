import {spawnSync} from 'child_process';
import path from 'path';
import {translations} from '../../i18n/translations.js';
import {getCurrentLanguage} from '../config/languageConfig.js';

const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org/';

type UpdateCheckCommandResult = {
	ok: boolean;
	stdout: string;
	stderr: string;
	status: number | null;
	error?: string;
};

type UpdateCheckMessages = (typeof translations)['en']['updateCheck'];

const ANSI_RESET = '\x1b[0m';
const ANSI_RED = '\x1b[31m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_DIM = '\x1b[2m';
const ANSI_BOLD = '\x1b[1m';

function colorize(text: string, color: string): string {
	return `${color}${text}${ANSI_RESET}`;
}

function info(text: string): string {
	return colorize(text, ANSI_CYAN);
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

function muted(text: string): string {
	return colorize(text, ANSI_DIM);
}

function heading(text: string): string {
	return colorize(text, `${ANSI_BOLD}${ANSI_CYAN}`);
}

function formatMessage(
	message: string,
	values: Record<string, string | number>,
): string {
	return message.replaceAll(/\{(\w+)\}/g, (match, key: string) => {
		const value = values[key];
		return value === undefined ? match : String(value);
	});
}

function normalizeNpmRegistry(registry: string): string {
	return registry.trim().replace(/\/+$/, '').toLowerCase();
}

function normalizeExecutablePath(executablePath: string): string {
	return path.normalize(executablePath.trim()).toLowerCase();
}

function splitCommandOutputLines(output: string): string[] {
	return output
		.split(/\r?\n/)
		.map(line => line.trim())
		.filter(line => line.length > 0);
}

function uniqueCommandOutputLines(output: string): string[] {
	const seen = new Set<string>();
	const lines: string[] = [];
	for (const line of splitCommandOutputLines(output)) {
		const normalized = normalizeExecutablePath(line);
		if (!seen.has(normalized)) {
			seen.add(normalized);
			lines.push(line);
		}
	}
	return lines;
}

function runUpdateCheckCommand(
	command: string,
	args: string[],
): UpdateCheckCommandResult {
	const result = spawnSync(command, args, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	return {
		ok: !result.error && result.status === 0,
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
		status: result.status,
		error: result.error
			? result.error instanceof Error
				? result.error.message
				: String(result.error)
			: undefined,
	};
}

function findExecutablesInPath(command: string): UpdateCheckCommandResult {
	if (process.platform === 'win32') {
		return runUpdateCheckCommand('where.exe', [command]);
	}

	return runUpdateCheckCommand('which', ['-a', command]);
}

function printUpdateCheckCommandFailure(
	t: UpdateCheckMessages,
	label: string,
	result: UpdateCheckCommandResult,
): void {
	console.log(error(formatMessage(t.failed, {label})));
	if (result.error) {
		console.log(error(formatMessage(t.error, {error: result.error})));
	}
	if (result.stderr) {
		console.log(error(formatMessage(t.stderr, {stderr: result.stderr})));
	}
	if (typeof result.status === 'number' && result.status !== 0) {
		console.log(error(formatMessage(t.exitCode, {code: result.status})));
	}
}

function printExecutableLocations(
	t: UpdateCheckMessages,
	label: string,
	locations: string[],
): void {
	if (locations.length === 0) {
		console.log(warning(`[!] ${formatMessage(t.notFoundInPath, {label})}`));
		return;
	}

	const primaryLocation = locations[0];
	if (!primaryLocation) {
		console.log(warning(`[!] ${formatMessage(t.notFoundInPath, {label})}`));
		return;
	}

	console.log(`${success('[OK]')} ${label}: ${info(primaryLocation)}`);
	if (locations.length > 1) {
		console.log(
			warning(`[!] ${formatMessage(t.allFoundInPath, {label}).trim()}`),
		);
		for (const location of locations) {
			console.log(muted(`  > ${location}`));
		}
	}
}

export function runUpdateCheckAndExit(currentVersion: string): never {
	const t = translations[getCurrentLanguage()].updateCheck;
	console.log(`${heading(`[i] ${t.checking}`)}\n`);

	let hasBlockingIssue = false;
	let hasWarning = false;

	const npmLocationsResult = findExecutablesInPath('npm');
	const npmLocations = npmLocationsResult.ok
		? uniqueCommandOutputLines(npmLocationsResult.stdout)
		: [];
	if (npmLocationsResult.ok) {
		printExecutableLocations(t, t.npmPath, npmLocations);
		if (npmLocations.length > 1) {
			hasWarning = true;
			console.log(warning(`[!] ${t.warningMultipleNpm.trim()}`));
		}
	} else {
		printUpdateCheckCommandFailure(t, t.npmPathLookup, npmLocationsResult);
		hasWarning = true;
	}

	const npmVersion = runUpdateCheckCommand('npm', ['--version']);
	if (npmVersion.ok) {
		console.log(`${success('[OK]')} ${t.npm}: ${info(npmVersion.stdout)}`);
	} else {
		printUpdateCheckCommandFailure(t, t.npm, npmVersion);
		console.log(`\n${error(`[x] ${t.cannotUpdateNpmUnavailable}`)}`);
		process.exit(1);
	}

	const npmPrefixGlobal = runUpdateCheckCommand('npm', ['prefix', '-g']);
	if (npmPrefixGlobal.ok && npmPrefixGlobal.stdout) {
		console.log(
			`${success('[OK]')} ${t.npmGlobalPrefix}: ${info(
				npmPrefixGlobal.stdout,
			)}`,
		);
	} else {
		printUpdateCheckCommandFailure(t, t.npmGlobalPrefix, npmPrefixGlobal);
		hasWarning = true;
	}

	const npmRootGlobal = runUpdateCheckCommand('npm', ['root', '-g']);
	if (npmRootGlobal.ok && npmRootGlobal.stdout) {
		console.log(
			`${success('[OK]')} ${t.npmGlobalRoot}: ${info(npmRootGlobal.stdout)}`,
		);
	} else {
		printUpdateCheckCommandFailure(t, t.npmGlobalRoot, npmRootGlobal);
		hasWarning = true;
	}

	const snowLocationsResult = findExecutablesInPath('snow');
	const snowLocations = snowLocationsResult.ok
		? uniqueCommandOutputLines(snowLocationsResult.stdout)
		: [];
	if (snowLocationsResult.ok) {
		printExecutableLocations(t, t.snowPath, snowLocations);
		if (snowLocations.length > 1) {
			hasWarning = true;
			console.log(warning(`[!] ${t.warningMultipleSnow.trim()}`));
		}
	} else {
		printUpdateCheckCommandFailure(t, t.snowPathLookup, snowLocationsResult);
		hasWarning = true;
	}

	if (
		npmPrefixGlobal.ok &&
		npmPrefixGlobal.stdout &&
		snowLocations.length > 0
	) {
		const normalizedGlobalPrefix = normalizeExecutablePath(
			npmPrefixGlobal.stdout,
		);
		const snowOutsideGlobalPrefix = snowLocations.some(
			location =>
				!normalizeExecutablePath(location).startsWith(normalizedGlobalPrefix),
		);
		if (snowOutsideGlobalPrefix) {
			hasWarning = true;
			console.log(warning(`[!] ${t.warningSnowOutsidePrefix.trim()}`));
		}
	}

	const globalSnowAi = runUpdateCheckCommand('npm', [
		'list',
		'-g',
		'snow-ai',
		'--depth=0',
	]);
	if (globalSnowAi.ok && globalSnowAi.stdout) {
		console.log(
			`${success('[OK]')} ${t.globalSnowAiPackageLabel.replace(/^[-\s]+/, '')}`,
		);
		for (const line of splitCommandOutputLines(globalSnowAi.stdout)) {
			console.log(muted(`  > ${line}`));
		}
	} else {
		printUpdateCheckCommandFailure(t, t.globalSnowAiPackage, globalSnowAi);
		hasWarning = true;
	}

	const registryResult = runUpdateCheckCommand('npm', [
		'config',
		'get',
		'registry',
	]);
	const configuredRegistry = registryResult.stdout;
	if (registryResult.ok && configuredRegistry) {
		console.log(
			`${success('[OK]')} ${t.npmRegistry}: ${info(configuredRegistry)}`,
		);
		if (
			normalizeNpmRegistry(configuredRegistry) !==
			normalizeNpmRegistry(OFFICIAL_NPM_REGISTRY)
		) {
			hasWarning = true;
			console.log(warning(`[!] ${t.warningNonOfficialRegistry.trim()}`));
		}
	} else {
		printUpdateCheckCommandFailure(t, t.npmRegistry, registryResult);
		hasWarning = true;
	}

	const officialLatest = runUpdateCheckCommand('npm', [
		'view',
		'snow-ai',
		'version',
		'--registry',
		OFFICIAL_NPM_REGISTRY,
	]);
	if (officialLatest.ok && officialLatest.stdout) {
		console.log(
			`${success('[OK]')} ${formatMessage(t.latestOfficialRegistry, {
				version: info(officialLatest.stdout),
			}).replace(/^[-\s]+/, '')}`,
		);
	} else {
		printUpdateCheckCommandFailure(t, t.officialLatestVersion, officialLatest);
		hasBlockingIssue = true;
	}

	if (
		registryResult.ok &&
		configuredRegistry &&
		normalizeNpmRegistry(configuredRegistry) !==
			normalizeNpmRegistry(OFFICIAL_NPM_REGISTRY)
	) {
		const configuredLatest = runUpdateCheckCommand('npm', [
			'view',
			'snow-ai',
			'version',
		]);
		if (configuredLatest.ok && configuredLatest.stdout) {
			console.log(
				`${success('[OK]')} ${formatMessage(t.latestConfiguredRegistry, {
					version: info(configuredLatest.stdout),
				}).replace(/^[-\s]+/, '')}`,
			);
			if (
				officialLatest.ok &&
				officialLatest.stdout &&
				configuredLatest.stdout !== officialLatest.stdout
			) {
				hasWarning = true;
				console.log(warning(`[!] ${t.warningRegistryLatestDiffers.trim()}`));
			}
		} else {
			printUpdateCheckCommandFailure(
				t,
				t.configuredLatestVersion,
				configuredLatest,
			);
			hasWarning = true;
		}
	}

	console.log(
		`${info('[i]')} ${formatMessage(t.currentSnowAi, {
			version: info(currentVersion),
		}).replace(/^[-\s]+/, '')}`,
	);

	if (hasBlockingIssue) {
		console.log(`\n${error(`[x] ${t.updateCheckFailed}`)}`);
		process.exit(1);
	}

	if (officialLatest.ok && officialLatest.stdout === currentVersion) {
		console.log(`\n${success(`[OK] ${t.alreadyUpToDate}`)}`);
		process.exit(0);
	}

	if (hasWarning) {
		console.log(`\n${warning(`[!] ${t.updatePossibleWithWarnings}`)}`);
		process.exit(0);
	}

	console.log(`\n${success(`[OK] ${t.environmentSuitable}`)}`);
	process.exit(0);
}
