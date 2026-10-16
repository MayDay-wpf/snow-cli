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