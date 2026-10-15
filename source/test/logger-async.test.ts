import anyTest, {type TestFn} from 'ava';
import os from 'os';
import path from 'path';
import fs from 'fs';
import {Logger, LogLevel} from '../utils/core/logger.js';

const test = anyTest as unknown as TestFn;

test('Logger micro-batching asynchronously flushes logs and supports subsystems', async t => {
	const testDir = path.join(
		os.tmpdir(),
		`snow-logger-test-${Date.now()}-${Math.random()}`,
	);
	const logger = new Logger({
		logDir: testDir,
		flushIntervalMs: 20,
		minLevel: LogLevel.DEBUG,
	});

	const mcpLogger = logger.subsystem('mcp:tools');

	try {
		// Write entries
		mcpLogger.info('Testing info message', {detail: 'sample'});
		mcpLogger.debug('Testing debug message', {flag: true});

		// Trigger async flush
		await logger.flush();

		// Check file existence
		const files = fs.readdirSync(testDir);
		t.true(files.length > 0);

		// Read content
		const infoFile = files.find(f => f.includes('info.log'));
		t.truthy(infoFile);

		const content = fs.readFileSync(path.join(testDir, infoFile!), 'utf8');
		t.true(content.includes('Testing info message'));
		t.true(content.includes('"subsystem":"mcp:tools"'));

		// Test flushSync
		logger.warn('Testing sync warn message');
		logger.flushSync();

		const warnFile = fs.readdirSync(testDir).find(f => f.includes('warn.log'));
		t.truthy(warnFile);
		const warnContent = fs.readFileSync(path.join(testDir, warnFile!), 'utf8');
		t.true(warnContent.includes('Testing sync warn message'));
	} finally {
		// Cleanup test dir always
		try {
			fs.rmSync(testDir, {recursive: true, force: true});
		} catch {
			// ignore cleanup error
		}
	}
});
