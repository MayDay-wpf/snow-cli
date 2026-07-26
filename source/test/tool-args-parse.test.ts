import anyTest, {type TestFn} from 'ava';
import {
	parseToolArgumentsDetailed,
	safeParseToolArguments,
} from '../utils/execution/toolArgsParse.js';

const test = anyTest as unknown as TestFn;

test('parseToolArgumentsDetailed accepts valid JSON object', t => {
	const result = parseToolArgumentsDetailed('{"a":1,"b":"x"}');
	t.true(result.ok);
	if (result.ok) {
		t.deepEqual(result.args, {a: 1, b: 'x'});
		t.falsy(result.repaired);
	}
});

test('parseToolArgumentsDetailed treats empty/whitespace as empty object', t => {
	t.deepEqual(parseToolArgumentsDetailed(''), {ok: true, args: {}});
	t.deepEqual(parseToolArgumentsDetailed('   \n\t  '), {
		ok: true,
		args: {},
	});
});

test('parseToolArgumentsDetailed repairs concatenated objects by taking the first', t => {
	const result = parseToolArgumentsDetailed('{"a":1}{"b":2}');
	t.true(result.ok);
	if (result.ok) {
		t.deepEqual(result.args, {a: 1});
		t.true(result.repaired);
	}
});

test('parseToolArgumentsDetailed returns ok:false for completely invalid JSON', t => {
	const result = parseToolArgumentsDetailed('not-json');
	t.false(result.ok);
	if (!result.ok) {
		t.regex(result.error, /invalid tool arguments json/i);
		t.is(result.rawPreview, 'not-json');
	}
});

test('parseToolArgumentsDetailed repairs trailing commas via parseJsonWithFix', t => {
	const result = parseToolArgumentsDetailed('{"a":1,}');
	t.true(result.ok);
	if (result.ok) {
		t.deepEqual(result.args, {a: 1});
		t.true(result.repaired);
	}
});

test('safeParseToolArguments stays soft and returns {} on total failure', t => {
	t.deepEqual(safeParseToolArguments('not-json'), {});
	t.deepEqual(safeParseToolArguments('{"a":1}{"b":2}'), {a: 1});
	t.deepEqual(safeParseToolArguments(''), {});
});
