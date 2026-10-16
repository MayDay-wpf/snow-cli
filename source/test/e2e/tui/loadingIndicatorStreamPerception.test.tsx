import anyTest, {type TestFn} from 'ava';
import React from 'react';
import {render} from 'ink-testing-library';
import LoadingIndicator from '../../../ui/components/chat/LoadingIndicator.js';
import {ThemeProvider} from '../../../ui/contexts/ThemeContext.js';
import {I18nProvider} from '../../../i18n/index.js';

const test = anyTest as unknown as TestFn;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function renderIndicator(
	props: Partial<React.ComponentProps<typeof LoadingIndicator>> = {},
) {
	const defaultProps = {
		isStreaming: true,
		isStopping: false,
		isSaving: false,
		isCompressing: false,
		hasPendingToolConfirmation: false,
		hasPendingUserQuestion: false,
		hasBlockingOverlay: false,
		terminalWidth: 100,
		animationFrame: 0,
		retryStatus: null,
		codebaseSearchStatus: null,
		isReasoning: false,
		streamTokenCount: 0,
		elapsedSeconds: 5,
		currentModel: 'deepseek-v4.1-flash',
		teamMode: false,
		...props,
	};

	return render(
		<ThemeProvider>
			<I18nProvider defaultLanguage="zh">
				<LoadingIndicator {...defaultProps} />
			</I18nProvider>
		</ThemeProvider>,
	);
}

test('Perception Invariant: First-token gap must NOT display static "↓ 0 tokens" and must show alive awaiting status', async t => {
	const instance = renderIndicator({streamTokenCount: 0, elapsedSeconds: 4});
	await delay(50);

	const frame = instance.lastFrame() || '';

	t.false(
		frame.includes('↓ 0 tokens'),
		'Violation: Rendered static "↓ 0 tokens" during TTFT gap!',
	);
	t.false(
		frame.includes('0 tokens'),
		'Violation: Rendered "0 tokens" during TTFT gap!',
	);

	t.true(
		frame.includes('等待首字') || frame.includes('···'),
		`Expected frame to indicate awaiting first token, got: "${frame}"`,
	);
	t.true(frame.includes('deepseek-v4.1-flash'));
	t.true(frame.includes('4s'));

	instance.unmount();
});

test('Perception Invariant: Smooth transition to "↓ {count} tokens" once first chunk arrives', async t => {
	const instance = renderIndicator({
		streamTokenCount: 1200,
		elapsedSeconds: 6,
	});
	await delay(50);

	const frame = instance.lastFrame() || '';

	t.true(
		frame.includes('↓ 1.2k tokens'),
		`Expected frame to include "↓ 1.2k tokens", got: "${frame}"`,
	);
	t.false(
		frame.includes('等待首字'),
		'Violation: Awaiting text persisted after tokens arrived!',
	);

	instance.unmount();
});

test('Perception Invariant: Narrow terminal (< 60 cols) safely falls back to compact "···" without overflow', async t => {
	const instance = renderIndicator({
		streamTokenCount: 0,
		elapsedSeconds: 3,
		terminalWidth: 50,
	});
	await delay(50);

	const frame = instance.lastFrame() || '';

	t.true(
		frame.includes('···'),
		`Expected compact dots "···" in narrow terminal, got: "${frame}"`,
	);
	t.false(frame.includes('↓ 0 tokens'));

	instance.unmount();
});

test('Perception Invariant: Deep thinking mode displays "深度思考中..." with awaiting indicator before first token', async t => {
	const instance = renderIndicator({
		isReasoning: true,
		streamTokenCount: 0,
		elapsedSeconds: 2,
	});
	await delay(50);

	const frame = instance.lastFrame() || '';

	t.true(
		frame.includes('深度思考中'),
		`Expected frame to indicate deep thinking, got: "${frame}"`,
	);
	t.false(frame.includes('↓ 0 tokens'));
	t.true(frame.includes('等待首字') || frame.includes('···'));

	instance.unmount();
});

test('Perception Invariant: Frame height strictly maintains 1-2 lines budget', async t => {
	const instance = renderIndicator({streamTokenCount: 0, elapsedSeconds: 5});
	await delay(50);

	const frame = instance.lastFrame() || '';
	const lines = frame.split('\n').filter(l => l.trim().length > 0);

	t.true(
		lines.length <= 2,
		`LoadingIndicator must fit within 2 lines budget to prevent viewport push, got ${lines.length} lines`,
	);

	instance.unmount();
});
