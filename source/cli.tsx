#!/usr/bin/env node
import React from 'react';
import {render} from 'ink';
import meow from 'meow';
import App from './app.js';

const cli = meow(
	`
	Usage
	  $ aibot

	Options
		--help     Show help
		--version  Show version

	Examples
	  $ aibot
	  Welcome to AI Bot CLI
`,
	{
		importMeta: import.meta,
		flags: {},
	},
);

render(<App version={cli.pkg.version} />);
