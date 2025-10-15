#!/usr/bin/env node
import React from 'react';
import {render, Text, Box} from 'ink';
import Spinner from 'ink-spinner';
import meow from 'meow';
import {exec, execSync} from 'child_process';
import {promisify} from 'util';
import App from './app.js';
import {vscodeConnection} from './utils/vscodeConnection.js';

const execAsync = promisify(exec);

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

	Options
		--help     Show help
		--version  Show version
		--update   Update to latest version
`,
	{
		importMeta: import.meta,
		flags: {
			update: {
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

// Startup component that shows loading spinner during update check
const Startup = ({version}: {version: string | undefined}) => {
	const [appReady, setAppReady] = React.useState(false);

	React.useEffect(() => {
		let mounted = true;

		const init = async () => {
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
					<Text> Checking for updates...</Text>
				</Box>
			</Box>
		);
	}

	return <App version={version} />;
};

// Disable bracketed paste mode on startup
process.stdout.write('\x1b[?2004l');

// Re-enable on exit to avoid polluting parent shell
const cleanup = () => {
	process.stdout.write('\x1b[?2004l');
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

render(<Startup version={cli.pkg.version} />, {
	exitOnCtrlC: false,
	patchConsole: true,
});
