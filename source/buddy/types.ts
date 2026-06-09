export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export const duck = 'duck';
export const goose = 'goose';
export const blob = 'blob';
export const chicken = 'chicken';
export const basketball = 'basketball';
export const cat = 'cat';
export const dragon = 'dragon';
export const octopus = 'octopus';
export const owl = 'owl';
export const penguin = 'penguin';
export const turtle = 'turtle';
export const snail = 'snail';
export const ghost = 'ghost';
export const axolotl = 'axolotl';
export const capybara = 'capybara';
export const cactus = 'cactus';
export const robot = 'robot';
export const rabbit = 'rabbit';
export const mushroom = 'mushroom';
export const chonk = 'chonk';
export const fox = 'fox';
export const panda = 'panda';
export const raccoon = 'raccoon';
export const unicorn = 'unicorn';
export const whale = 'whale';
export const hamster = 'hamster';
export const teapot = 'teapot';
export const rocket = 'rocket';
export const laptop = 'laptop';
export const moon = 'moon';
export const cloud = 'cloud';
export const lantern = 'lantern';
export const treasure = 'treasure';
export const book = 'book';
export const star = 'star';
export const coffee = 'coffee';
export const snowman = 'snowman';

export type Species =
	| typeof duck
	| typeof goose
	| typeof blob
	| typeof chicken
	| typeof basketball
	| typeof cat
	| typeof dragon
	| typeof octopus
	| typeof owl
	| typeof penguin
	| typeof turtle
	| typeof snail
	| typeof ghost
	| typeof axolotl
	| typeof capybara
	| typeof cactus
	| typeof robot
	| typeof rabbit
	| typeof mushroom
	| typeof chonk
	| typeof fox
	| typeof panda
	| typeof raccoon
	| typeof unicorn
	| typeof whale
	| typeof hamster
	| typeof teapot
	| typeof rocket
	| typeof laptop
	| typeof moon
	| typeof cloud
	| typeof lantern
	| typeof treasure
	| typeof book
	| typeof star
	| typeof coffee
	| typeof snowman;

export type Eye = '·' | '✦' | '×' | '◉' | '@' | '°' | '-';

export type Hat =
	| 'none'
	| 'crown'
	| 'tophat'
	| 'propeller'
	| 'halo'
	| 'wizard'
	| 'beanie'
	| 'tinyduck'
	| 'pirate'
	| 'flower'
	| 'bucket'
	| 'party'
	| 'visor';

export type CompanionStat =
	| 'DEBUGGING'
	| 'PATIENCE'
	| 'CHAOS'
	| 'WISDOM'
	| 'SNARK';

export type CompanionStats = Record<CompanionStat, number>;

export interface CompanionBones {
	rarity: Rarity;
	species: Species;
	eye: Eye;
	hat: Hat;
	shiny: boolean;
	stats: CompanionStats;
}

export interface CompanionSoul {
	name: string;
	personality: string;
}

export interface Companion extends CompanionBones, CompanionSoul {
	hatchedAt: number;
}

export interface StoredCompanion extends Companion {}

export const SPECIES: Species[] = [
	duck,
	goose,
	blob,
	chicken,
	basketball,
	cat,
	dragon,
	octopus,
	owl,
	penguin,
	turtle,
	snail,
	ghost,
	axolotl,
	capybara,
	cactus,
	robot,
	rabbit,
	mushroom,
	chonk,
	fox,
	panda,
	raccoon,
	unicorn,
	whale,
	hamster,
	teapot,
	rocket,
	laptop,
	moon,
	cloud,
	lantern,
	treasure,
	book,
	star,
	coffee,
	snowman,
];

export const EYES: Eye[] = ['·', '✦', '×', '◉', '@', '°'];

export const HATS: Hat[] = [
	'none',
	'crown',
	'tophat',
	'propeller',
	'halo',
	'wizard',
	'beanie',
	'tinyduck',
	'pirate',
	'flower',
	'bucket',
	'party',
	'visor',
];

export const COMPANION_STATS: CompanionStat[] = [
	'DEBUGGING',
	'PATIENCE',
	'CHAOS',
	'WISDOM',
	'SNARK',
];
