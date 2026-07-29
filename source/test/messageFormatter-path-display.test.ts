import anyTest, {type TestFn} from 'ava';
import path from 'node:path';
import {
	formatToolCallMessage,
	isFilePath,
	toDisplayPath,
} from '../utils/ui/messageFormatter.js';
import type {ToolCall} from '../utils/execution/toolExecutor.js';

const test = anyTest as unknown as TestFn;

function makeToolCall(name: string, args: Record<string, unknown>): ToolCall {
	return {
		id: 'call_test',
		type: 'function',
		function: {
			name,
			arguments: JSON.stringify(args),
		},
	} as ToolCall;
}

/** Strip OSC 8 hyperlink wrappers for assertion readability */
function stripOsc(text: string): string {
	return text
		.replace(/\x1b\]8;;[^\x07]*\x07/g, '')
		.replace(/\x1b\]8;;\x07/g, '');
}

test('isFilePath recognizes absolute and relative paths, rejects URLs and sentences', t => {
	t.true(isFilePath('/home/user/file.ts'));
	t.true(isFilePath('C:\\Users\\a\\file.ts'));
	t.true(isFilePath('C:/Users/a/file.ts'));
	t.true(isFilePath('./source/foo.ts'));
	t.true(isFilePath('../parent/foo.ts'));
	t.true(isFilePath('source/utils/ui/messageFormatter.ts'));

	t.false(isFilePath('https://example.com/a/b'));
	t.false(isFilePath('file://C:/temp/x.ts'));
	t.false(isFilePath('hello world'));
	t.false(isFilePath('just-a-word'));
	t.false(isFilePath('this is not a/path with spaces'));
});

test('toDisplayPath relativizes cwd-internal absolute paths without double backslashes', t => {
	const abs = path.join(process.cwd(), 'source', 'foo.ts');
	const display = stripOsc(toDisplayPath(abs, true));

	t.true(
		display.includes('./source/foo.ts') || display.includes('source/foo.ts'),
	);
	t.false(display.includes('\\\\'));
	t.false(display.includes(JSON.stringify(abs)));
});

test('toDisplayPath keeps absolute path when outside cwd', t => {
	const outside =
		process.platform === 'win32'
			? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
			: '/etc/hosts';
	const display = stripOsc(toDisplayPath(outside, false));
	t.true(display.includes('hosts'));
	// Should not look like a ./ relative path into the project
	t.false(display.startsWith('./source'));
});

test('formatToolCallMessage: single Windows path array has no doubled backslashes', t => {
	const abs = path.join(process.cwd(), 'source', 'foo.ts');
	const result = formatToolCallMessage(
		makeToolCall('filesystem-read', {filePath: [abs]}),
	);
	const value = stripOsc(result.args[0]!.value);

	// Single path array should not be JSON.stringify'd as ["D:\\..."]
	t.false(value.includes('\\\\'));
	t.false(value.startsWith('['));
	t.true(value.includes('source/foo.ts') || value.includes('source\\foo.ts'));
});

test('formatToolCallMessage: multi path array summary', t => {
	const p1 = path.join(process.cwd(), 'source', 'a.ts');
	const p2 = path.join(process.cwd(), 'source', 'b.ts');
	const p3 = path.join(process.cwd(), 'source', 'c.ts');
	const p4 = path.join(process.cwd(), 'source', 'd.ts');

	const few = formatToolCallMessage(
		makeToolCall('filesystem-read', {filePath: [p1, p2, p3]}),
	);
	const fewValue = stripOsc(few.args[0]!.value);
	t.true(fewValue.startsWith('['));
	t.true(fewValue.includes('a.ts'));
	t.true(fewValue.includes('b.ts'));
	t.true(fewValue.includes('c.ts'));
	t.false(fewValue.includes('\\\\'));

	const many = formatToolCallMessage(
		makeToolCall('filesystem-read', {filePath: [p1, p2, p3, p4]}),
	);
	const manyValue = stripOsc(many.args[0]!.value);
	t.true(manyValue.includes('+2'));
	t.true(manyValue.includes('a.ts'));
	t.true(manyValue.includes('b.ts'));
	t.false(manyValue.includes('d.ts'));
});

test('formatToolCallMessage: non-path strings are unaffected', t => {
	const result = formatToolCallMessage(
		makeToolCall('terminal-execute', {
			command: 'echo hello',
			enableAiSummary: false,
			workingDirectory: path.join(process.cwd(), 'source'),
		}),
	);
	const commandArg = result.args.find(a => a.key === 'command');
	t.truthy(commandArg);
	t.is(stripOsc(commandArg!.value), '"echo hello"');
});

test('formatToolCallMessage: empty path array is []', t => {
	const result = formatToolCallMessage(
		makeToolCall('filesystem-read', {filePath: []}),
	);
	t.is(result.args[0]!.value, '[]');
});

test('formatToolCallMessage: string path arg uses toDisplayPath', t => {
	const abs = path.join(
		process.cwd(),
		'source',
		'utils',
		'ui',
		'messageFormatter.ts',
	);
	const result = formatToolCallMessage(
		makeToolCall('filesystem-read', {filePath: abs}),
	);
	const value = stripOsc(result.args[0]!.value);
	t.true(value.includes('messageFormatter.ts'));
	t.false(value.includes('\\\\'));
});
