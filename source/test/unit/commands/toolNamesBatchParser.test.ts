import test from 'ava';
import {parsePairs} from '../../../utils/commands/toolNames.js';

interface TestCase {
	name: string;
	input: string;
	expected: Array<{toolName: string; displayName: string}> | null;
}

const TEST_CASES: TestCase[] = [
	{
		name: 'empty string returns empty array',
		input: '',
		expected: [],
	},
	{
		name: 'whitespace-only returns empty array',
		input: '    ',
		expected: [],
	},
	{
		name: 'single pair without spaces',
		input: 'websearch-search:网页搜索',
		expected: [{toolName: 'websearch-search', displayName: '网页搜索'}],
	},
	{
		name: 'single pair with trailing colon clears displayName',
		input: 'bash-exec:',
		expected: [{toolName: 'bash-exec', displayName: ''}],
	},
	{
		name: 'single pair with colon value',
		input: 'my-tool:SuperFastQuery',
		expected: [{toolName: 'my-tool', displayName: 'SuperFastQuery'}],
	},
	{
		name: 'multi pair separated by spaces',
		input: 'toolA:Alpha toolB:Beta toolC:Gamma',
		expected: [
			{toolName: 'toolA', displayName: 'Alpha'},
			{toolName: 'toolB', displayName: 'Beta'},
			{toolName: 'toolC', displayName: 'Gamma'},
		],
	},
	{
		name: 'multi pair separated by commas and spaces',
		input: 'a:甲, b:乙, c:丙',
		expected: [
			{toolName: 'a', displayName: '甲'},
			{toolName: 'b', displayName: '乙'},
			{toolName: 'c', displayName: '丙'},
		],
	},
	{
		name: 'invalid syntax: no colon returns null',
		input: 'invalid_syntax_without_colon',
		expected: null,
	},
	{
		name: 'invalid syntax: empty toolName before colon returns null',
		input: ':invalidValue',
		expected: null,
	},
	{
		name: 'invalid multi-token syntax: missing colon in second token returns null',
		input: 'valid:one invalid_second_token',
		expected: null,
	},
];

for (const tc of TEST_CASES) {
	test(`parsePairs (DDT): ${tc.name}`, t => {
		const result = parsePairs(tc.input);
		t.deepEqual(result, tc.expected);
	});
}
