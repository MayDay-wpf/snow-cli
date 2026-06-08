import {spawnSync} from 'child_process';

const OFFICIAL_NPM_REGISTRY = 'https://registry.npmjs.org/';
const MANUAL_UPDATE_COMMANDS = [
	'npm uninstall -g snow-ai',
	'npm cache clean --force',
	'npm install -g snow-ai@latest',
];

type NpmStep = {
	label: string;
	args: string[];
};

function normalizeRegistry(registry: string): string {
	return registry.trim().replace(/\/+$/, '').toLowerCase();
}

function printManualUpdateHint(): void {
	console.log(
		`\nYou can also update manually:\n  ${MANUAL_UPDATE_COMMANDS.join('\n  ')}`,
	);
}

function getNpmRegistry(): string | null {
	const result = spawnSync('npm', ['config', 'get', 'registry'], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	if (
		result.error ||
		(typeof result.status === 'number' && result.status !== 0)
	) {
		console.warn(
			'Unable to check npm registry before updating. Continuing anyway.',
		);
		return null;
	}

	return result.stdout.trim();
}

function warnIfUsingMirrorRegistry(): void {
	const registry = getNpmRegistry();
	if (!registry) {
		return;
	}

	if (
		normalizeRegistry(registry) !== normalizeRegistry(OFFICIAL_NPM_REGISTRY)
	) {
		console.warn(
			`npm registry is currently set to ${registry}. Mirror registries may lag behind the official npm registry, so the latest snow-ai version might not be available immediately. The update will continue.\n`,
		);
	}
}

function runNpmStep(step: NpmStep): number {
	console.log(`\n${step.label}...`);
	const result = spawnSync('npm', step.args, {
		stdio: 'inherit',
	});

	if (result.error) {
		console.error(
			`\nUpdate failed while running: npm ${step.args.join(' ')}`,
			result.error instanceof Error
				? result.error.message
				: String(result.error),
		);
		return 1;
	}

	if (typeof result.status === 'number' && result.status !== 0) {
		console.error(
			`\nUpdate failed while running: npm ${step.args.join(
				' ',
			)} exited with code ${result.status}`,
		);
		return result.status;
	}

	return 0;
}

/**
 * Trigger an in-place global update of snow-ai.
 *
 * Steps:
 * 1. Unmount Ink so the React tree releases stdin/raw mode and the terminal
 *    is back to a normal scrollback state.
 * 2. Check whether npm uses a mirror registry and warn about possible delay.
 * 3. Uninstall the current global snow-ai package.
 * 4. Clean npm cache.
 * 5. Install snow-ai@latest globally with the same npm executable.
 * 6. Exit the CLI with the npm exit code (0 on success, otherwise non-zero).
 *
 * The function never returns: the process is terminated via process.exit().
 */
export function runUpdateAndExit(): never {
	// Best-effort: unmount Ink before handing the terminal to npm.
	try {
		const mainInk = (global as any).__mainInk;
		if (mainInk && typeof mainInk.unmount === 'function') {
			mainInk.unmount();
		}
	} catch {
		// Ignore unmount errors — already unmounted or in bad state.
	}

	// Restore cursor visibility / disable bracketed paste mode just in case
	// Ink's unmount path didn't run far enough.
	try {
		process.stdout.write('\x1b[?2004l');
		process.stdout.write('\x1b[?25h');
		process.stdout.write('\x1b[0 q');
	} catch {
		// Best-effort terminal restore
	}

	console.log('\nUpdating snow-ai to the latest version...\n');
	warnIfUsingMirrorRegistry();

	const updateSteps: NpmStep[] = [
		{
			label: 'Uninstalling current snow-ai',
			args: ['uninstall', '-g', 'snow-ai'],
		},
		{
			label: 'Cleaning npm cache',
			args: ['cache', 'clean', '--force'],
		},
		{
			label: 'Installing latest snow-ai',
			args: ['install', '-g', 'snow-ai@latest'],
		},
	];

	let exitCode = 0;
	try {
		for (const step of updateSteps) {
			exitCode = runNpmStep(step);
			if (exitCode !== 0) {
				printManualUpdateHint();
				break;
			}
		}

		if (exitCode === 0) {
			console.log('\nUpdate completed successfully.');
		}
	} catch (error) {
		console.error(
			'\nUpdate failed:',
			error instanceof Error ? error.message : String(error),
		);
		printManualUpdateHint();
		exitCode = 1;
	}

	// On a successful update, seamlessly relaunch `snow` so the user lands
	// back in the freshly-installed CLI without having to retype anything.
	// We block on the child via spawnSync (stdio inherited) so signals, TTY
	// and exit codes all flow through naturally; when the new snow exits,
	// this process exits with the same status.
	if (exitCode === 0) {
		console.log('\nRestarting snow with the new version...\n');
		try {
			const restart = spawnSync('snow', [], {
				stdio: 'inherit',
				shell: true,
			});

			if (restart.error) {
				console.error(
					'\nFailed to restart snow automatically:',
					restart.error instanceof Error
						? restart.error.message
						: String(restart.error),
				);
				console.log('You can start it manually by running: snow');
				process.exit(0);
			}

			process.exit(typeof restart.status === 'number' ? restart.status : 0);
		} catch (error) {
			console.error(
				'\nFailed to restart snow automatically:',
				error instanceof Error ? error.message : String(error),
			);
			console.log('You can start it manually by running: snow');
			process.exit(0);
		}
	}

	process.exit(exitCode);
}
