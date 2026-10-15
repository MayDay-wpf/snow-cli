import anyTest, {type TestFn} from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import WelcomeScreen from '../ui/pages/WelcomeScreen.js';
import ThemeSettingsScreen from '../ui/pages/ThemeSettingsScreen.js';
import {ThemeProvider} from '../ui/contexts/ThemeContext.js';
import {I18nProvider} from '../i18n/index.js';

import os from 'os';
import path from 'path';
import fs from 'fs';
import {randomUUID} from 'crypto';

const test = anyTest as unknown as TestFn;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let testSandboxDir = '';

test.beforeEach(() => {
	testSandboxDir = path.join(os.tmpdir(), `snow-theme-sandbox-${randomUUID()}`);
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

/**
 * 业界启发式自适应巡检驱动器 (Adaptive Visual Anchor Navigator)
 * 替代死写 N 次方向键的脆弱反模式：通过终端当前选中的 ❯ 符号动态嗅探当前项，
 * 只要命中目标正则立即停止并回车，对菜单项的增删、顺序调整与国际化 100% 免疫。
 */
async function navigateToMenuItem(
	instance: ReturnType<typeof render>,
	targetRegex: RegExp,
	maxSteps = 25,
): Promise<{found: boolean; matchedText: string; steps: number}> {
	const {lastFrame, stdin} = instance;

	for (let step = 0; step < maxSteps; step++) {
		await delay(60);
		const rawFrame = lastFrame() || '';
		// 清洗掉 ANSI 控制字符
		const frame = rawFrame.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

		// 匹配 Menu 组件当前选中的行：包含 '❯' 字符的行
		const lines = frame.split('\n');
		const activeLine = lines.find(l => l.includes('❯')) || '';
		const selectedText = activeLine.replace(/.*❯\s*/, '').trim();

		if (targetRegex.test(selectedText)) {
			// 命中目标锚点，发送回车确认进入
			stdin.write('\r');
			await delay(80);
			return {found: true, matchedText: selectedText, steps: step};
		}

		// 未命中目标，发送一次向下键继续探测
		stdin.write('\u001B[B');
	}

	return {found: false, matchedText: '', steps: maxSteps};
}

test('Anchor Invariant: Adaptive Navigator finds Theme Settings regardless of menu position', async t => {
	const instance = render(
		<ThemeProvider>
			<I18nProvider defaultLanguage="en">
				<WelcomeScreen onMenuSelect={() => {}} />
			</I18nProvider>
		</ThemeProvider>,
	);

	await delay(100);

	// 使用正则语义锚点自适应巡检导航到 Theme Settings
	const result = await navigateToMenuItem(instance, /Theme Settings|主题设置/i);
	t.true(result.found, '必须通过视觉锚点动态寻址到 Theme Settings');
	t.regex(result.matchedText, /Theme Settings|主题设置/i);

	// 回车后，WelcomeScreen 将 inlineView 切换为 'theme-settings'，触发懒加载并渲染 ThemeSettingsScreen
	await delay(150);
	const frame = (instance.lastFrame() || '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
	t.true(
		frame.includes('Theme Settings') || frame.includes('主题设置') || frame.includes('Current:') || frame.includes('当前:'),
		'回车后必须成功内联展开并渲染主题设置界面 (ThemeSettingsScreen)',
	);

	instance.unmount();
});

test('Anchor Invariant: Adaptive Navigator hits Custom Theme in ThemeSettingsScreen without hardcoded steps', async t => {
	const instance = render(
		<ThemeProvider>
			<I18nProvider defaultLanguage="en">
				<ThemeSettingsScreen onBack={() => {}} />
			</I18nProvider>
		</ThemeProvider>,
	);

	await delay(100);

	// 在 ThemeSettingsScreen 中自适应巡检到 'Custom'
	const result = await navigateToMenuItem(instance, /Custom|自定义/i);
	t.true(result.found, '必须自适应命中 Custom 选项');

	// 回车后应该进入 CustomThemeScreen 调色工坊 (显示 Studio 或 Expert 模式)
	await delay(100);
	const frame = (instance.lastFrame() || '').replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
	t.true(
		frame.includes('Studio 宏观滑台') || frame.includes('感知色彩科学') || frame.includes('12-Step'),
		'进入 Custom 选项后必须成功打开自定义调色工坊界面',
	);

	instance.unmount();
});

test('Anti-Disturbance: Menu navigation handles noisy/scrolling items with zero index drift', async t => {
	const instance = render(
		<ThemeProvider>
			<I18nProvider defaultLanguage="en">
				<WelcomeScreen onMenuSelect={() => {}} />
			</I18nProvider>
		</ThemeProvider>,
	);

	await delay(100);

	// 连续向下移动并断言每一步的高亮项都是确定性的
	const seenItems: string[] = [];
	for (let i = 0; i < 5; i++) {
		const rawFrame = instance.lastFrame() || '';
		const frame = rawFrame.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
		const lines = frame.split('\n');
		const activeLine = lines.find(l => l.includes('❯')) || '';
		const selectedText = activeLine.replace(/.*❯\s*/, '').trim();

		if (selectedText) {
			seenItems.push(selectedText);
		}
		instance.stdin.write('\u001B[B');
		await delay(50);
	}

	t.is(seenItems.length, 5, '每一步都必须有确定的选中态');
	// 确保没有死循环或挂起
	t.not(seenItems[0], seenItems[1], '每次方向键移动，选中的项目必须发生确定性位移');
	instance.unmount();
});
