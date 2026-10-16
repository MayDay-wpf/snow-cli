import anyTest, {type TestFn} from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import CustomThemeScreen from '../../../ui/pages/CustomThemeScreen.js';
import {ThemeProvider} from '../../../ui/contexts/ThemeContext.js';
import {I18nProvider} from '../../../i18n/index.js';

const test = anyTest as unknown as TestFn;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function renderWithProviders() {
	return render(
		<ThemeProvider>
			<I18nProvider defaultLanguage="zh">
				<CustomThemeScreen onBack={() => {}} />
			</I18nProvider>
		</ThemeProvider>,
	);
}

test('L1 Viewport Invariant: Frame height must strictly fit within 24-row standard terminal', async t => {
	const instance = renderWithProviders();
	await delay(50);

	const frame = instance.lastFrame() || '';
	const lines = frame.split('\n');

	// 标准终端默认 24 行。组件渲染帧高度必须 <= 22 行（预留 2 行终端光标与提示边距，物理杜绝向上推卷/滚动滚屏）
	t.true(
		lines.length <= 22,
		`Terminal Scrolling Violation: CustomThemeScreen frame height is ${lines.length} lines, exceeding the 22-line threshold!`,
	);

	// 验证各核心视口区块皆在帧内完整展示，无截断丢失
	t.true(frame.includes('Snow CLI -'));
	t.true(frame.includes('APCA 极品对比度'));
	t.true(frame.includes('色相 (Hue)'));
	t.true(frame.includes('12-Step 色阶'));
	t.true(frame.includes('[Profile:'));
	t.true(frame.includes('themeEngine.ts'));

	instance.unmount();
});

test('L1 Viewport Invariant: Rapid sequential arrow sliding maintains strictly bounded frame height', async t => {
	const instance = renderWithProviders();
	const {lastFrame, stdin} = instance;
	await delay(50);

	// 连续模拟 10 次方向键高频滑动（模拟用户长按或快速按键）
	for (let i = 0; i < 10; i++) {
		stdin.write('\u001B[C'); // Right Arrow
	}
	await delay(80);

	const frame = lastFrame() || '';
	const lines = frame.split('\n');

	// 动态重绘时依然严格锁定在 22 行以内
	t.true(
		lines.length <= 22,
		`Dynamic Sliding Frame Overflow: Got ${lines.length} lines during continuous right arrow interaction!`,
	);

	instance.unmount();
});

test('L1 Viewport Invariant: Mode toggle between Studio and Expert preserves height boundaries', async t => {
	const instance = renderWithProviders();
	const {lastFrame, stdin} = instance;
	await delay(50);

	// 切到 Expert 逐项覆写模式
	stdin.write('\t');
	await delay(50);
	const expertFrame = lastFrame() || '';
	const expertLines = expertFrame.split('\n');
	t.true(expertFrame.includes('Expert 逐项覆写'));
	// Expert 模式下菜单带有滚屏高度限制，总高度同样不能刷爆终端 (<= 24 lines)
	t.true(expertLines.length <= 24, `Expert mode height violation: ${expertLines.length} lines`);

	// 切回 Studio
	stdin.write('\t');
	await delay(50);
	const studioFrame = lastFrame() || '';
	const studioLines = studioFrame.split('\n');
	t.true(studioLines.length <= 22, `Studio mode returned height violation: ${studioLines.length} lines`);

	instance.unmount();
});

