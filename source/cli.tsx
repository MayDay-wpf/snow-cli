#!/usr/bin/env node

// Show loading indicator immediately before any imports
process.stdout.write('\x1b[?25l'); // Hide cursor
process.stdout.write('⠋ Loading...\r');

// Import only critical dependencies synchronously
import React from 'react';
import {render, Text, Box} from 'ink';
import Spinner from 'ink-spinner';
import meow from 'meow';
import {execSync} from 'child_process';

// Load heavy dependencies asynchronously
async function loadDependencies() {
	const [
		appModule,
		vscodeModule,
		resourceModule,
		configModule,
		processModule,
		devModeModule,
		childProcessModule,
		utilModule,
	] = await Promise.all([
		import('./app.js'),
		import('./utils/vscodeConnection.js'),
		import('./utils/resourceMonitor.js'),
		import('./utils/configManager.js'),
		import('./utils/processManager.js'),
		import('./utils/devMode.js'),
		import('child_process'),
		import('util'),
	]);

	return {
		App: appModule.default,
		vscodeConnection: vscodeModule.vscodeConnection,
		resourceMonitor: resourceModule.resourceMonitor,
		initializeProfiles: configModule.initializeProfiles,
		processManager: processModule.processManager,
		enableDevMode: devModeModule.enableDevMode,
		getDevUserId: devModeModule.getDevUserId,
		exec: childProcessModule.exec,
		promisify: utilModule.promisify,
	};
}

let execAsync: any;

// Check for updates asynchronously
async function checkForUpdates(currentVersion: string): Promise<void> {
	try {
		const {stdout} = await execAsync('npm view snow-ai version', {
			encoding: 'utf8',
		});
		const latestVersion = stdout.trim();

		if (latestVersion && latestVersion !== currentVersion) {
			console.log('\n🔔 Update available!');
			console.log(`   Current version: ${currentVersion}`);
			console.log(`   Latest version:  ${latestVersion}`);
			console.log('   Run "snow --update" to update\n');
		}
	} catch (error) {
		// Silently fail - don't interrupt user experience
	}
}

const cli = meow(
	`
Usage
  $ snow
  $ snow --ask "your prompt"

Options
		--help     Show help
		--version  Show version
		--update   Update to latest version
		-c         Skip welcome screen and resume last conversation
		--ask      Quick question mode (headless mode with single prompt)
		--dev      Enable developer mode with persistent userId for testing
`,
	{
		importMeta: import.meta,
		flags: {
			update: {
				type: 'boolean',
				default: false,
			},
			c: {
				type: 'boolean',
				default: false,
			},
			ask: {
				type: 'string',
			},
			dev: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

// Handle update flag
if (cli.flags.update) {
	console.log('🔄 Updating snow-ai to latest version...');
	try {
		execSync('npm install -g snow-ai@latest', {stdio: 'inherit'});
		console.log('✅ Update completed successfully!');
		process.exit(0);
	} catch (error) {
		console.error(
			'❌ Update failed:',
			error instanceof Error ? error.message : error,
		);
		process.exit(1);
	}
}

// Dev mode and resource monitoring will be initialized in Startup component

// Startup component that shows loading spinner during update check
const Startup = ({
	version,
	skipWelcome,
	headlessPrompt,
	isDevMode,
}: {
	version: string | undefined;
	skipWelcome: boolean;
	headlessPrompt?: string;
	isDevMode: boolean;
}) => {
	const [appReady, setAppReady] = React.useState(false);
	const [AppComponent, setAppComponent] = React.useState<any>(null);

	React.useEffect(() => {
		let mounted = true;

		const init = async () => {
			// Load all dependencies in parallel
			const deps = await loadDependencies();
			
			// Setup execAsync for checkForUpdates
			execAsync = deps.promisify(deps.exec);

			// Initialize profiles system
			try {
				deps.initializeProfiles();
			} catch (error) {
				console.error('Failed to initialize profiles:', error);
			}

			// Handle dev mode
			if (isDevMode) {
				deps.enableDevMode();
				const userId = deps.getDevUserId();
				console.log('🔧 Developer mode enabled');
				console.log(`📝 Using persistent userId: ${userId}`);
				console.log(`📂 Stored in: ~/.snow/dev-user-id\n`);
			}

			// Start resource monitoring in development/debug mode
			if (process.env['NODE_ENV'] === 'development' || process.env['DEBUG']) {
				deps.resourceMonitor.startMonitoring(30000);
				setInterval(() => {
					const {hasLeak, reasons} = deps.resourceMonitor.checkForLeaks();
					if (hasLeak) {
						console.error('⚠️ Potential memory leak detected:');
						reasons.forEach((reason: string) => console.error(`  - ${reason}`));
					}
				}, 5 * 60 * 1000);
			}

			// Store for cleanup
			(global as any).__deps = deps;

			// Check for updates with timeout
			const updateCheckPromise = version
				? checkForUpdates(version)
				: Promise.resolve();

			// Race between update check and 3-second timeout
			await Promise.race([
				updateCheckPromise,
				new Promise(resolve => setTimeout(resolve, 3000)),
			]);

			if (mounted) {
				setAppComponent(() => deps.App);
				setAppReady(true);
			}
		};

		init();

		return () => {
			mounted = false;
		};
	}, [version, isDevMode]);

	if (!appReady || !AppComponent) {
		return (
			<Box flexDirection="column">
				<Box>
					<Text color="cyan">
						<Spinner type="dots" />
					</Text>
					<Text> Loading...</Text>
				</Box>
			</Box>
		);
	}

	return (
		<AppComponent
			version={version}
			skipWelcome={skipWelcome}
			headlessPrompt={headlessPrompt}
		/>
	);
};

// Disable bracketed paste mode on startup
process.stdout.write('\x1b[?2004l');
// Clear the early loading indicator and show cursor
process.stdout.write('\x1b[2K\r'); // Clear line
process.stdout.write('\x1b[?25h'); // Show cursor

// Re-enable on exit to avoid polluting parent shell
const cleanup = () => {
	process.stdout.write('\x1b[?2004l');
	// Cleanup loaded dependencies if available
	const deps = (global as any).__deps;
	if (deps) {
		// Kill all child processes first
		deps.processManager.killAll();
		// Stop resource monitoring
		deps.resourceMonitor.stopMonitoring();
		// Disconnect VSCode connection before exit
		deps.vscodeConnection.stop();
	}
};

process.on('exit', cleanup);
process.on('SIGINT', () => {
	cleanup();
	process.exit(0);
});
process.on('SIGTERM', () => {
	cleanup();
	process.exit(0);
});
render(
	<Startup
		version={cli.pkg.version}
		skipWelcome={cli.flags.c}
		headlessPrompt={cli.flags.ask}
		isDevMode={cli.flags.dev}
	/>,
	{
		exitOnCtrlC: false,
		patchConsole: true,
	},
);
