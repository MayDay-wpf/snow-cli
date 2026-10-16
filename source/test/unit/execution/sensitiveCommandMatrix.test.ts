import test from 'ava';
import {
	isSensitiveCommand,
	getAllSensitiveCommands,
} from '../../../utils/execution/sensitiveCommandManager.js';

test('DDT / Table-Driven: recognizes dangerous commands even when chained or padded', t => {
	const dangerousCases = [
		'rm -rf /tmp/data',
		'echo "hello" && rm -f file.txt',
		'cat log.txt | rm -r folder',
		'rmdir old_dir',
		'unlink stale_link',
		'dd if=/dev/zero of=/dev/sda',
		'mkfs.ext4 /dev/sdb',
		'fdisk /dev/sda',
		'git reset --hard HEAD~1',
		'git clean -fd',
		'git push --force origin main',
		'drop database production',
	];

	for (const cmd of dangerousCases) {
		const match = isSensitiveCommand(cmd);
		t.true(
			match.isSensitive,
			`Command "${cmd}" must be recognized as sensitive, got pattern: ${match.matchedCommand?.pattern}`,
		);
	}
});

test('Negative Safety: harmless standard commands must not be blocked', t => {
	const safeCases = [
		'git status',
		'npm test',
		'node -v',
		'cargo build',
		'echo "removing text from paper"',
		'cat README.md',
		'git log -n 5',
		'ls -la',
	];

	for (const cmd of safeCases) {
		const match = isSensitiveCommand(cmd);
		t.false(
			match.isSensitive,
			`Safe command "${cmd}" was falsely flagged as sensitive by: ${match.matchedCommand?.pattern}`,
		);
	}
});

test('Chained Pipeline Invariant: compound operators (; && || |) properly split and inspect each segment', t => {
	t.true(isSensitiveCommand('echo 1 ; rm file').isSensitive);
	t.true(isSensitiveCommand('npm run build || rm -rf dist').isSensitive);
	t.true(isSensitiveCommand('ls | unlink link.txt').isSensitive);
});
