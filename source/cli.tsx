#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ snow

	Options
		--help     Show help
		--version  Show version
`,
	{
		importMeta: import.meta,
		flags: {},
	},
);

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
