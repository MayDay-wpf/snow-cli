import anyTest, {type TestFn} from 'ava';
import {
	clearPlanStrictnessOverride,
	getPlanStrictness,
	setPlanStrictnessOverride,
	withPlanStrictness,
} from '../utils/config/projectSettings.js';

const test = anyTest as unknown as TestFn;

test.afterEach.always(() => {
	clearPlanStrictnessOverride();
});

test('planStrictness override takes precedence over disk/default', t => {
	setPlanStrictnessOverride('strict');
	t.is(getPlanStrictness(), 'strict');

	setPlanStrictnessOverride('off');
	t.is(getPlanStrictness(), 'off');
});

test('clearPlanStrictnessOverride restores non-override path', t => {
	setPlanStrictnessOverride('strict');
	t.is(getPlanStrictness(), 'strict');
	clearPlanStrictnessOverride();
	const value = getPlanStrictness();
	t.true(value === 'strict' || value === 'soft' || value === 'off');
});

test('withPlanStrictness restores previous override', async t => {
	setPlanStrictnessOverride('soft');
	await withPlanStrictness('strict', async () => {
		t.is(getPlanStrictness(), 'strict');
	});
	t.is(getPlanStrictness(), 'soft');
});
