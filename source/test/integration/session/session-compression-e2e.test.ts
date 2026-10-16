import anyTest, {type TestFn} from 'ava';
import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {randomUUID} from 'crypto';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {
	saveConfig,
	clearConfigCache,
	DEFAULT_CONFIG,
} from '../../../utils/config/apiConfig.js';
import {executeContextCompression} from '../../../hooks/conversation/useCommandHandler.js';
import {handleAutoCompression} from '../../../hooks/conversation/core/autoCompressHandler.js';
import {goalManager} from '../../../utils/task/goalManager.js';

const test = (anyTest as unknown as TestFn).serial;

// ============================================================================
// 隔离沙箱与 Mock 协议服务器 (Deterministic Mock Server & Sandbox)
// 100% 隔离外部网络、0 真实 Token 消耗、100% 走真实内部流式解析与会话存储调度
// ============================================================================
const prevSnowConfigDir = process.env['SNOW_CONFIG_DIR'];
const sandboxConfigDir = path.join(
	os.tmpdir(),
	`snow-compress-e2e-${randomUUID()}`,
);

let mockServer: http.Server;
let mockServerBaseUrl: string;

test.before(async () => {
	fs.mkdirSync(sandboxConfigDir, {recursive: true});
	process.env['SNOW_CONFIG_DIR'] = sandboxConfigDir;
	clearConfigCache();

	// 启动轻量级本地 SSE 响应服务器，模拟真实大模型返回流式压缩摘要
	await new Promise<void>(resolve => {
		mockServer = http.createServer((req, res) => {
			if (req.method === 'POST' && req.url?.includes('chat/completions')) {
				res.writeHead(200, {
					'Content-Type': 'text/event-stream; charset=utf-8',
					'Cache-Control': 'no-cache',
					Connection: 'keep-alive',
				});

				const chunk1 = {
					id: 'chatcmpl-mock-1',
					object: 'chat.completion.chunk',
					choices: [
						{
							delta: {
								content:
									'## Handover Summary\n- Active Task: Rust compilation analysis\n',
							},
						},
					],
				};
				const chunk2 = {
					id: 'chatcmpl-mock-2',
					object: 'chat.completion.chunk',
					choices: [
						{
							delta: {
								content: '- Details: Comparing local IV8 and snow-app\n',
							},
						},
					],
				};

				res.write(`data: ${JSON.stringify(chunk1)}\n\n`);
				res.write(`data: ${JSON.stringify(chunk2)}\n\n`);
				res.write('data: [DONE]\n\n');
				res.end();
				return;
			}

			res.writeHead(404).end();
		});

		mockServer.listen(0, '127.0.0.1', () => {
			const addr = mockServer.address();
			const port = typeof addr === 'object' && addr ? addr.port : 0;
			mockServerBaseUrl = `http://127.0.0.1:${port}/v1`;
			resolve();
		});
	});

	// 配置指向本地 Mock 服务
	saveConfig({
		snowcfg: {
			...DEFAULT_CONFIG.snowcfg,
			baseUrl: mockServerBaseUrl,
			apiKey: 'mock-sk-123456',
			requestMethod: 'chat',
			advancedModel: 'gpt-4o-mock',
			enableAutoCompress: true,
			autoCompressThreshold: 80,
		},
	});
});

test.after.always(async () => {
	// 关闭 Mock Server
	await new Promise<void>(resolve => {
		if (mockServer) {
			mockServer.close(() => resolve());
		} else {
			resolve();
		}
	});

	// 恢复环境变量与清除沙箱
	if (prevSnowConfigDir !== undefined) {
		process.env['SNOW_CONFIG_DIR'] = prevSnowConfigDir;
	} else {
		delete process.env['SNOW_CONFIG_DIR'];
	}
	clearConfigCache();

	try {
		fs.rmSync(sandboxConfigDir, {recursive: true, force: true});
	} catch {
		// ignore
	}
});

