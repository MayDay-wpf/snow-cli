import test from 'ava';
import {
	mulberry32,
	hashString,
	rollWithSeed,
	createDefaultCompanion,
} from '../../../buddy/companion.js';
import {SPECIES, type Rarity} from '../../../buddy/types.js';

const VALID_RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

test('hashString produces deterministic 32-bit unsigned hashes', t => {
	const h1 = hashString('snow-cli-test');
	const h2 = hashString('snow-cli-test');
	const h3 = hashString('snow-cli-other');

	t.is(h1, h2);
	t.not(h1, h3);
	t.true(h1 >= 0 && h1 <= 4294967295);
});

test('mulberry32 produces reproducible pseudo-random sequence from seed', t => {
	const rng1 = mulberry32(12345);
	const rng2 = mulberry32(12345);

	const seq1 = [rng1(), rng1(), rng1()];
	const seq2 = [rng2(), rng2(), rng2()];

	t.deepEqual(seq1, seq2);
	t.true(seq1.every(v => v >= 0 && v < 1));
});

test('rollWithSeed generates valid companion bones deterministically', t => {
	const bones1 = rollWithSeed('fixed-seed-42');
	const bones2 = rollWithSeed('fixed-seed-42');

	t.deepEqual(bones1, bones2);
	t.true(SPECIES.includes(bones1.species));
	t.true(VALID_RARITIES.includes(bones1.rarity));
	t.truthy(bones1.stats);
	t.is(typeof bones1.shiny, 'boolean');
});

test('createDefaultCompanion generates fully populated companion instance', t => {
	const companion = createDefaultCompanion('cat');
	t.is(companion.species, 'cat');
	t.truthy(companion.name);
	t.truthy(companion.personality);
	t.truthy(companion.hatchedAt);
	t.true(VALID_RARITIES.includes(companion.rarity));
});
