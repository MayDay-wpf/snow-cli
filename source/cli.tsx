#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import {execSync} from 'child_process';
import App from './app.js';

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
		console.error('❌ Update failed:', error instanceof Error ? error.message : error);
		process.exit(1);
	}
}

// Disable bracketed paste mode on startup
process.stdout.write('\x1b[?2004l');

// Re-enable on exit to avoid polluting parent shell
const cleanup = () => {
	process.stdout.write('\x1b[?2004l');
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
