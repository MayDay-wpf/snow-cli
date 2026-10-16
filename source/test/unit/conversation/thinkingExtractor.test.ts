import anyTest, {type TestFn} from 'ava';
import {
	cleanThinkingContent,
	extractThinkingContent,
} from '../../../hooks/conversation/utils/thinkingExtractor.js';

const test = anyTest as unknown as TestFn;

test('cleanThinkingContent removes standalone <think> and </think> tags', t => {
	const raw = '<think>\nHere is some reasoning.\n</think>';
	const cleaned = cleanThinkingContent(raw);
	t.is(cleaned, 'Here is some reasoning.');
});

test('cleanThinkingContent removes <thinking> and </thinking> tags', t => {
	const raw = '<thinking>\nExtended thoughts here.\n</thinking>';
	const cleaned = cleanThinkingContent(raw);
	t.is(cleaned, 'Extended thoughts here.');
});

test('cleanThinkingContent preserves valid code containing <think> inside Markdown backtick fences', t => {
	const raw = [
		'<think>',
		'Analyzing regex code for thinking block:',
		'```typescript',
		'const pattern = /\\s*<\\/?think(?:ing)?>\\s*/gi;',
		'const str = "<think>hello</think>";',
		'```',
		'Done analyzing.',
		'</think>',
	].join('\n');

	const expected = [
		'Analyzing regex code for thinking block:',
		'```typescript',
		'const pattern = /\\s*<\\/?think(?:ing)?>\\s*/gi;',
		'const str = "<think>hello</think>";',
		'```',
		'Done analyzing.',
	].join('\n');

	const cleaned = cleanThinkingContent(raw);
	t.is(cleaned, expected);
});

test('cleanThinkingContent preserves tilde code fences (~)', t => {
	const raw = [
		'<think>',
		'~~~python',
		'xml = "<thinking>keep me</thinking>"',
		'~~~',
		'</think>',
	].join('\n');

	const expected = [
		'~~~python',
		'xml = "<thinking>keep me</thinking>"',
		'~~~',
	].join('\n');

	const cleaned = cleanThinkingContent(raw);
	t.is(cleaned, expected);
});

test('cleanThinkingContent preserves line breaks and code indentation outside fences', t => {
	const raw = [
		'<think>',
		'Step 1:',
		'  indented line 1',
		'  indented line 2',
		'</think>',
	].join('\n');

	const expected = [
		'Step 1:',
		'  indented line 1',
		'  indented line 2',
	].join('\n');

	const cleaned = cleanThinkingContent(raw);
	t.is(cleaned, expected);
});

test('cleanThinkingContent preserves 4-backtick fence wrapping 3-backtick fence with <think>', t => {
	const raw = [
		'<think>',
		'````markdown',
		'```xml',
		'<think>nested code</think>',
		'```',
		'````',
		'</think>',
	].join('\n');

	const expected = [
		'````markdown',
		'```xml',
		'<think>nested code</think>',
		'```',
		'````',
	].join('\n');

	const cleaned = cleanThinkingContent(raw);
	t.is(cleaned, expected);
});

test('cleanThinkingContent handles empty or undefined inputs gracefully', t => {
	t.is(cleanThinkingContent(''), '');
	t.is(cleanThinkingContent(null as any), '');
	t.is(cleanThinkingContent(undefined as any), '');
});

test('extractThinkingContent extracts and cleans thinking data from multiple sources', t => {
	// Anthropic
	const anthropicRes = extractThinkingContent({
		type: 'thinking',
		thinking: '<think>Anthropic reasoning</think>',
	});
	t.is(anthropicRes, 'Anthropic reasoning');

	// Responses API summary
	const summaryRes = extractThinkingContent(undefined, {
		summary: [
			{type: 'summary_text', text: '<think>Step A</think>'},
			{type: 'summary_text', text: 'Step B'},
		],
	});
	t.is(summaryRes, 'Step A\nStep B');

	// DeepSeek R1 reasoning content with code fence
	const deepSeekRes = extractThinkingContent(undefined, undefined, [
		'<think>',
		'```ts',
		'const x = "<think>";',
		'```',
		'</think>',
	].join('\n'));

	t.is(deepSeekRes, '```ts\nconst x = "<think>";\n```');
});
