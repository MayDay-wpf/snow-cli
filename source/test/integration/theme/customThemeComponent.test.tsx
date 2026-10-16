import anyTest, {type TestFn} from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import CustomThemeScreen from '../../../ui/pages/CustomThemeScreen.js';
import {ThemeProvider} from '../../../ui/contexts/ThemeContext.js';
import {I18nProvider} from '../../../i18n/index.js';

import os from 'os';
import path from 'path';
import fs from 'fs';
import {randomUUID} from 'crypto';

const test = anyTest as unknown as TestFn;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let testSandboxDir = '';

test.beforeEach(() => {
	testSandboxDir = path.join(os.tmpdir(), `snow-theme-comp-sandbox-${randomUUID()}`);
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

function renderScreen() {
	return render(
		<ThemeProvider>
			<I18nProvider defaultLanguage="zh">
				<CustomThemeScreen onBack={() => {}} />
			</I18nProvider>
		</ThemeProvider>
	);
}

test('UI Component: CustomThemeScreen renders Studio mode by default with live sandbox', async t => {
	const instance = renderScreen();
	await delay(50);
	const frame = instance.lastFrame() || '';
	const frameLines = frame.split('\n');

	// 视口高度硬门禁不变量：必须 <= 22 行，杜绝标准 24 行终端发生物理滚屏与行移位残影
	t.true(
		frameLines.length <= 22,
		`Studio 模式总行数 (${frameLines.length}) 超过了安全视口预算 22 行`,
	);

	// 1. 标题与双模指示
	t.true(frame.includes('Snow CLI -'));
	t.true(frame.includes('Studio 宏观滑台'));

	// 2. 6 维宏观控制项与滑轨
	t.true(frame.includes('色相 (Hue)'));
	t.true(frame.includes('彩度 (Chroma)'));
	t.true(frame.includes('底色底模 (Mood)'));
	t.true(frame.includes('明度偏置 (Bias)'));
	t.true(frame.includes('比对配色 (Diff Harmony)'));
	t.true(frame.includes('比对浸润度 (Diff Intensity)'));
	t.true(frame.includes('12-Step 色阶'));

	// 3. 科学守门人 APCA 判据
	t.true(frame.includes('APCA 极品对比度'));
	t.true(frame.includes('PASS'));

	// 4. 原生真沙盒（真实 Profile / Model / UserMessagePreview / DiffViewer）
	t.true(frame.includes('[Profile:'));
	t.true(frame.includes('Model:'));
	t.true(frame.includes('Diff:'));
	t.true(frame.includes('themeEngine.ts'));
	t.true(frame.includes('deriveHarmonicDiff'));
	instance.unmount();
});

test('UI Component: Tab key toggles between Studio mode and Expert overrides mode', async t => {
	const instance = renderScreen();
	const {lastFrame, stdin} = instance;
	await delay(50);

	// 初始为 Studio
	t.true((lastFrame() || '').includes('Studio 宏观滑台'));

	// 按 Tab 切换到 Expert 模式
	stdin.write('\t');
	await delay(50);
	const expertFrame = lastFrame() || '';
	t.true(expertFrame.includes('Expert 逐项覆写'));
	t.true(expertFrame.includes('background:'));
	t.true(expertFrame.includes('diffAdded:'));

	// 视口高度硬门禁：Expert 模式行数同样不能超过 22 行
	t.true(
		expertFrame.split('\n').length <= 22,
		`Expert 模式总行数 (${expertFrame.split('\n').length}) 超过了安全视口预算 22 行`,
	);

	// 再次按 Tab 切回 Studio 模式
	stdin.write('\t');
	await delay(50);
	const studioFrame = lastFrame() || '';
	t.true(studioFrame.includes('Studio 宏观滑台'));
	t.true(studioFrame.includes('色相 (Hue)'));
	t.true(
		studioFrame.split('\n').length <= 22,
		`切回 Studio 模式总行数 (${studioFrame.split('\n').length}) 超过了安全视口预算 22 行`,
	);
	instance.unmount();
});

test('UI Component: Arrow keys slide Hue and trigger live 60FPS sandbox re-render', async t => {
	const instance = renderScreen();
	const {lastFrame, stdin} = instance;
	await delay(50);

	const initialFrame = lastFrame() || '';
	const initialMatch = initialFrame.match(/色相 \(Hue\):\s*(\d+)\s*deg/);
	t.truthy(initialMatch);
	const initialHue = parseInt(String(initialMatch?.[1] || '0'), 10);

	// 按右方向键滑动色相 (+5°)
	stdin.write('\u001B[C'); // Right Arrow
	await delay(50);

	const updatedFrame = lastFrame() || '';
	const updatedMatch = updatedFrame.match(/色相 \(Hue\):\s*(\d+)\s*deg/);
	t.truthy(updatedMatch);
	const updatedHue = parseInt(String(updatedMatch?.[1] || '0'), 10);

	t.is(updatedHue, (initialHue + 5) % 360);

	// 交互抖动抑制不变量：按键滑动重绘后行数严格保持 <= 22
	t.true(
		updatedFrame.split('\n').length <= 22,
		`滑动重绘后总行数 (${updatedFrame.split('\n').length}) 超过了安全视口预算 22 行`,
	);
	t.is(
		updatedFrame.split('\n').length,
		initialFrame.split('\n').length,
		'按键滑动重绘前后行数必须严格恒定（Jitter-Free）',
	);
	instance.unmount();
});

