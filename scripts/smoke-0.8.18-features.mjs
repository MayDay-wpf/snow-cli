#!/usr/bin/env node
/**
 * Smoke-test 0.8.18 feature surface via `snow cmd --json`.
 * Deterministic (no LLM). Safe: restores buddy/display/mode state when possible.
 *
 * Usage:
 *   node scripts/smoke-0.8.18-features.mjs
 *   node scripts/smoke-0.8.18-features.mjs --skip-modes
 */

import {spawnSync} from 'node:child_process';
import {existsSync, readdirSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';

const skipModes = process.argv.includes('--skip-modes');
const results = [];
let failed = 0;

function parseJsonStdout(stdout) {
	const text = String(stdout ?? '');
	const start = text.indexOf('{');
	if (start < 0) {
		throw new Error(`No JSON object in output:\n${text.slice(0, 500)}`);
	}
	return JSON.parse(text.slice(start));
}

function snowCmd(args, {expectOk = true, allowFail = false} = {}) {
	const proc = spawnSync('snow', ['cmd', ...args, '--json'], {
		encoding: 'utf8',
		shell: process.platform === 'win32',
		maxBuffer: 8 * 1024 * 1024,
	});
	let payload;
	try {
		payload = parseJsonStdout(proc.stdout || proc.stderr || '');
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed parsing snow cmd ${args.join(' ')}: ${msg}\nstdout=${proc.stdout}\nstderr=${proc.stderr}`,
		);
	}

	if (!allowFail && expectOk && payload.ok !== true) {
		throw new Error(
			`Command failed: snow cmd ${args.join(' ')}\n${JSON.stringify(payload, null, 2)}`,
		);
	}
	if (!allowFail && !expectOk && payload.ok === true) {
		throw new Error(
			`Expected failure but succeeded: snow cmd ${args.join(' ')}\n${JSON.stringify(payload, null, 2)}`,
		);
	}
	return payload;
}

function check(name, fn) {
	try {
		fn();
		results.push({name, ok: true});
		console.log(`PASS  ${name}`);
	} catch (error) {
		failed += 1;
		const message = error instanceof Error ? error.message : String(error);
		results.push({name, ok: false, message});
		console.error(`FAIL  ${name}`);
		console.error(`      ${message.split('\n')[0]}`);
	}
}

function exportDir() {
	return join(homedir(), '.snow', 'exports');
}

function newestExportFile(beforeMs) {
	const dir = exportDir();
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir)
		.filter(name => name.startsWith('snow-export-'))
		.map(name => {
			const full = join(dir, name);
			return {full, mtimeMs: statSync(full).mtimeMs};
		})
		.filter(item => item.mtimeMs >= beforeMs - 1000)
		.sort((a, b) => b.mtimeMs - a.mtimeMs);
	return files[0]?.full ?? null;
}

console.log('=== snow-ai 0.8.18 feature smoke ===');
console.log(`node=${process.version} cwd=${process.cwd()}`);

// 0) version / help / allowlist
check('snow --version is 0.8.18', () => {
	const proc = spawnSync('snow', ['--version'], {
		encoding: 'utf8',
		shell: process.platform === 'win32',
	});
	const out = String(proc.stdout || '').trim();
	if (!out.includes('0.8.18')) {
		throw new Error(`unexpected version output: ${out}`);
	}
});

check('session-command list includes buddy.set / yolo / export', () => {
	const payload = snowCmd(['session-command', 'list']);
	const ids = (
		payload.data?.commands ??
		payload.data?.items ??
		payload.data ??
		[]
	)
		.map(item => (typeof item === 'string' ? item : item?.id))
		.filter(Boolean);
	for (const required of ['buddy.set', 'yolo', 'export', 'tool-display']) {
		if (!ids.includes(required)) {
			// help fallback: some builds nest differently
			const help = snowCmd(['help']);
			const helpIds = (help.data?.commands ?? []).map(c => c.id);
			if (!helpIds.includes(required) && !ids.includes(required)) {
				throw new Error(`missing command id: ${required}`);
			}
		}
	}
});

// 1) buddy set customization
let originalBuddy = null;
check('buddy status readable', () => {
	const payload = snowCmd(['buddy', 'status']);
	originalBuddy = payload.data?.companion ?? null;
	if (!payload.data?.exists && !originalBuddy) {
		// hatch a temporary companion for the rest of the smoke
		const hatch = snowCmd([
			'buddy',
			'hatch',
			'SmokeBuddy',
			'--species=fox',
			'--personality=smoke-test',
		]);
		if (!hatch.ok) throw new Error(JSON.stringify(hatch));
		originalBuddy = snowCmd(['buddy', 'status']).data?.companion ?? null;
	}
});

check('buddy set updates hat/eye/rarity/shiny', () => {
	// Toggle values so re-running smoke is not a no-op against current state.
	const current = snowCmd(['buddy', 'status']).data?.companion ?? {};
	const nextHat = current.hat === 'wizard' ? 'crown' : 'wizard';
	const nextEye = current.eye === '◉' ? '✦' : '◉';
	const nextRarity = current.rarity === 'epic' ? 'legendary' : 'epic';
	const nextShiny = current.shiny === true ? false : true;

	const payload = snowCmd(
		[
			'buddy',
			'set',
			`--hat=${nextHat}`,
			`--eye=${nextEye}`,
			`--rarity=${nextRarity}`,
			`--shiny=${nextShiny ? 'true' : 'false'}`,
		],
		{allowFail: true},
	);
	if (!payload.ok) throw new Error(JSON.stringify(payload));

	const status = snowCmd(['buddy', 'status']);
	const c = status.data?.companion;
	if (!c) throw new Error('companion missing after set');
	if (c.hat !== nextHat) throw new Error(`hat=${c.hat}, expected ${nextHat}`);
	if (c.eye !== nextEye) throw new Error(`eye=${c.eye}, expected ${nextEye}`);
	if (c.rarity !== nextRarity) {
		throw new Error(`rarity=${c.rarity}, expected ${nextRarity}`);
	}
	if (c.shiny !== nextShiny) {
		throw new Error(`shiny=${c.shiny}, expected ${nextShiny}`);
	}
});

check('buddy set rejects invalid hat', () => {
	const payload = snowCmd(['buddy', 'set', '--hat=not-a-real-hat'], {
		expectOk: false,
		allowFail: true,
	});
	if (payload.ok) throw new Error('invalid hat should fail');
});

// 2) display modes (low_write)
let originalToolDisplay = null;
check('tool-display can switch compact/full', () => {
	const before = snowCmd(['tool-display', 'status']);
	originalToolDisplay =
		before.data?.mode ?? before.data?.value ?? before.data?.toolDisplay ?? null;
	snowCmd(['tool-display', 'compact']);
	const mid = snowCmd(['tool-display', 'status']);
	const midMode = mid.data?.mode ?? mid.data?.value ?? mid.data?.toolDisplay;
	if (String(midMode).toLowerCase() !== 'compact') {
		throw new Error(`expected compact, got ${midMode}`);
	}
	snowCmd(['tool-display', 'full']);
	const after = snowCmd(['tool-display', 'status']);
	const afterMode =
		after.data?.mode ?? after.data?.value ?? after.data?.toolDisplay;
	if (String(afterMode).toLowerCase() !== 'full') {
		throw new Error(`expected full, got ${afterMode}`);
	}
	if (originalToolDisplay) {
		snowCmd(['tool-display', String(originalToolDisplay)]);
	}
});

// 3) mode gates (medium_write) — optional
if (!skipModes) {
	let originalYolo = null;
	check('yolo status + confirm gate + reversible toggle', () => {
		const status = snowCmd(['yolo', 'status']);
		originalYolo = Boolean(status.data?.enabled);

		const denied = snowCmd(['yolo', originalYolo ? 'off' : 'on'], {
			expectOk: false,
			allowFail: true,
		});
		if (denied.ok) {
			throw new Error('yolo write without --yes should fail');
		}

		const flipped = snowCmd(
			['yolo', originalYolo ? 'off' : 'on', '--yes'],
			{allowFail: false},
		);
		if (!flipped.ok) throw new Error(JSON.stringify(flipped));

		// restore
		snowCmd(['yolo', originalYolo ? 'on' : 'off', '--yes']);
		const restored = snowCmd(['yolo', 'status']);
		if (Boolean(restored.data?.enabled) !== originalYolo) {
			throw new Error('failed to restore yolo state');
		}
	});
}

// 4) export path under ~/.snow/exports (needs a session id if available)
check('export defaults under ~/.snow/exports when session exists', () => {
	const sessions = snowCmd(['session', 'list']);
	const list =
		sessions.data?.sessions ??
		sessions.data?.items ??
		(Array.isArray(sessions.data) ? sessions.data : []);
	const first =
		list[0]?.id ?? list[0]?.sessionId ?? list[0]?.uuid ?? list[0] ?? null;
	if (!first || typeof first !== 'string') {
		console.log('SKIP  export (no session available)');
		results.push({name: 'export defaults under ~/.snow/exports', ok: true, skipped: true});
		return;
	}

	const before = Date.now();
	const exported = snowCmd(['export', 'md', `--session=${first}`]);
	if (!exported.ok) throw new Error(JSON.stringify(exported));
	const pathFromPayload =
		exported.data?.path ??
		exported.data?.filePath ??
		exported.data?.out ??
		null;
	const expectedPrefix = exportDir().replace(/\\/g, '/');
	const actual =
		(pathFromPayload && String(pathFromPayload)) || newestExportFile(before);
	if (!actual) throw new Error('export path missing');
	const normalized = actual.replace(/\\/g, '/');
	if (!normalized.includes('/.snow/exports/')) {
		// Windows home may use backslashes already normalized above
		if (!normalized.toLowerCase().includes('.snow/exports')) {
			throw new Error(`export not under ~/.snow/exports: ${actual} (expected prefix ${expectedPrefix})`);
		}
	}
});

// restore buddy look if we had an original snapshot
if (originalBuddy) {
	check('restore original buddy appearance', () => {
		const args = ['buddy', 'set'];
		if (originalBuddy.hat) args.push(`--hat=${originalBuddy.hat}`);
		if (originalBuddy.eye) args.push(`--eye=${originalBuddy.eye}`);
		if (originalBuddy.rarity) args.push(`--rarity=${originalBuddy.rarity}`);
		if (typeof originalBuddy.shiny === 'boolean') {
			args.push(`--shiny=${originalBuddy.shiny ? 'true' : 'false'}`);
		}
		// personality may contain spaces/commas; skip if empty
		const payload = snowCmd(args, {allowFail: true});
		// No-op restore (already same values) is acceptable.
		if (
			!payload.ok &&
			payload.code !== 'INVALID_ARGS' &&
			!String(payload.message || '').includes('No valid changes')
		) {
			throw new Error(JSON.stringify(payload));
		}
		const status = snowCmd(['buddy', 'status']).data?.companion;
		if (!status) throw new Error('companion missing after restore');
		if (originalBuddy.hat && status.hat !== originalBuddy.hat) {
			throw new Error(`hat restore failed: ${status.hat}`);
		}
		if (originalBuddy.eye && status.eye !== originalBuddy.eye) {
			throw new Error(`eye restore failed: ${status.eye}`);
		}
	});
}

console.log('');
console.log(
	failed === 0
		? `SMOKE OK (${results.length} checks)`
		: `SMOKE FAILED (${failed}/${results.length})`,
);
process.exit(failed === 0 ? 0 : 1);
