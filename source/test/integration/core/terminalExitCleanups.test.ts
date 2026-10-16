import anyTest, {type TestFn} from 'ava';
import {spawn} from 'child_process';
import * as path from 'path';
import {fileURLToPath} from 'url';
import {
	TERMINAL_EXIT_SEQUENCES,
	emitTerminalExitSequence,
} from '../../../utils/execution/terminal.js';

const test = anyTest as unknown as TestFn;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('TERMINAL_EXIT_SEQUENCES contains all four critical terminal restoration codes', t => {
	// \x1b[?1004l - Disable terminal focus events (eliminates ^[[I / ^[[O)
	t.true(TERMINAL_EXIT_SEQUENCES.includes('\x1b[?1004l'));
	// \x1b[?2004l - Disable bracketed paste mode
	t.true(TERMINAL_EXIT_SEQUENCES.includes('\x1b[?2004l'));
	// \x1b[?25h - Restore cursor visibility
	t.true(TERMINAL_EXIT_SEQUENCES.includes('\x1b[?25h'));
	// \x1b[0 q - Restore cursor shape to terminal default (DECSCUSR 0)
	t.true(TERMINAL_EXIT_SEQUENCES.includes('\x1b[0 q'));
});

test('emitTerminalExitSequence safely writes full sequence to mock stream', t => {
	const writes: string[] = [];
	const mockStream = {
		write(chunk: string) {
			writes.push(chunk);
			return true;
		},
	};

	emitTerminalExitSequence(mockStream as any);

	t.is(writes.length, 1);
	t.is(writes[0], TERMINAL_EXIT_SEQUENCES);
});

test('emitTerminalExitSequence gracefully tolerates stream throwing without unhandled rejection', t => {
	const faultyStream = {
		write() {
			throw new Error('EPIPE: stream broken');
		},
	};

	t.notThrows(() => {
		emitTerminalExitSequence(faultyStream as any);
	});
});

test('emitTerminalExitSequence gracefully tolerates null or invalid stream objects', t => {
	t.notThrows(() => {
		emitTerminalExitSequence(null as any);
	});

	t.notThrows(() => {
		emitTerminalExitSequence({} as any);
	});
});

test('sub-process emits terminal exit sequences on normal exit event', async t => {
	const snippet = `
		import {emitTerminalExitSequence} from './source/utils/execution/terminal.js';
		process.on('exit', () => {
			emitTerminalExitSequence();
		});
		console.log('READY');
	`;

	const child = spawn(
		process.execPath,
		[
			'--loader=ts-node/esm',
			'--loader=./scripts/test-loader.mjs',
			'--input-type=module',
			'-e',
			snippet,
		],
		{
			cwd: path.resolve(__dirname, '../../../../'),
			env: {
				...process.env,
				TS_NODE_TRANSPILE_ONLY: 'true',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		},
	);

	let stdoutData = '';
	let stderrData = '';
	child.stdout.on('data', chunk => {
		stdoutData += chunk.toString();
	});
	child.stderr?.on('data', chunk => {
		stderrData += chunk.toString();
	});

	await new Promise(resolve => child.on('close', resolve));

	t.true(stdoutData.includes('READY'));
	t.true(stdoutData.includes('\x1b[?1004l'));
	t.true(stdoutData.includes('\x1b[?25h'));
});
