import test from 'ava';
import {TerminalCommandService} from '../../../mcp/bash.js';

test('TerminalCommandService captures dangerous commands in result stderr', async t => {
	const service = new TerminalCommandService(process.cwd());
	const res = await service.executeCommand('rm -rf /');
	t.is(res.exitCode, 1);
	t.true(res.stderr.includes('Dangerous command detected'));
});

test('TerminalCommandService captures self-destructive commands in result stderr', async t => {
	const service = new TerminalCommandService(process.cwd());
	const res = await service.executeCommand('Stop-Process -Name node');
	t.is(res.exitCode, 1);
	t.true(res.stderr.includes('[SELF-PROTECTION] Command blocked'));
});

test('TerminalCommandService executes safe echo command and returns output', async t => {
	const service = new TerminalCommandService(process.cwd(), 1000);
	const res = await service.executeCommand('node -e "console.log(\'__SNOW_BASH_TEST__\')"');
	t.is(res.exitCode, 0);
	t.true(res.stdout.includes('__SNOW_BASH_TEST__'));
	t.truthy(res.executedAt);
});

test('TerminalCommandService throws timeout error with descriptive message', async t => {
	const service = new TerminalCommandService(process.cwd());
	// Run command that sleeps longer than timeout (50ms timeout, 1000ms sleep)
	const err: any = await t.throwsAsync(
		async () => {
			await service.executeCommand(
				'node -e "setTimeout(() => {}, 1000)"',
				50,
			);
		},
	);
	t.true(err.message.includes('Command timed out'));
});

test('TerminalCommandService handles AbortSignal by returning exitCode 130', async t => {
	const service = new TerminalCommandService(process.cwd());
	const controller = new AbortController();

	setTimeout(() => {
		controller.abort();
	}, 100);

	const res = await service.executeCommand(
		'node -e "setTimeout(() => {}, 2000)"',
		5000,
		controller.signal,
	);
	t.is(res.exitCode, 130);
	t.true(res.stderr.includes('Command execution interrupted by user'));
});
