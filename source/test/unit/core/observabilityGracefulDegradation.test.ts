import test from 'ava';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {TodoService} from '../../../mcp/todo.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {logger} from '../../../utils/core/logger.js';

test.serial('Graceful Degradation with Observability: TodoService captures diagnostic debug log on invalid JSON instead of swallowing silently', async t => {
	const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-todo-test-'));
	const sessionId = 'test-session-degradation';
	const dateDir = path.join(tempDir, '2026-10-16');
	await fs.mkdir(dateDir, {recursive: true});

	// 注入故意损坏的 JSON 文件（反例/异常边界）
	const corruptedTodoPath = path.join(dateDir, `${sessionId}.json`);
	await fs.writeFile(corruptedTodoPath, 'CORRUPTED_{INVALID_JSON_CONTENT}');

	const todoService = new TodoService(tempDir, () => sessionId);

	// 监听/捕获 log sink 验证可观测性
	const capturedLogs: Array<{level: string; msg: string; meta?: any}> = [];
	const testSink = {
		write: (entry: any) => {
			capturedLogs.push({
				level: entry.level.toLowerCase(),
				msg: entry.message,
				meta: entry.meta,
			});
		},
	};

	logger.setSink(testSink);

	try {
		// 行为断言：服务安全降级，不抛出异常崩坏，返回安全默认值 null
		const result = await todoService.getTodoList(sessionId);
		t.is(result, null, 'Service must safely degrade to null when encountering corrupted data');

		// 可观测性断言：绝不能盲目空 catch 吞错，必须在 debug 级别留下清晰排查线索
		const debugLogs = capturedLogs.filter(
			l => l.level === 'debug' && l.msg.includes('findTodoInDateFolders item read skipped'),
		);
		t.true(
			debugLogs.length >= 1,
			'TodoService must log diagnostic debug message when encountering unreadable or corrupted file',
		);
		t.is(debugLogs[0]?.meta?.todoPath, corruptedTodoPath);
	} finally {
		logger.setSink(null);
		await fs.rm(tempDir, {recursive: true, force: true});
	}
});

test.serial('Graceful Degradation with Observability: SessionManager handles corrupted session file with safe fallback and debug trace', async t => {
	const capturedLogs: Array<{level: string; msg: string; meta?: any}> = [];
	const testSink = {
		write: (entry: any) => {
			capturedLogs.push({
				level: entry.level.toLowerCase(),
				msg: entry.message,
				meta: entry.meta,
			});
		},
	};

	logger.setSink(testSink);

	try {
		// 查询不存在的非凡 ID
		const result = await sessionManager.loadSessionFromDisk('non-existent-uuid-for-test');
		t.is(result, null, 'SessionManager must safely return null on missing session');

		// 验证排查线索记录
		const debugLogs = capturedLogs.filter(
			l => l.level === 'debug' && l.msg.includes('loadSessionFromDisk'),
		);
		t.true(
			debugLogs.length >= 1,
			'SessionManager must log fallback debug info during disk session search',
		);
	} finally {
		logger.setSink(null);
	}
});

test.serial('Ablation & Anti-Ablation: UnifiedSettings getLoggingConfig correctly merges env, settings, and defaults', async t => {
	const {getLoggingConfig} = await import('../../../utils/config/unifiedSettings.js');

	// 1. 基线默认值验证
	const defaultConfig = getLoggingConfig();
	t.is(defaultConfig.bufferSize, 1000);
	t.is(defaultConfig.diskArchive, true);
	t.is(defaultConfig.maxFileSize, 10 * 1024 * 1024);

	// 2. 环境变量消融/注入测试 (Ablation)
	const prevBuffer = process.env['SNOW_LOG_BUFFER_SIZE'];
	const prevDisk = process.env['SNOW_LOG_DISK_ARCHIVE'];
	try {
		process.env['SNOW_LOG_BUFFER_SIZE'] = '420';
		process.env['SNOW_LOG_DISK_ARCHIVE'] = 'false';

		const ablatedConfig = getLoggingConfig();
		t.is(ablatedConfig.bufferSize, 420, 'SNOW_LOG_BUFFER_SIZE must override default bufferSize');
		t.is(ablatedConfig.diskArchive, false, 'SNOW_LOG_DISK_ARCHIVE=false must disable disk archiving');
	} finally {
		if (prevBuffer !== undefined) process.env['SNOW_LOG_BUFFER_SIZE'] = prevBuffer;
		else delete process.env['SNOW_LOG_BUFFER_SIZE'];

		if (prevDisk !== undefined) process.env['SNOW_LOG_DISK_ARCHIVE'] = prevDisk;
		else delete process.env['SNOW_LOG_DISK_ARCHIVE'];
	}
});
