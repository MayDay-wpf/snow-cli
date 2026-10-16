import anyTest, {type TestFn} from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import AskUserQuestion, {type AskUserQuestionResult} from '../../../ui/components/special/AskUserQuestion.js';
import {ThemeProvider} from '../../../ui/contexts/ThemeContext.js';
import {I18nProvider} from '../../../i18n/index.js';

const test = anyTest as unknown as TestFn;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function renderWithProviders(ui: React.ReactElement) {
	return render(
		<ThemeProvider>
			<I18nProvider defaultLanguage="zh">
				{ui}
			</I18nProvider>
		</ThemeProvider>
	);
}

test('L1 Component: AskUserQuestion renders single-select mode by default without checkboxes', async t => {
	let answeredResult: AskUserQuestionResult | undefined;
	const {lastFrame} = renderWithProviders(
		<AskUserQuestion
			question="Pick one target"
			options={['Apple', 'Banana']}
			onAnswer={res => {
				answeredResult = res;
			}}
		/>,
	);

	await delay(50);
	const frame = lastFrame() || '';
	const lines = frame.split('\n');
	// L2.1 Viewport Height Invariant: <= 22 lines to prevent terminal scrolling
	t.true(
		lines.length <= 22,
		`Terminal Scrolling Violation: AskUserQuestion frame height is ${lines.length} lines, exceeding standard threshold!`,
	);
	t.true(frame.includes('单选模式'));
	t.false(frame.includes('[✓]'));
	t.false(frame.includes('[ ]'));
	t.true(frame.includes('1. Apple'));
	t.true(frame.includes('2. Banana'));
	t.is(answeredResult, undefined);
});

test('L1 Component: AskUserQuestion single-select mode submits immediately on Enter', async t => {
	let answeredResult: AskUserQuestionResult | undefined;
	const {stdin} = renderWithProviders(
		<AskUserQuestion
			question="Pick one target"
			options={['FirstOption', 'SecondOption']}
			onAnswer={res => {
				answeredResult = res;
			}}
		/>,
	);

	await delay(50);
	stdin.write('\r');
	await delay(50);

	t.truthy(answeredResult);
	t.is(answeredResult?.selected, 'FirstOption');
});

test('L1 Component: AskUserQuestion multi-select mode toggles with Space and commits with Enter', async t => {
	let answeredResult: AskUserQuestionResult | undefined;
	const {lastFrame, stdin} = renderWithProviders(
		<AskUserQuestion
			question="Pick multiple targets"
			options={['Alpha', 'Beta', 'Gamma']}
			multiSelect={true}
			onAnswer={res => {
				answeredResult = res;
			}}
		/>,
	);

	await delay(50);
	let frame = lastFrame() || '';
	t.true(frame.includes('多选模式'));
	t.true(frame.includes('[ ] 1. Alpha'));

	// 1. 空格键勾选第 1 项
	stdin.write(' ');
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('[✓] 1. Alpha'));
	t.is(answeredResult, undefined);

	// 2. 向下移动到第 2 项并按空格勾选
	stdin.write('\u001B[B');
	await delay(30);
	stdin.write(' ');
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('[✓] 2. Beta'));

	// 3. 回车提交所有勾选项
	stdin.write('\r');
	await delay(50);

	t.truthy(answeredResult);
	t.deepEqual(answeredResult?.selected, ['Alpha', 'Beta']);
});

