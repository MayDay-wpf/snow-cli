#!/usr/bin/env node
import {spawn} from 'node:child_process';
import process from 'node:process';

/**
 * Reproduce rg spawn behavior with fixed args.
 * Usage:
 *   node source/test/rg-spawn-repro/rg-spawn-repro-fixed.mjs --pattern "foo|bar" --fileGlob "source/**.ts" --cwd "." --maxResults 100 --timeoutMs 300000
 */

function parseArgs(argv) {
	const args = {
		pattern: 'TODO',
		fileGlob: undefined,
		cwd: process.cwd(),
		maxResults: 100,
		timeoutMs: 300000,
	};

	for (let index = 2; index < argv.length; index++) {
		const token = argv[index];
		if (token === '--pattern' && argv[index + 1]) {
			args.pattern = argv[++index];
			continue;
		}

		if (token === '--fileGlob' && argv[index + 1]) {
			args.fileGlob = argv[++index];
			continue;
		}

		if (token === '--cwd' && argv[index + 1]) {
			args.cwd = argv[++index];
			continue;
		}

		if (token === '--maxResults' && argv[index + 1]) {
			args.maxResults = Number.parseInt(argv[++index], 10);
			continue;
		}

		if (token === '--timeoutMs' && argv[index + 1]) {
			args.timeoutMs = Number.parseInt(argv[++index], 10);
		}
	}

	return args;
}

function buildRipgrepArgs(pattern, fileGlob) {
	const args = ['-n', '-i', '--no-heading'];
	const excludeDirs = [
		'node_modules',
		'.git',
		'dist',
		'build',
		'__pycache__',
		'target',
		'.next',
		'.nuxt',
		'coverage',
	];

	for (const directory of excludeDirs) {
		args.push('--glob', `!${directory}/`);
	}

	if (fileGlob) {
		const normalizedGlob = fileGlob.replace(/\\/g, '/');
		args.push('--glob', normalizedGlob);
	}

	args.push(pattern, '.');
	return args;
}

async function main() {
	const options = parseArgs(process.argv);
	const rgArgs = buildRipgrepArgs(options.pattern, options.fileGlob);
	const startedAt = Date.now();

	console.log('=== rg spawn reproduce fixed ===');
	console.log(`cwd=${options.cwd}`);
	console.log(`pattern=${options.pattern}`);
	console.log(`fileGlob=${options.fileGlob ?? '<none>'}`);
	console.log(`timeoutMs=${options.timeoutMs}`);
	console.log(`args=${JSON.stringify(rgArgs)}`);

	const child = spawn('rg', rgArgs, {
		cwd: options.cwd,
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	});

	let stdoutSize = 0;
	let stderrSize = 0;
	let lineCount = 0;
	let stdoutBuffer = '';
	const previewLines = [];

	const heartbeat = setInterval(() => {
		const elapsed = Date.now() - startedAt;
		console.log(
			`[heartbeat] elapsedMs=${elapsed} stdoutBytes=${stdoutSize} stderrBytes=${stderrSize} lines=${lineCount}`,
		);
	}, 5000);

	const timeout = setTimeout(() => {
		const elapsed = Date.now() - startedAt;
		console.error(
			`[timeout] rg did not finish in ${options.timeoutMs}ms. elapsedMs=${elapsed}. killing process...`,
		);
		child.kill('SIGTERM');
		setTimeout(() => child.kill('SIGKILL'), 2000);
	}, options.timeoutMs);

	child.stdout.on('data', chunk => {
		const text = chunk.toString('utf8');
		stdoutSize += chunk.length;
		stdoutBuffer += text;

		let splitIndex = stdoutBuffer.indexOf('\n');
		while (splitIndex !== -1) {
			const line = stdoutBuffer.slice(0, splitIndex).trimEnd();
			stdoutBuffer = stdoutBuffer.slice(splitIndex + 1);
			if (line.length > 0) {
				lineCount += 1;
				if (previewLines.length < options.maxResults) {
					previewLines.push(line);
				}
			}
			splitIndex = stdoutBuffer.indexOf('\n');
		}
	});

	child.stderr.on('data', chunk => {
		stderrSize += chunk.length;
		process.stderr.write(chunk);
	});

	child.on('error', error => {
		clearInterval(heartbeat);
		clearTimeout(timeout);
		console.error(`[error] failed to start rg: ${error.message}`);
		process.exitCode = 1;
	});

	child.on('close', code => {
		clearInterval(heartbeat);
		clearTimeout(timeout);
		const elapsed = Date.now() - startedAt;

		if (stdoutBuffer.trim().length > 0) {
			lineCount += 1;
			if (previewLines.length < options.maxResults) {
				previewLines.push(stdoutBuffer.trimEnd());
			}
		}

		console.log(`\n[done] code=${code} elapsedMs=${elapsed}`);
		console.log(`stdoutBytes=${stdoutSize} stderrBytes=${stderrSize} totalLines=${lineCount}`);
		console.log(`previewCount=${previewLines.length}`);
		if (previewLines.length > 0) {
			console.log('--- preview ---');
			for (const line of previewLines) {
				console.log(line);
			}
			console.log('--- end preview ---');
		}

		if (code === null) {
			process.exitCode = 2;
			return;
		}

		if (code !== 0 && code !== 1) {
			process.exitCode = code;
		}
	});
}

main();
