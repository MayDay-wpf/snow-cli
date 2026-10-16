import test from 'ava';
import {logger, LogLevel} from '../../../utils/core/logger.js';
import {MemoryLogSink} from '../../helpers/memoryLogSink.js';

test('logger sink: MemoryLogSink safely intercepts logs in-memory without disk I/O', t => {
	const sink = new MemoryLogSink();
	logger.setSink(sink);

	try {
		logger.info('Test info message', {module: 'test'});
		logger.warn('Test warning message');
		logger.error('Test error message', {code: 500});
		logger.debug('Test debug message');

		t.is(sink.getEntries().length, 4);
		t.true(sink.hasMessage('Test info message', 'INFO'));
		t.true(sink.hasMessage('Test warning message', 'WARN'));
		t.true(sink.hasMessage('Test error message', 'ERROR'));
		t.true(sink.hasMessage('Test debug message', 'DEBUG'));

		// 验证结构化元数据
		const errorEntry = sink.getEntries().find(e => e.level === 'ERROR');
		t.truthy(errorEntry);
		t.is(errorEntry?.meta?.code, 500);

		// 清理验证
		sink.clear();
		t.is(sink.getEntries().length, 0);
	} finally {
		// 恢复默认行为，不泄漏到其它测试套件
		logger.setSink(undefined);
	}
});

test('logger child namespace: inherits and chains hierarchical module domains', t => {
	const sink = new MemoryLogSink();
	logger.setSink(sink);

	try {
		const mcpLogger = logger.child('mcp', {sessionId: 'sess-123'});
		const catalogLogger = mcpLogger.child('catalog', {taskId: 'task-456'});

		mcpLogger.info('MCP root initialized');
		catalogLogger.debug('Catalog disk cache hits', {count: 42});

		const entries = sink.getEntries();
		t.is(entries.length, 2);

		t.is(entries[0]?.namespace, 'mcp');
		t.is(entries[0]?.sessionId, 'sess-123');
		t.is(entries[0]?.message, 'MCP root initialized');

		t.is(entries[1]?.namespace, 'mcp.catalog');
		t.is(entries[1]?.sessionId, 'sess-123');
		t.is(entries[1]?.taskId, 'task-456');
		t.is(entries[1]?.meta?.count, 42);
	} finally {
		logger.setSink(undefined);
	}
});

test('logger structured error: accurately serializes Error instance without throwing', t => {
	const sink = new MemoryLogSink();
	logger.setSink(sink);

	try {
		const boom = new Error('Database connection failed');
		(boom as any).code = 'ECONNREFUSED';

		logger.error('Worker failed to connect', boom);

		const entry = sink.getEntries()[0];
		t.truthy(entry);
		t.is(entry?.level, 'ERROR');
		t.is(entry?.error?.name, 'Error');
		t.is(entry?.error?.message, 'Database connection failed');
		t.is(entry?.error?.code, 'ECONNREFUSED');
		t.true(typeof entry?.error?.stack === 'string');
	} finally {
		logger.setSink(undefined);
	}
});

test('logger CircularBufferMemorySink: caps memory buffer and prevents unbounded expansion', async t => {
	const {CircularBufferMemorySink} = await import('../../../utils/core/logger.js');
	const circularSink = new CircularBufferMemorySink(3);

	for (let i = 1; i <= 5; i++) {
		circularSink.write({
			timestamp: new Date().toISOString(),
			level: 'INFO',
			namespace: 'test',
			message: `Msg ${i}`,
		});
	}

	const entries = circularSink.getEntries();
	t.is(entries.length, 3);
	t.is(entries[0]?.message, 'Msg 3');
	t.is(entries[1]?.message, 'Msg 4');
	t.is(entries[2]?.message, 'Msg 5');
});

test('logger CircularBufferMemorySink: respects SNOW_LOG_BUFFER_SIZE environment override', async t => {
	const {CircularBufferMemorySink} = await import('../../../utils/core/logger.js');
	const prev = process.env['SNOW_LOG_BUFFER_SIZE'];
	process.env['SNOW_LOG_BUFFER_SIZE'] = '2';
	try {
		const envSink = new CircularBufferMemorySink();
		envSink.write({timestamp: new Date().toISOString(), level: 'INFO', namespace: 't', message: '1'});
		envSink.write({timestamp: new Date().toISOString(), level: 'INFO', namespace: 't', message: '2'});
		envSink.write({timestamp: new Date().toISOString(), level: 'INFO', namespace: 't', message: '3'});
		t.is(envSink.getEntries().length, 2);
		t.is(envSink.getEntries()[0]?.message, '2');
		t.is(envSink.getEntries()[1]?.message, '3');
	} finally {
		if (prev !== undefined) {
			process.env['SNOW_LOG_BUFFER_SIZE'] = prev;
		} else {
			delete process.env['SNOW_LOG_BUFFER_SIZE'];
		}
	}
});

test('logger startTimer: measures performance latency and propagates durationMs and spanId', async t => {
	const sink = new MemoryLogSink();
	logger.setSink(sink);

	try {
		const timedLogger = logger.child('mcp.tool', {
			sessionId: 'sess-perf-1',
			spanId: 'span-001',
		});

		const timer = timedLogger.startTimer('executeTool', {tool: 'bash'});
		await new Promise(r => setTimeout(r, 25));
		const elapsed = timer.end('Tool execution completed', {exitCode: 0});

		t.true(elapsed >= 15);

		const entries = sink.getEntries();
		t.is(entries.length, 1);
		t.is(entries[0]?.level, 'INFO');
		t.is(entries[0]?.namespace, 'mcp.tool');
		t.is(entries[0]?.spanId, 'span-001');
		t.true(typeof entries[0]?.durationMs === 'number');
		t.true((entries[0]?.durationMs || 0) >= 15);
		t.is(entries[0]?.meta?.tool, 'bash');
		t.is(entries[0]?.meta?.exitCode, 0);

		// 验证计时失败分支
		const failTimer = timedLogger.startTimer('failingJob');
		failTimer.fail('Job crashed unexpectedly', new Error('OOM'));

		const errorEntries = sink.getEntries().filter(e => e.level === 'ERROR');
		t.is(errorEntries.length, 1);
		t.is(errorEntries[0]?.error?.message, 'OOM');
		t.true(typeof errorEntries[0]?.durationMs === 'number');
	} finally {
		logger.setSink(undefined);
	}
});