test('E2E Manual Compression (/compact): retains active user prompt over root prompt', async t => {
	// 构造真实磁盘会话 S1，经历两轮对话（Turn 1 为远古需求，Turn 2 为当前重型需求）
	const session = await sessionManager.createNewSession();
	session.messages = [
		{
			role: 'user',
			content: '能看到当前有哪些skills嘛？',
			timestamp: Date.now() - 10000,
		},
		{
			role: 'assistant',
			content: '这里是当前可用的 skills 列表: ...',
			timestamp: Date.now() - 8000,
		},
		{
			role: 'user',
			content: '然后统计gh上的snow-app，对应的rust编译相关涉及的文件情况统计，对比本地IV8项目',
			timestamp: Date.now() - 5000,
		},
		{
			role: 'assistant',
			content: '开始执行探查...',
			timestamp: Date.now() - 3000,
		},
	];
	session.messageCount = session.messages.length;
	session.initialUserPrompt = '能看到当前有哪些skills嘛？';
	await sessionManager.saveSession(session);
	sessionManager.setCurrentSession(session);

	// 执行完整手动压缩流程
	const result = await executeContextCompression(session.id);
	t.truthy(result, 'executeContextCompression should return result');

	// 检查压缩后的当前会话
	const compressedSession = sessionManager.getCurrentSession();
	t.truthy(compressedSession);
	t.not(compressedSession!.id, session.id, 'New session should be created');
	t.is(compressedSession!.compressedFrom, session.id);

	// 断言双轨 Prompt 结构：首条消息必须优先锚定 Turn 2 活跃需求
	const firstUserMessage = compressedSession!.messages.find(
		m => m.role === 'user',
	);
	t.truthy(firstUserMessage);
	const content = firstUserMessage!.content || '';

	t.true(content.includes('[CURRENT ACTIVE USER REQUEST - HIGHEST PRIORITY]'));
	t.true(
		content.includes(
			'然后统计gh上的snow-app，对应的rust编译相关涉及的文件情况统计，对比本地IV8项目',
		),
	);
	t.true(content.includes('[CONVERSATION ORIGIN / BACKGROUND CONTEXT]'));
	t.true(content.includes('能看到当前有哪些skills嘛？'));

	// 核心安全红线：消融掉诱导模型弃用当前任务的对抗性强断言
	t.false(
		content.includes(
			'If later summaries conflict with it, the verbatim request wins',
		),
	);

	// 继承链：新会话的 initialUserPrompt 必须更新为当前活跃需求
	t.is(
		compressedSession!.initialUserPrompt,
		'然后统计gh上的snow-app，对应的rust编译相关涉及的文件情况统计，对比本地IV8项目',
	);
});

test('E2E In-Turn Auto Compression: triggers during tool execution and updates conversation state', async t => {
	// 构造正处于工具调用中途的长程会话
	const session = await sessionManager.createNewSession();
	session.messages = [
		{
			role: 'user',
			content: '你好，开始记录',
			timestamp: Date.now() - 20000,
		},
		{
			role: 'assistant',
			content: '好的已就绪',
			timestamp: Date.now() - 18000,
		},
		{
			role: 'user',
			content: '请扫描本地目录所有 .rs 文件并汇总体积',
			timestamp: Date.now() - 5000,
		},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_mock_terminal_1',
					type: 'function',
					function: {
						name: 'terminal-execute',
						arguments: JSON.stringify({command: 'Get-ChildItem -Filter *.rs'}),
					},
				},
			],
			timestamp: Date.now() - 3000,
		},
		{
			role: 'tool',
			tool_call_id: 'call_mock_terminal_1',
			content: 'Found 42 files, total 1.2MB',
			timestamp: Date.now() - 1000,
		},
	];
	session.messageCount = session.messages.length;
	session.initialUserPrompt = '你好，开始记录';
	await sessionManager.saveSession(session);
	sessionManager.setCurrentSession(session);

	let uiMessagesState: any[] = [];
	let remountKey = 0;
	let autoCompressingFlag = false;

	// 触发自动压缩（阈值设置为 85%，当前达到 90% 触发）
	const compressResult = await handleAutoCompression({
		getCurrentContextPercentage: () => 90,
		setMessages: updater => {
			if (typeof updater === 'function') {
				uiMessagesState = updater(uiMessagesState);
			} else {
				uiMessagesState = updater;
			}
		},
		clearSavedMessages: () => {},
		setRemountKey: updater => {
			if (typeof updater === 'function') {
				remountKey = updater(remountKey);
			}
		},
		setContextUsage: () => {},
		freeEncoder: () => {},
		compressingLabel: '✵ Auto-compressing context before sending tool results...',
		setIsAutoCompressing: val => {
			autoCompressingFlag = val;
		},
	});

	// 验证压缩执行结果
	t.true(compressResult.compressed, 'Auto compression should succeed');
	t.false(compressResult.hookFailed);
	t.truthy(compressResult.updatedConversationMessages);
	t.true(compressResult.updatedConversationMessages!.length > 0);
	t.false(autoCompressingFlag, 'Auto compressing flag should be reset to false after completion');
	t.true(remountKey >= 0);
	t.true(uiMessagesState.length >= 0);

	// 验证新会话已经切换并且保存到了沙箱磁盘
	const activeSession = sessionManager.getCurrentSession();
	t.truthy(activeSession);
	t.not(activeSession!.id, session.id);
	t.is(activeSession!.compressedFrom, session.id);

	// 验证当前活跃任务被正确锚定
	const firstUser = activeSession!.messages.find(m => m.role === 'user');
	t.truthy(firstUser);
	t.true(
		firstUser!.content?.includes('请扫描本地目录所有 .rs 文件并汇总体积'),
	);
	t.true(
		firstUser!.content?.includes(
			'[CURRENT ACTIVE USER REQUEST - HIGHEST PRIORITY]',
		),
	);
});

