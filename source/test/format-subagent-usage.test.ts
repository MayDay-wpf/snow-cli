import anyTest, {type TestFn} from 'ava';
import {formatSubAgentFinalUsage} from '../ui/utils/formatSubAgentUsage.js';

const test = anyTest as unknown as TestFn;

test('formats final cumulative sub-agent usage with cached input', t => {
	t.is(
		formatSubAgentFinalUsage({
			inputTokens: 1000,
			outputTokens: 200,
			cacheCreationInputTokens: 300,
			cacheReadInputTokens: 400,
		}),
		'1.9k tokens (In 1.7k / Out 200)',
	);
});

test('formats final cumulative sub-agent usage without cache fields', t => {
	t.is(
		formatSubAgentFinalUsage({inputTokens: 120, outputTokens: 22}),
		'142 tokens (In 120 / Out 22)',
	);
});
