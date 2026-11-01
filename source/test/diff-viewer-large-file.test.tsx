import anyTest, {type TestFn} from 'ava';
import React from 'react';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {randomUUID} from 'crypto';
import {render} from 'ink-testing-library';

import DiffViewer from '../ui/components/tools/DiffViewer.js';
import {ThemeProvider} from '../ui/contexts/ThemeContext.js';

const test = anyTest as unknown as TestFn;

let testSandboxDir = '';

test.beforeEach(() => {
	testSandboxDir = path.join(os.tmpdir(), `snow-diff-viewer-${randomUUID()}`);
	fs.mkdirSync(testSandboxDir, {recursive: true});
	process.env['SNOW_CONFIG_DIR'] = testSandboxDir;
});

test.afterEach.always(() => {
	delete process.env['SNOW_CONFIG_DIR'];
	if (testSandboxDir && fs.existsSync(testSandboxDir)) {
		try {
			fs.rmSync(testSandboxDir, {recursive: true, force: true});
		} catch {}
	}
});

function renderDiff(oldContent: string, newContent: string) {
	return render(
		<ThemeProvider>
			<DiffViewer
				oldContent={oldContent}
				newContent={newContent}
				filename="big.ts"
			/>
		</ThemeProvider>,
	);
}

test('DiffViewer renders every changed region of a large diff', t => {
	const oldLines: string[] = [];
	for (let index = 0; index < 20_000; index++) {
		oldLines.push(`const value${index} = ${index};`);
	}

	const newLines = [...oldLines];
	newLines[5000] = 'const CHANGED_5000 = true;';
	newLines[15_000] = 'const CHANGED_15000 = true;';

	const startedAt = Date.now();
	const instance = renderDiff(oldLines.join('\n'), newLines.join('\n'));
	const frame = instance.lastFrame() ?? '';
	instance.unmount();

	t.true(frame.includes('CHANGED_5000'), 'first change region must be shown');
	t.true(frame.includes('CHANGED_15000'), 'second change region must be shown');
	t.false(frame.includes('truncated'), 'diff must not be truncated');
	t.false(frame.includes('hidden'), 'no lines may be hidden');
	t.true(Date.now() - startedAt < 5000);
});

test('DiffViewer renders an almost fully rewritten block completely', async t => {
	const oldLines: string[] = [];
	const newLines: string[] = [];
	for (let index = 0; index < 3500; index++) {
		oldLines.push(`OLDLINE_${index}_${'a'.repeat(20)}`);
		newLines.push(`NEWLINE_${index}_${'b'.repeat(20)}`);
	}

	const startedAt = Date.now();
	const instance = renderDiff(oldLines.join('\n'), newLines.join('\n'));
	await new Promise(resolve => setTimeout(resolve, 200));
	const frame = instance.lastFrame() ?? '';
	instance.unmount();

	t.true(frame.includes('NEWLINE_0_'), 'first added line must be shown');
	t.true(frame.includes('NEWLINE_3499_'), 'last added line must be shown');
	t.true(frame.includes('OLDLINE_0_'), 'first removed line must be shown');
	t.true(frame.includes('OLDLINE_3499_'), 'last removed line must be shown');
	t.false(frame.includes('truncated'));
	t.false(frame.includes('hidden'));
	t.true(Date.now() - startedAt < 10_000);
});

test('DiffViewer renders long lines completely instead of clipping them', t => {
	const longLine = 'x'.repeat(3000);
	const instance = renderDiff('', `${longLine}\nshort`);
	const frame = instance.lastFrame() ?? '';
	instance.unmount();

	const renderedChars = (frame.match(/x/g) ?? []).length;
	t.is(renderedChars, longLine.length);
	t.false(frame.includes('…'));
});
