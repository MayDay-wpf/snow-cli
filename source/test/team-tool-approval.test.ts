import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

import {resolveTeammateToolApproval} from '../utils/execution/teamExecutor.js';

const test = (anyTest as unknown as TestFn).serial;

// 隔离敏感命令配置，避免依赖开发者本机 ~/.snow/settings.json 的内容。
const prevSnowConfigDir = process.env['SNOW_CONFIG_DIR'];
const sandboxConfigDir = path.join(
	os.tmpdir(),
	`snow-team-approval-${randomUUID()}`,
);

test.before(() => {
	fs.mkdirSync(sandboxConfigDir, {recursive: true});
	process.env['SNOW_CONFIG_DIR'] = sandboxConfigDir;
	fs.writeFileSync(
		path.join(sandboxConfigDir, 'settings.json'),
		JSON.stringify({
			sensitiveCommands: [
				{
					id: 'rm',
					pattern: 'rm ',
					description: 'Delete files or directories (rm, rm -rf, etc.)',
					enabled: true,
					isPreset: true,
				},
				{
					id: 'git-force-push',
					pattern: 'git push*--force',
					description: 'Force push to remote repository (destructive)',
					enabled: true,
					isPreset: true,
				},
			],
		}),
		'utf-8',
	);
});

test.after.always(() => {
	if (prevSnowConfigDir !== undefined) {
		process.env['SNOW_CONFIG_DIR'] = prevSnowConfigDir;
	} else {
		delete process.env['SNOW_CONFIG_DIR'];
	}
	try {
		fs.rmSync(sandboxConfigDir, {recursive: true, force: true});
	} catch {
		// Ignore temporary directory cleanup failure
	}
});

// 回归 #247：teammate 在 YOLO 模式下不能绕过敏感命令的确认闸门。
test('YOLO 模式下 teammate 的敏感命令仍需要用户确认', async t => {
	const result = await resolveTeammateToolApproval(
		'terminal-execute',
		{command: 'rm -rf victim'},
		true,
	);

	t.false(result.approved);
	t.true(result.isSensitive);
});

test('YOLO 模式下 teammate 的强推命令仍需要用户确认', async t => {
	const result = await resolveTeammateToolApproval(
		'terminal-execute',
		{command: 'git push origin main --force'},
		true,
	);

	t.false(result.approved);
	t.true(result.isSensitive);
});

test('YOLO 模式下 teammate 的普通命令自动批准', async t => {
	const result = await resolveTeammateToolApproval(
		'terminal-execute',
		{command: 'ls -la'},
		true,
	);

	t.true(result.approved);
	t.false(result.isSensitive);
});

test('非 YOLO 模式下 teammate 的普通命令仍需确认', async t => {
	const result = await resolveTeammateToolApproval(
		'terminal-execute',
		{command: 'ls -la'},
		false,
	);

	t.false(result.approved);
	t.false(result.isSensitive);
});

test('用户显式加入始终允许列表后，敏感命令可跳过确认', async t => {
	const result = await resolveTeammateToolApproval(
		'terminal-execute',
		{command: 'rm -rf victim'},
		true,
		toolName => toolName === 'terminal-execute',
	);

	t.true(result.approved);
	t.true(result.isSensitive);
});
