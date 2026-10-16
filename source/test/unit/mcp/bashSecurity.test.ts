import test from 'ava';
import {
	isDangerousCommand,
	isSelfDestructiveCommand,
	truncateOutput,
} from '../../../mcp/utils/bash/security.utils.js';

test('isDangerousCommand identifies destructive disk and file commands', t => {
	t.true(isDangerousCommand('rm -rf /'));
	t.true(isDangerousCommand('rm -rf /usr/local'));
	t.true(isDangerousCommand('echo foo > /dev/sda'));
	t.true(isDangerousCommand('mkfs.ext4 /dev/sdb1'));
	t.true(isDangerousCommand('dd if=/dev/zero of=/dev/sda'));

	t.false(isDangerousCommand('npm test'));
	t.false(isDangerousCommand('rm -rf ./build'));
	t.false(isDangerousCommand('git status'));
});

test('isSelfDestructiveCommand detects suicide commands targeting Node CLI', t => {
	const currentPid = process.pid;

	// Targeting node processes
	const pwsh = isSelfDestructiveCommand('Stop-Process -Name node');
	t.true(pwsh.isSelfDestructive);
	t.truthy(pwsh.reason);

	const taskkill = isSelfDestructiveCommand('taskkill /F /IM node.exe');
	t.true(taskkill.isSelfDestructive);

	const killall = isSelfDestructiveCommand('killall node');
	t.true(killall.isSelfDestructive);

	const pkill = isSelfDestructiveCommand('pkill -9 node');
	t.true(pkill.isSelfDestructive);

	// Targeting current process PID directly
	const killPid = isSelfDestructiveCommand(`kill -9 ${currentPid}`);
	t.true(killPid.isSelfDestructive);

	// Safe command
	const safe = isSelfDestructiveCommand('node --version');
	t.false(safe.isSelfDestructive);
});

test('truncateOutput correctly handles strings according to threshold', t => {
	t.is(truncateOutput('', 10), '');
	t.is(truncateOutput('12345', 10), '12345');
	t.is(truncateOutput('1234567890', 10), '1234567890');

	const truncated = truncateOutput('1234567890extra', 10);
	t.is(truncated, '1234567890\n... (output truncated)');
});