test('E2E Auto Compression Guard: skips compression when context percentage is below threshold', async t => {
	const session = await sessionManager.createNewSession();
	session.messages = [
		{role: 'user', content: '测试消息 1', timestamp: Date.now()},
		{role: 'assistant', content: '回复 1', timestamp: Date.now()},
	];
	await sessionManager.saveSession(session);
	sessionManager.setCurrentSession(session);

	// 当前为 50%，阈值为 80%，不应触发
	const compressResult = await handleAutoCompression({
		getCurrentContextPercentage: () => 50,
		setMessages: () => {},
		freeEncoder: () => {},
		setContextUsage: () => {},
	});

	t.false(compressResult.compressed);
	t.is(sessionManager.getCurrentSession()?.id, session.id, 'Session should not change');
});

test('E2E Multi-turn Heavy Tool Output & Truncation: truncates oversized tool outputs and anchors active turn', async t => {
	const session = await sessionManager.createNewSession();
	const heavyOutput = 'Log line: system status ok\n'.repeat(300); // ~8KB output

	session.messages = [
		{role: 'user', content: '第一轮：查看系统运行环境', timestamp: Date.now() - 20000},
		{role: 'assistant', content: '已准备就绪', timestamp: Date.now() - 18000},
		{role: 'user', content: '第二轮：运行深度探查并输出全量日志', timestamp: Date.now() - 15000},
		{
			role: 'assistant',
			content: '',
			tool_calls: [
				{
					id: 'call_heavy_1',
					type: 'function',
					function: {
						name: 'terminal-execute',
						arguments: JSON.stringify({command: 'Get-ChildItem -Recurse'}),
					},
				},
			],
			timestamp: Date.now() - 12000,
		},
		{
			role: 'tool',
			tool_call_id: 'call_heavy_1',
			content: heavyOutput,
			timestamp: Date.now() - 10000,
		},
		{role: 'assistant', content: '已获取探查结果，存在潜在瓶颈', timestamp: Date.now() - 8000},
		{role: 'user', content: '第三轮活跃任务：基于上述日志直接重构优化编译参数', timestamp: Date.now() - 5000},
		{role: 'assistant', content: '开始分析并应用编译参数...', timestamp: Date.now() - 2000},
	];
	session.messageCount = session.messages.length;
	session.initialUserPrompt = '第一轮：查看系统运行环境';
	await sessionManager.saveSession(session);
	sessionManager.setCurrentSession(session);

	const result = await executeContextCompression(session.id);
	t.truthy(result);

	const compressedSession = sessionManager.getCurrentSession();
	t.truthy(compressedSession);
	t.not(compressedSession!.id, session.id);

	// 验证活跃意图正确提权
	t.is(
		compressedSession!.initialUserPrompt,
		'第三轮活跃任务：基于上述日志直接重构优化编译参数',
	);
	const firstUser = compressedSession!.messages.find(m => m.role === 'user');
	t.truthy(firstUser);
	t.true(
		firstUser!.content?.includes('第三轮活跃任务：基于上述日志直接重构优化编译参数'),
	);
	t.true(
		firstUser!.content?.includes('[CURRENT ACTIVE USER REQUEST - HIGHEST PRIORITY]'),
	);
	t.true(
		firstUser!.content?.includes('[CONVERSATION ORIGIN / BACKGROUND CONTEXT]'),
	);
	t.true(
		firstUser!.content?.includes('第一轮：查看系统运行环境'),
	);
});

