import anyTest, {type TestFn} from 'ava';

import {mcpTools} from '../mcp/askUserQuestion.js';

const test = anyTest as unknown as TestFn;

test('askuser exposes explicit plan interaction purposes', t => {
	const parameters = mcpTools[0]?.function.parameters;
	t.deepEqual(parameters.properties.purpose.enum, [
		'clarification',
		'plan_approval',
		'plan_resume',
	]);
	t.false(parameters.required.includes('purpose'));
});
