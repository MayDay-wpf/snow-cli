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