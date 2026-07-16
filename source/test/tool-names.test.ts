import anyTest, {type TestFn} from 'ava';

import {parseToolDisplayNamePairs} from '../utils/commands/toolNames.js';

const test = anyTest as unknown as TestFn;

test('tool display names keep spaces in a single English display name', t => {
	t.deepEqual(parseToolDisplayNamePairs('websearch-search:Web Search'), [
		{toolName: 'websearch-search', displayName: 'Web Search'},
	]);
});

test('tool display names split batches only at the next tool marker', t => {
	t.deepEqual(
		parseToolDisplayNamePairs(
			'filesystem-read:Read File, terminal-execute:Run Shell',
		),
		[
			{toolName: 'filesystem-read', displayName: 'Read File'},
			{toolName: 'terminal-execute', displayName: 'Run Shell'},
		],
	);
	t.deepEqual(parseToolDisplayNamePairs('a:Alpha Name, b:Beta Name'), [
		{toolName: 'a', displayName: 'Alpha Name'},
		{toolName: 'b', displayName: 'Beta Name'},
	]);
});

test('tool display names may contain colons without becoming a batch', t => {
	t.deepEqual(parseToolDisplayNamePairs('websearch-search:Web Search: fast'), [
		{toolName: 'websearch-search', displayName: 'Web Search: fast'},
	]);
});

test('tool display names preserve empty values for clearing overrides', t => {
	t.deepEqual(parseToolDisplayNamePairs('a: b:Beta'), [
		{toolName: 'a', displayName: ''},
		{toolName: 'b', displayName: 'Beta'},
	]);
	t.is(parseToolDisplayNamePairs('missing-separator'), null);
});
