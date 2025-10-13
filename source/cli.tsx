#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import {execSync} from 'child_process';
import App from './app.js';
import {vscodeConnection} from './utils/vscodeConnection.js';

// Check for updates in the background
async function checkForUpdates(currentVersion: string) {
	try {
		const latestVersion = execSync('npm view snow-ai version', {
			encoding: 'utf8',
			stdio: ['pipe', 'pipe', 'ignore'],
		}).trim();

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

// Disable bracketed paste mode on startup
process.stdout.write('\x1b[?2004l');

// Check for updates in the background (non-blocking)
if (cli.pkg.version) {
	checkForUpdates(cli.pkg.version);
}

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

render(<App version={cli.pkg.version} />, {
	exitOnCtrlC: false,
	patchConsole: true,
});
