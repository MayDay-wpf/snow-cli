import test from 'ava';
import {
	registerCommand,
	unregisterCommand,
	executeCommand,
	getAvailableCommands,
} from '../../../utils/execution/commandExecutor.js';

test.serial('commandExecutor registers, executes and unregisters commands', async t => {
	const cmdName = 'test-ping';
	registerCommand(cmdName, {
		execute: (args?: string) => ({
			success: true,
			message: `pong: ${args || 'empty'}`,
		}),
	});

	t.true(getAvailableCommands().includes(cmdName));

	const res1 = await executeCommand(cmdName, 'hello');
	t.true(res1.success);
	t.is(res1.message, 'pong: hello');

	unregisterCommand(cmdName);
	t.false(getAvailableCommands().includes(cmdName));

	// Unknown command returns sendAsMessage fallback
	const unknown = await executeCommand(cmdName);
	t.is(unknown.action, 'sendAsMessage');
});

test.serial('commandExecutor catches thrown exceptions and returns safe error result', async t => {
	const cmdName = 'test-error';
	registerCommand(cmdName, {
		execute: () => {
			throw new Error('Boom in command handler');
		},
	});

	const res = await executeCommand(cmdName);
	t.false(res.success);
	t.is(res.message, 'Boom in command handler');

	unregisterCommand(cmdName);
});
