import test from 'ava';
import {
	buildDefaultExportFileName,
	resolveExportFilePath,
	formatSessionAsText,
	formatSessionAsMarkdown,
	getDefaultExportDirectory,
} from '../../../utils/session/chatExporter.js';
import type {Session} from '../../../utils/session/sessionManager.js';

test('buildDefaultExportFileName formats deterministic names with timestamp and short ID', t => {
	const filename = buildDefaultExportFileName('12345678-abcd-ef01-2345-6789abcdef01', 'md');
	t.true(filename.startsWith('snow-export-'));
	t.true(filename.endsWith('-12345678.md'));
});

test('resolveExportFilePath prioritizes explicit outPath over default global dir', t => {
	const custom = resolveExportFilePath('test-id', 'json', 'custom/path/export.json');
	t.true(custom.endsWith(path.join('custom', 'path', 'export.json')));

	const def = resolveExportFilePath('test-id', 'txt');
	t.true(def.startsWith(getDefaultExportDirectory()));
});

test('formatSessionAsText and formatSessionAsMarkdown format session details correctly', t => {
	const mockSession: Session = {
		id: 'sess-12345678',
		title: 'Feature Testing Session',
		createdAt: 1700000000000,
		updatedAt: 1700000500000,
		messages: [
			{
				role: 'user',
				content: 'Hello Snow AI',
				timestamp: 1700000100000,
			},
			{
				role: 'assistant',
				content: 'Hello User! How can I help you?',
				thinking: {type: 'thinking', thinking: 'Analyzing user greeting'},
				timestamp: 1700000200000,
			},
			{
				role: 'assistant',
				content: 'Internal step',
				subAgentInternal: true,
				timestamp: 1700000300000,
			},
		],
		messageCount: 3,
		projectPath: '/test/project',
		summary: 'Brief overview of greeting session',
	};

	const txt = formatSessionAsText(mockSession);
	t.true(txt.includes('Title:        Feature Testing Session'));
	t.true(txt.includes('Hello Snow AI'));
	t.true(txt.includes('Analyzing user greeting'));
	t.false(txt.includes('Internal step')); // skipped internal message

	const md = formatSessionAsMarkdown(mockSession);
	t.true(md.includes('# Feature Testing Session'));
	t.true(md.includes('Brief overview of greeting session'));
	t.true(md.includes('<details><summary>Thinking</summary>'));
	t.false(md.includes('Internal step'));
});
import path from 'path';
