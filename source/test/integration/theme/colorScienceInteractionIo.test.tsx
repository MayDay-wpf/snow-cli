import anyTest, {type TestFn} from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import CustomThemeScreen from '../../../ui/pages/CustomThemeScreen.js';
import {ThemeProvider} from '../../../ui/contexts/ThemeContext.js';
import {I18nProvider} from '../../../i18n/index.js';

const test = anyTest as unknown as TestFn;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function renderScreen() {
	return render(
		<ThemeProvider>
			<I18nProvider defaultLanguage="zh">
				<CustomThemeScreen onBack={() => {}} />
			</I18nProvider>
		</ThemeProvider>,
	);
}

test('L3 State Machine: Up/Down arrows cycle through all 6 studio fields in circular order', async t => {
	const instance = renderScreen();
	const {lastFrame, stdin} = instance;
	await delay(50);

	// 1. 默认聚焦在 Hue
	let frame = lastFrame() || '';
	t.true(frame.includes('> 色相 (Hue)'));

	// 2. 向下切换到 Chroma
	stdin.write('\u001B[B'); // Down
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('> 彩度 (Chroma)'));

	// 3. 向下切换到 Mood
	stdin.write('\u001B[B');
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('> 底色底模 (Mood)'));

	// 4. 向下切换到 LuminanceBias
	stdin.write('\u001B[B');
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('> 明度偏置 (Bias)'));

	// 5. 向下切换到 DiffHarmony
	stdin.write('\u001B[B');
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('> 比对配色 (Diff Harmony)'));

	// 6. 向下切换到 DiffIntensity
	stdin.write('\u001B[B');
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('> 比对浸润度 (Diff Intensity)'));

	// 7. 再次向下循环回到 Hue
	stdin.write('\u001B[B');
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('> 色相 (Hue)'));

	// 8. 向上逆转切换到 DiffIntensity
	stdin.write('\u001B[A'); // Up
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('> 比对浸润度 (Diff Intensity)'));

	instance.unmount();
});

test('L3 Damping: Chroma boundary clamps strictly between [0.00, 0.35]', async t => {
	const instance = renderScreen();
	const {lastFrame, stdin} = instance;
	await delay(50);

	// 切换到 Chroma
	stdin.write('\u001B[B');
	await delay(50);

	// 连续向左狂按 30 次，断言下限锁定在 0.00
	for (let i = 0; i < 30; i++) {
		stdin.write('\u001B[D'); // Left
	}
	await delay(80);
	let frame = lastFrame() || '';
	t.true(frame.includes('彩度 (Chroma): 0.00'));

	// 连续向右狂按 50 次，断言上限锁定在 0.35
	for (let i = 0; i < 50; i++) {
		stdin.write('\u001B[C'); // Right
	}
	await delay(80);
	frame = lastFrame() || '';
	t.true(frame.includes('彩度 (Chroma): 0.35'));

	instance.unmount();
});

test('L4 Anti-Thrashing: Rapid sliding triggers ZERO disk I/O, only save triggers exactly ONCE', async t => {
	const {configEvents} = await import('../../../utils/config/configEvents.js');
	let saveEventCount = 0;
	const handler = (event: {type: string; value: any}) => {
		if (event.type === 'customColors') {
			saveEventCount++;
		}
	};
	configEvents.onConfigChange(handler);

	try {
		const instance = renderScreen();
		const {stdin} = instance;
		await delay(50);

		// 模拟用户极速连续滑动按键 60 次
		for (let i = 0; i < 60; i++) {
			stdin.write(i % 2 === 0 ? '\u001B[C' : '\u001B[D');
		}
		await delay(100);

		// 核心断言：纯内存 60FPS 热联动，滑动阶段严禁触发任何磁盘写入！
		t.is(saveEventCount, 0, 'Sliding must NOT trigger disk writes (anti-thrashing contract)');

		// 按下快捷键 's' 进行显式保存
		stdin.write('s');
		await delay(80);

		// 核心断言：显式保存触发且仅触发 1 次
		t.is(saveEventCount, 1, 'Pressing "s" must trigger save exactly ONCE');
		instance.unmount();
	} finally {
		configEvents.removeConfigChangeListener(handler);
	}
});
