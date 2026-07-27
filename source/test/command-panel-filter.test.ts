import anyTest, {type TestFn} from 'ava';

import {
	BUILTIN_COMMAND_META,
	filterAndRankCommands,
	findExactMatchIndex,
	scoreCommandMatch,
	MATCH_TIER,
	resolveCommandMeta,
	matchesAbbreviation,
	cycleCategoryFilter,
	type MatchableCommand,
} from '../utils/commands/commandMatch.js';

const test = anyTest as unknown as TestFn;

function cmd(
	name: string,
	description = `${name} command`,
	extra: Partial<MatchableCommand> = {},
): MatchableCommand {
	const meta = resolveCommandMeta(name);
	return {
		name,
		description,
		category: meta.category,
		rankBoost: meta.rankBoost,
		...extra,
	};
}

const samplePool: MatchableCommand[] = [
	cmd('help'),
	cmd('models'),
	cmd('mcp'),
	cmd('hybrid-compress'),
	cmd('image-compress'),
	cmd('compact'),
	cmd('tool-display'),
	cmd('deepresearch'),
	cmd('games'),
	cmd('my-custom', 'user script', {
		category: 'custom',
		rankBoost: 10,
	}),
];

test('empty query returns frequent-only and stays short', t => {
	const ranked = filterAndRankCommands(samplePool, '');
	t.true(ranked.every(c => c.category === 'frequent'));
	t.false(ranked.some(c => c.name === 'hybrid-compress'));
	t.false(ranked.some(c => c.name === 'deepresearch'));
	t.false(ranked.some(c => c.name === 'games'));
	t.true(ranked.some(c => c.name === 'models'));
	t.true(ranked.length <= 20);
});

test('non-empty query searches full set including advanced', t => {
	const ranked = filterAndRankCommands(samplePool, 'hybrid');
	t.true(ranked.some(c => c.name === 'hybrid-compress'));
});

test('exact match ranks first for /models', t => {
	const ranked = filterAndRankCommands(samplePool, 'models');
	t.is(ranked[0]?.name, 'models');
	t.is(scoreCommandMatch(cmd('models'), 'models'), MATCH_TIER.exact);
});

test('prefix mod ranks models highly via boost', t => {
	const ranked = filterAndRankCommands(samplePool, 'mod');
	t.is(ranked[0]?.name, 'models');
});

test('boundary match hits tool-display for display', t => {
	const ranked = filterAndRankCommands(samplePool, 'display');
	t.true(ranked.some(c => c.name === 'tool-display'));
	t.is(scoreCommandMatch(cmd('tool-display'), 'display'), MATCH_TIER.boundary);
});

test('usage count breaks ties within same tier and boost', t => {
	// Same rankBoost (100) + same prefix tier → higher usage wins.
	const usage = (name: string) => (name === 'mcp' ? 50 : 0);
	const pool = [cmd('mcp'), cmd('models'), cmd('compact')];
	const ranked = filterAndRankCommands(pool, 'm', usage);
	t.is(ranked[0]?.name, 'mcp');
	t.true(ranked.map(c => c.name).includes('models'));
});

test('findExactMatchIndex finds case-insensitive exact', t => {
	const ranked = filterAndRankCommands(samplePool, 'mod');
	const idx = findExactMatchIndex(ranked, 'models');
	// models is in list under mod prefix
	t.true(idx >= 0);
	t.is(ranked[idx]?.name, 'models');
	t.is(findExactMatchIndex(ranked, 'nope'), -1);
});

test('custom commands participate in query search', t => {
	const ranked = filterAndRankCommands(samplePool, 'my-cus');
	t.true(ranked.some(c => c.name === 'my-custom'));
});

test('builtin meta covers frequent core commands', t => {
	for (const name of ['help', 'clear', 'models', 'plan', 'yolo']) {
		t.is(BUILTIN_COMMAND_META[name]?.category, 'frequent');
	}
	t.is(resolveCommandMeta('hybrid-compress').category, 'settings');
	t.is(resolveCommandMeta('deepresearch').category, 'advanced');
	t.is(resolveCommandMeta('user-x', true).category, 'custom');
});

test('abbreviation td matches tool-display', t => {
	t.true(matchesAbbreviation('tool-display', 'td'));
	t.is(scoreCommandMatch(cmd('tool-display'), 'td'), MATCH_TIER.abbreviation);
	const ranked = filterAndRankCommands(samplePool, 'td');
	t.true(ranked.some(c => c.name === 'tool-display'));
});

test('abbreviation hc matches hybrid-compress', t => {
	t.true(matchesAbbreviation('hybrid-compress', 'hc'));
	const ranked = filterAndRankCommands(samplePool, 'hc');
	t.true(ranked.some(c => c.name === 'hybrid-compress'));
});

test('empty query keeps pinned frequent ahead of recent', t => {
	const ranked = filterAndRankCommands(samplePool, '', () => 0, {
		categoryFilter: 'frequent',
		recentNames: ['deepresearch', 'games'],
		getLastUsed: name =>
			name === 'deepresearch' ? 200 : name === 'games' ? 100 : 0,
	});
	t.true(['help', 'models', 'mcp', 'compact'].includes(ranked[0]?.name ?? ''));
	t.true(ranked.some(c => c.name === 'deepresearch'));
	t.true(ranked.some(c => c.name === 'games'));
	t.true(ranked.some(c => c.name === 'models'));
	t.true(ranked.length <= 20);
});

test('category filter shows settings on empty query', t => {
	const ranked = filterAndRankCommands(samplePool, '', () => 0, {
		categoryFilter: 'settings',
	});
	t.true(ranked.every(c => c.category === 'settings'));
	t.true(ranked.some(c => c.name === 'hybrid-compress'));
	t.false(ranked.some(c => c.name === 'models'));
});

test('all category shows every command on empty query', t => {
	const ranked = filterAndRankCommands(samplePool, '', () => 0, {
		categoryFilter: 'all',
	});
	t.is(ranked.length, samplePool.length);
	t.true(ranked.some(c => c.name === 'hybrid-compress'));
	t.true(ranked.some(c => c.name === 'deepresearch'));
	t.true(ranked.some(c => c.name === 'games'));
	t.true(ranked.some(c => c.name === 'my-custom'));
});

test('default empty query uses frequent (not all)', t => {
	const ranked = filterAndRankCommands(samplePool, '');
	t.true(ranked.every(c => c.category === 'frequent'));
	t.false(ranked.some(c => c.name === 'hybrid-compress'));
});

test('cycleCategoryFilter wraps around with all last', t => {
	t.is(cycleCategoryFilter('frequent', 1), 'settings');
	t.is(cycleCategoryFilter('custom', 1), 'all');
	t.is(cycleCategoryFilter('all', 1), 'frequent');
	t.is(cycleCategoryFilter('frequent', -1), 'all');
});
