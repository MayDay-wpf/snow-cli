import anyTest, {type TestFn} from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {spawn} from 'child_process';
import {randomUUID} from 'crypto';
import {processManager} from '../utils/core/processManager.js';

const test = (anyTest as unknown as TestFn).serial;

// ============================================================================
// 隔离沙箱与拓扑回环 (Deterministic Sandbox & Zero Host Leakage)
// ============================================================================
const sandboxDir = path.join(
	os.tmpdir(),
	`snow-mcp-posix-sandbox-${randomUUID()}`,
);

test.before(() => {
	fs.mkdirSync(sandboxDir, {recursive: true});
});

test.after.always(() => {
	try {
		fs.rmSync(sandboxDir, {recursive: true, force: true});
	} catch {
		// ignore
	}
});

function isPidAlive(pid: number): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function waitForCondition(
	fn: () => boolean,
	timeoutMs = 5000,
	intervalMs = 100,
): Promise<boolean> {
	const startTime = Date.now();
	while (Date.now() - startTime < timeoutMs) {
		if (fn()) return true;
		await new Promise(resolve => setTimeout(resolve, intervalMs));
	}
	return fn();
}

test('ProcessManager: safely handles non-existent or invalid pids idempotently', t => {
	t.notThrows(() => {
		processManager.killPidTree(0);
		processManager.killPidTree(-1);
		processManager.killPidTree(99999999);
		processManager.killProcess(99999999);
	});
});

test('ProcessManager: atomic tree termination reaps parent and orphaned grandchild', async t => {
	// Script that spawns grandchild and keeps alive
	const grandchildScript = path.join(sandboxDir, 'grandchild.js');
	const childScript = path.join(sandboxDir, 'child.js');

	fs.writeFileSync(
		grandchildScript,
		`
setInterval(() => {}, 1000);
`,
		'utf8',
	);

	fs.writeFileSync(
		childScript,
		`
const { spawn } = require('child_process');
const path = require('path');
const gc = spawn(process.execPath, [path.join(__dirname, 'grandchild.js')], {
	stdio: ['ignore', 'inherit', 'inherit']
});
console.log('GC_PID:' + gc.pid);
setInterval(() => {}, 1000);
`,
		'utf8',
	);

	const child = spawn(process.execPath, [childScript], {
		stdio: ['ignore', 'pipe', 'inherit'],
	});

	t.truthy(child.pid);
	const childPid = child.pid!;

	let grandchildPid: number | null = null;

	const pidReceivedPromise = new Promise<number>((resolve, reject) => {
		const timeout = setTimeout(
			() => reject(new Error('Timeout waiting for grandchild PID')),
			5000,
		);
		child.stdout?.on('data', chunk => {
			const str = chunk.toString();
			const match = str.match(/GC_PID:(\d+)/);
			if (match) {
				clearTimeout(timeout);
				resolve(parseInt(match[1], 10));
			}
		});
	});

	grandchildPid = await pidReceivedPromise;
	t.truthy(grandchildPid);
	t.true(isPidAlive(childPid), 'Child process should be initially alive');
	t.true(
		isPidAlive(grandchildPid),
		'Grandchild process should be initially alive',
	);

	// Execute tree termination through processManager
	processManager.killPidTree(childPid);

	// Verify both child and grandchild processes are completely terminated
	const bothDead = await waitForCondition(() => {
		return !isPidAlive(childPid) && !isPidAlive(grandchildPid!);
	}, 4000);

	t.true(
		bothDead,
		`Both child (PID ${childPid}) and grandchild (PID ${grandchildPid}) should be reaped`,
	);
	t.false(isPidAlive(childPid));
	t.false(isPidAlive(grandchildPid));
});

test('ProcessManager: register and killAll cleans active tracked processes', async t => {
	const initialCount = processManager.getActiveCount();

	const proc1 = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
	const proc2 = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);

	t.truthy(proc1.pid);
	t.truthy(proc2.pid);

	processManager.register(proc1);
	processManager.register(proc2);

	t.is(processManager.getActiveCount(), initialCount + 2);

	processManager.killAll();

	t.is(processManager.getActiveCount(), 0);

	const allDead = await waitForCondition(() => {
		return !isPidAlive(proc1.pid!) && !isPidAlive(proc2.pid!);
	}, 4000);

	t.true(allDead, 'All registered processes should be killed by killAll()');
});
