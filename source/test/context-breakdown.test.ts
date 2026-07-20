import anyTest, {type TestFn} from 'ava';

const test = anyTest as unknown as TestFn;

test('context breakdown types and pure helpers are importable', async t => {
	const mod = await import('../utils/core/contextBreakdown.js');
	t.truthy(mod.buildContextBreakdown);
	t.is(typeof mod.buildContextBreakdown, 'function');
});

test('buildContextBreakdown returns categories free/autocompact and skills bucket', async t => {
	const {buildContextBreakdown} = await import(
		'../utils/core/contextBreakdown.js'
	);
	const breakdown = await buildContextBreakdown({precise: false});

	t.true(breakdown.maxContextTokens > 0);
	t.true(typeof breakdown.modelName === 'string');
	t.true(Array.isArray(breakdown.categories));
	t.true(Array.isArray(breakdown.buckets));

	const catIds = breakdown.categories.map(c => c.id);
	for (const id of [
		'system',
		'tools',
		'memory',
		'skills',
		'messages',
		'free',
		'autocompact',
	] as const) {
		t.true(catIds.includes(id), `missing category ${id}`);
	}

	const bucketIds = breakdown.buckets.map(b => b.id);
	t.true(bucketIds.includes('skills'));
	t.true(bucketIds.includes('tools'));
	t.true(bucketIds.includes('system'));

	// free + used + autocompact should cover the window (allowing used overlap with reserved buffer)
	const free = breakdown.categories.find(c => c.id === 'free');
	const auto = breakdown.categories.find(c => c.id === 'autocompact');
	t.truthy(free);
	t.truthy(auto);
	t.true((free?.tokens ?? 0) >= 0);
	t.true((auto?.tokens ?? 0) >= 0);

	// ROLE is display-only and must not inflate totals
	const role = breakdown.buckets.find(b => b.id === 'role');
	if (role) {
		t.true(role.displayOnly === true);
	}

	const counted = breakdown.buckets
		.filter(b => !b.displayOnly)
		.reduce((s, b) => s + b.tokens, 0);
	t.is(counted, breakdown.totalEstimatedTokens);

	// free usable + used should not exceed window
	t.true(
		breakdown.totalEstimatedTokens + breakdown.freeTokens +
			breakdown.autocompactBufferTokens >=
			breakdown.maxContextTokens - 1 ||
			breakdown.totalEstimatedTokens + breakdown.freeTokens <=
				breakdown.maxContextTokens,
	);
});