test('L1 Component: AskUserQuestion multi-select mode commits highlighted item on Enter if none checked', async t => {
	let answeredResult: AskUserQuestionResult | undefined;
	const {stdin} = renderWithProviders(
		<AskUserQuestion
			question="Pick multiple targets"
			options={['Opt1', 'Opt2']}
			multiSelect={true}
			onAnswer={res => {
				answeredResult = res;
			}}
		/>,
	);

	await delay(50);
	// 未按空格勾选任何项，直接按回车，提交当前高亮项
	stdin.write('\r');
	await delay(50);

	t.truthy(answeredResult);
	t.deepEqual(answeredResult?.selected, ['Opt1']);
});
test('L1 Component: Custom input sanitizes newlines and auto-selects or submits', async t => {
	let answeredResult: AskUserQuestionResult | undefined;
	const {stdin} = renderWithProviders(
		<AskUserQuestion
			question="Test Custom Input"
			options={['Base1', 'Base2']}
			multiSelect={false}
			onAnswer={res => {
				answeredResult = res;
			}}
		/>,
	);

	await delay(50);
	// Tab 跳到自定义输入选项并回车进入编辑
	stdin.write('\t');
	await delay(30);
	stdin.write('\r');
	await delay(50);

	// 模拟粘贴带有换行符与回车的文本
	stdin.write("Pasted\r\nMultiLine\nText");
	await delay(50);

	// 回车确认
	stdin.write('\r');
	await delay(50);

	t.truthy(answeredResult);
	// 验证换行符被规整为单行空格清洗，且单选直接提交该自定义值
	t.is(answeredResult?.selected, 'Pasted MultiLine Text');
});
test('L1 Component: Number keys 1-9 immediately select in single-select and toggle in multi-select', async t => {
	// 1. 单选模式下按数字键 2 立即提交第 2 项
	let singleResult: AskUserQuestionResult | undefined;
	const {stdin: stdin1} = renderWithProviders(
		<AskUserQuestion
			question="Pick by number"
			options={['First', 'Second', 'Third']}
			multiSelect={false}
			onAnswer={res => {
				singleResult = res;
			}}
		/>,
	);
	await delay(50);
	stdin1.write('2');
	await delay(50);
	t.truthy(singleResult);
	t.is(singleResult?.selected, 'Second');

	// 2. 多选模式下按数字键 1 和 3 切换勾选，再按回车提交
	let multiResult: AskUserQuestionResult | undefined;
	const {stdin: stdin2} = renderWithProviders(
		<AskUserQuestion
			question="Pick multiple by numbers"
			options={['First', 'Second', 'Third']}
			multiSelect={true}
			onAnswer={res => {
				multiResult = res;
			}}
		/>,
	);
	await delay(50);
	stdin2.write('1');
	await delay(30);
	stdin2.write('3');
	await delay(30);
	stdin2.write('\r');
	await delay(50);
	t.truthy(multiResult);
	t.deepEqual(multiResult?.selected, ['First', 'Third']);
});

test('L1 Component: ESC key and Cancel navigation cancel question correctly', async t => {
	// 1. ESC 直接取消
	let escResult: AskUserQuestionResult | undefined;
	const {stdin: stdin1} = renderWithProviders(
		<AskUserQuestion
			question="Test ESC"
			options={['A', 'B']}
			onAnswer={res => {
				escResult = res;
			}}
		/>,
	);
	await delay(50);
	stdin1.write('\u001B'); // ESC
	await delay(50);
	t.truthy(escResult);
	t.true(escResult?.cancelled);

	// 2. Tab 到取消并按回车
	let cancelResult: AskUserQuestionResult | undefined;
	const {stdin: stdin2} = renderWithProviders(
		<AskUserQuestion
			question="Test Cancel button"
			options={['A', 'B']}
			onAnswer={res => {
				cancelResult = res;
			}}
		/>,
	);
	await delay(50);
	stdin2.write('\t');
	await delay(30);
	stdin2.write('\t'); // 第二次 Tab 选到取消
	await delay(30);
	stdin2.write('\r');
	await delay(50);
	t.truthy(cancelResult);
	t.true(cancelResult?.cancelled);
});

test('L1 Component: e key edits existing option and ESC cancels edit back to list', async t => {
	let answeredResult: AskUserQuestionResult | undefined;
	const {lastFrame, stdin} = renderWithProviders(
		<AskUserQuestion
			question="Test e key edit"
			options={['ExistingOpt', 'OtherOpt']}
			multiSelect={false}
			onAnswer={res => {
				answeredResult = res;
			}}
		/>,
	);
	await delay(50);
	// 按 e 进入编辑，预填应为 ExistingOpt
	stdin.write('e');
	await delay(50);
	let frame = lastFrame() || '';
	t.true(frame.includes('请输入您的回答'));

	// ESC 取消编辑，退回列表
	stdin.write('\u001B');
	await delay(50);
	frame = lastFrame() || '';
	t.true(frame.includes('选择一个选项'));
	t.is(answeredResult, undefined);
});

test('L1 Component: Multi-select custom input auto-checks and stays in options view', async t => {
	let answeredResult: AskUserQuestionResult | undefined;
	const {lastFrame, stdin} = renderWithProviders(
		<AskUserQuestion
			question="Test Multi Custom"
			options={['ItemA', 'ItemB']}
			multiSelect={true}
			onAnswer={res => {
				answeredResult = res;
			}}
		/>,
	);
	await delay(50);
	// Tab 跳到自定义输入并回车
	stdin.write('\t');
	await delay(30);
	stdin.write('\r');
	await delay(50);

	// 输入新项
	stdin.write('DynamicItem');
	await delay(30);
	stdin.write('\r');
	await delay(50);

	// 此时应退回选择列表，且 DynamicItem 应被自动勾选
	let frame = lastFrame() || '';
	t.true(frame.includes('[✓] 3. DynamicItem'));
	t.is(answeredResult, undefined); // 尚未最终提交

	// 按回车提交所有已勾选项
	stdin.write('\r');
	await delay(50);
	t.truthy(answeredResult);
	t.deepEqual(answeredResult?.selected, ['DynamicItem']);
});
