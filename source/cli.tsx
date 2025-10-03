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

render(<App version={cli.pkg.version} />, {
	exitOnCtrlC: false,
	patchConsole: true,
});
