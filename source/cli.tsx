#!/usr/bin/env node

// Show loading indicator immediately before any imports
process.stdout.write('\x1b[?25l'); // Hide cursor
process.stdout.write('⠋ Loading...\r');

import React from 'react';
import {render, Text, Box} from 'ink';
import Spinner from 'ink-spinner';
import meow from 'meow';
import {exec, execSync} from 'child_process';
import {promisify} from 'util';
import App from './app.js';
import {vscodeConnection} from './utils/vscodeConnection.js';
import {resourceMonitor} from './utils/resourceMonitor.js';
import {initializeProfiles} from './utils/configManager.js';
import {processManager} from './utils/processManager.js';
import {enableDevMode, getDevUserId} from './utils/devMode.js';

const execAsync = promisify(exec);

// Check for updates asynchronously
async function checkForUpdates(currentVersion: string): Promise<void> {
	try {
		const {stdout} = await execAsync('npm view snow-ai version --registry https://registry.npmjs.org', {
			encoding: 'utf8',
		});
	const latestVersion = stdout.trim();

	// Simple string comparison - force registry fetch ensures no cache issues
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

// Handle dev mode flag
if (cli.flags.dev) {
	enableDevMode();
	const userId = getDevUserId();
	console.log('🔧 Developer mode enabled');
	console.log(`📝 Using persistent userId: ${userId}`);
	console.log(`📂 Stored in: ~/.snow/dev-user-id\n`);
}

// Start resource monitoring in development/debug mode
if (process.env['NODE_ENV'] === 'development' || process.env['DEBUG']) {
	resourceMonitor.startMonitoring(30000); // Monitor every 30 seconds

	// Check for leaks every 5 minutes
	setInterval(() => {
		const {hasLeak, reasons} = resourceMonitor.checkForLeaks();
		if (hasLeak) {
			console.error('⚠️ Potential memory leak detected:');
			reasons.forEach(reason => console.error(`  - ${reason}`));
		}
	}, 5 * 60 * 1000);
}

// Startup component that shows loading spinner during update check
const Startup = ({
	version,
	skipWelcome,
	headlessPrompt,
}: {
	version: string | undefined;
	skipWelcome: boolean;
	headlessPrompt?: string;
}) => {
	const [appReady, setAppReady] = React.useState(false);

	React.useEffect(() => {
		let mounted = true;

		const init = async () => {
			// Initialize profiles system first
			try {
				initializeProfiles();
			} catch (error) {
				console.error('Failed to initialize profiles:', error);
			}

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
				setAppReady(true);
			}
		};

		init();

		return () => {
			mounted = false;
		};
	}, [version]);

	if (!appReady) {
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
		<App
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
	// Kill all child processes first
	processManager.killAll();
	// Stop resource monitoring
	resourceMonitor.stopMonitoring();
	// Disconnect VSCode connection before exit
	vscodeConnection.stop();
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
	/>,
	{
		exitOnCtrlC: false,
		patchConsole: true,
	},
);
