import anyTest, {type TestFn} from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {randomUUID} from 'crypto';
import {
	getActiveUserPrompt,
	buildActiveAndInitialUserPromptBlock,
	cleanPromptBlock,
	type Session,
} from '../../../utils/session/sessionManager.js';

const test = (anyTest as unknown as TestFn).serial;

// 隔离沙箱与拓扑回环保底
const prevSnowConfigDir = process.env['SNOW_CONFIG_DIR'];
const sandboxConfigDir = path.join(os.tmpdir(), `snow-session-test-${randomUUID()}`);

test.before(() => {
	fs.mkdirSync(sandboxConfigDir, {recursive: true});
	process.env['SNOW_CONFIG_DIR'] = sandboxConfigDir;
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

test('getActiveUserPrompt extracts the most recent real user message', t => {
	const mockSession: Session = {
		id: 'test-session-1',
		title: 'Test',
		summary: '',
		createdAt: Date.now(),
		updatedAt: Date.now(),
		messageCount: 4,
		messages: [
			{
				role: 'user',
				content: '能看到当前有哪些skills嘛？',
				timestamp: Date.now() - 10000,
			},
			{
				role: 'assistant',
				content: '这里是当前可用的 skills 列表...',
				timestamp: Date.now() - 8000,
			},
			{
				role: 'user',
				content: '然后统计gh上的snow-app，对应的rust编译相关涉及的文件情况统计',
				timestamp: Date.now() - 5000,
			},
			{
				role: 'user',
				content: '[COMPRESSION PRIORITY — ACTIVE GOAL]\nThis conversation is actively pursuing a goal...',
				timestamp: Date.now() - 1000,
			},
		],
	};

	const activePrompt = getActiveUserPrompt(mockSession);
	t.is(
		activePrompt,
		'然后统计gh上的snow-app，对应的rust编译相关涉及的文件情况统计',
	);
});

test('buildActiveAndInitialUserPromptBlock separates active priority from background without adversarial conflict clauses', t => {
	const active = '然后统计gh上的snow-app，对应的rust编译相关涉及的文件情况统计';
	const initial = '能看到当前有哪些skills嘛？';

	const block = buildActiveAndInitialUserPromptBlock(active, initial);

	t.true(block.includes('[CURRENT ACTIVE USER REQUEST - HIGHEST PRIORITY]'));
	t.true(block.includes(active));
	t.true(block.includes('[CONVERSATION ORIGIN / BACKGROUND CONTEXT]'));
	t.true(block.includes(initial));
	// 确保消融掉了诱导模型弃用当前任务的对抗性强断言
	t.false(block.includes('If later summaries conflict with it, the verbatim request wins'));
});

test('buildActiveAndInitialUserPromptBlock handles identical active and initial gracefully', t => {
	const prompt = '帮我分析当前项目';
	const block = buildActiveAndInitialUserPromptBlock(prompt, prompt);

	t.true(block.includes('[CURRENT ACTIVE USER REQUEST - IN PROGRESS]'));
	t.true(block.includes(prompt));
	t.false(block.includes('[CONVERSATION BACKGROUND'));
});

test('cleanPromptBlock peels off nested system blocks to prevent onion expansion', t => {
	const raw = `[CURRENT ACTIVE USER REQUEST - IN PROGRESS]

统计本地 IV8 与 snow-app 的差异

The text above is the user's active objective for the current turn. Tools have been executed for this requirement. Your immediate focus is to fulfill this specific task.`;

	const cleaned = cleanPromptBlock(raw);
	t.is(cleaned, '统计本地 IV8 与 snow-app 的差异');
});