test('E2E Goal Mode (/goal) with Compression Handover: seamlessly migrates goal and injects objective block', async t => {
	const session = await sessionManager.createNewSession();
	sessionManager.setCurrentSession(session);

	try {
		// 创建目标
		const goal = await goalManager.createGoal('完成全量测试与防劫持验证', 1000000);
		t.truthy(goal);
		session.hasGoal = true;

		session.messages = [
			{role: 'user', content: 'Turn 1: 初始化编译目标', timestamp: Date.now() - 10000},
			{role: 'assistant', content: '目标已建立', timestamp: Date.now() - 8000},
			{role: 'user', content: 'Turn 2: 执行关键测试套件并验证', timestamp: Date.now() - 5000},
			{role: 'assistant', content: '正在执行...', timestamp: Date.now() - 2000},
		];
		session.messageCount = session.messages.length;
		session.initialUserPrompt = 'Turn 1: 初始化编译目标';
		await sessionManager.saveSession(session);

		const result = await executeContextCompression(session.id);
		t.truthy(result);

		const compressedSession = sessionManager.getCurrentSession();
		t.truthy(compressedSession);
		t.not(compressedSession!.id, session.id);
		t.true(compressedSession!.hasGoal, 'New session must inherit hasGoal flag');

		// 验证目标迁移到了新 session
		const migratedGoal = await goalManager.loadGoalForSession(compressedSession!.id);
		t.truthy(migratedGoal, 'Goal must be migrated to new session ID');
		t.is(migratedGoal!.objective, '完成全量测试与防劫持验证');
		t.is(migratedGoal!.status, 'pursuing');

		// 验证新会话首条消息注入了目标原文
		const firstUser = compressedSession!.messages.find(m => m.role === 'user');
		t.truthy(firstUser);
		t.true(
			firstUser!.content?.includes('[GOAL OBJECTIVE - VERBATIM'),
			'First user message must contain the goal objective block',
		);
		t.true(
			firstUser!.content?.includes('完成全量测试与防劫持验证'),
			'First user message must contain the exact goal objective',
		);
	} finally {
		// 清理目标
		await goalManager.clearGoal();
	}
});

test('E2E Pure Conversation Multi-turn (Zero Tools): smooth compression without deadlock', async t => {
	const session = await sessionManager.createNewSession();
	session.messages = [
		{role: 'user', content: '请分析 Deno 与 Node 的核心差异', timestamp: Date.now() - 8000},
		{role: 'assistant', content: '好的，Deno 的核心在于内置安全沙箱与 TypeScript 支持。', timestamp: Date.now() - 7000},
		{role: 'user', content: '深入对比两者的 V8 绑定机制', timestamp: Date.now() - 6000},
		{role: 'assistant', content: 'Deno 使用 rusty_v8 纯 Rust 绑定，Node 使用 C++ 宏与 binding.gyp。', timestamp: Date.now() - 5000},
		{role: 'user', content: '那么 rusty_v8 在 Windows 平台上的增量编译瓶颈在何处', timestamp: Date.now() - 4000},
		{role: 'assistant', content: '瓶颈主要在静态符号生成和庞大的 C++ 导出表。', timestamp: Date.now() - 3000},
		{role: 'user', content: '请给出三条切实可行的本地编译优化参数配置', timestamp: Date.now() - 2000},
		{role: 'assistant', content: '建议配置如下：1. sccache 2. lld-link 3. 禁用 debuginfo', timestamp: Date.now() - 1000},
	];
	session.messageCount = session.messages.length;
	session.initialUserPrompt = '请分析 Deno 与 Node 的核心差异';
	await sessionManager.saveSession(session);
	sessionManager.setCurrentSession(session);

	const result = await executeContextCompression(session.id);
	t.truthy(result, 'Pure multi-turn conversation should compress smoothly');

	const compressedSession = sessionManager.getCurrentSession();
	t.truthy(compressedSession);
	t.not(compressedSession!.id, session.id);

	t.is(
		compressedSession!.initialUserPrompt,
		'请给出三条切实可行的本地编译优化参数配置',
	);
	const firstUser = compressedSession!.messages.find(m => m.role === 'user');
	t.truthy(firstUser);
	t.true(
		firstUser!.content?.includes('请给出三条切实可行的本地编译优化参数配置'),
	);
	t.true(
		firstUser!.content?.includes('请分析 Deno 与 Node 的核心差异'),
	);
});

test('E2E User Abort Signal (ESC during compression): leaves original session intact', async t => {
	const session = await sessionManager.createNewSession();
	session.messages = [
		{role: 'user', content: '准备测试中断', timestamp: Date.now() - 4000},
		{role: 'assistant', content: '收到', timestamp: Date.now() - 3000},
		{role: 'user', content: '中断测试指令', timestamp: Date.now() - 2000},
		{role: 'assistant', content: '处理中', timestamp: Date.now() - 1000},
	];
	session.messageCount = session.messages.length;
	session.initialUserPrompt = '准备测试中断';
	await sessionManager.saveSession(session);
	sessionManager.setCurrentSession(session);

	const abortController = new AbortController();
	abortController.abort(); // 模拟用户立即按下 ESC

	const result = await executeContextCompression(
		session.id,
		undefined,
		abortController.signal,
	);
	t.is(result, null, 'Aborted compression must return null');

	// 原始会话保持完好，没有产生残留会话
	const currentSession = sessionManager.getCurrentSession();
	t.is(currentSession?.id, session.id);
	t.is(currentSession?.messageCount, 4);
});

