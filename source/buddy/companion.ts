import {randomUUID} from 'crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
import {loadConfig, saveConfig} from '../utils/config/apiConfig.js';
import type {AppConfig} from '../utils/config/apiConfig.js';
import type {
	Companion,
	CompanionBones,
	CompanionStats,
	Rarity,
	Species,
	StoredCompanion,
} from './types.js';
import {COMPANION_STATS, EYES, HATS, SPECIES} from './types.js';

const SALT = 'snow-cli-buddy-v1';
const BUDDY_STATE_VERSION = 1;
const CONFIG_DIR = join(homedir(), '.snow');
const BUDDY_STATE_FILE = join(CONFIG_DIR, 'buddy.json');

interface BuddyState {
	version: number;
	companion?: StoredCompanion;
	muted?: boolean;
	aiProfile?: string;
}

const RARITY_WEIGHTS: Array<[Rarity, number]> = [
	['common', 60],
	['uncommon', 25],
	['rare', 10],
	['epic', 4],
	['legendary', 1],
];

const DEFAULT_NAMES = [
	'Pebble',
	'Noodle',
	'Pixel',
	'Mochi',
	'Biscuit',
	'Waffle',
	'Pip',
	'Tofu',
	'Bean',
	'Juniper',
	'Sprout',
	'Orbit',
];

const DEFAULT_PERSONALITIES = [
	'curious, loyal, and gently chaotic',
	'patient, observant, and fond of tiny victories',
	'snarky in a warm way, especially around bugs',
	'calm under pressure and suspicious of flaky tests',
	'playful, brave, and easily impressed by good refactors',
	'quietly wise and very interested in terminal output',
];

export function mulberry32(seed: number): () => number {
	let value = seed >>> 0;
	return () => {
		value += 0x6d2b79f5;
		let t = value;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function hashString(value: string): number {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function ensureBuddyDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

function roll<T>(items: T[], random: () => number): T {
	return items[Math.floor(random() * items.length)] ?? items[0]!;
}

function rollRarity(random: () => number): Rarity {
	const total = RARITY_WEIGHTS.reduce((sum, [, weight]) => sum + weight, 0);
	let cursor = random() * total;
	for (const [rarity, weight] of RARITY_WEIGHTS) {
		cursor -= weight;
		if (cursor <= 0) {
			return rarity;
		}
	}
	return 'common';
}

function rollStats(random: () => number): CompanionStats {
	return COMPANION_STATS.reduce((stats, stat) => {
		stats[stat] = 1 + Math.floor(random() * 10);
		return stats;
	}, {} as CompanionStats);
}

function isValidRarity(value: unknown): value is Rarity {
	return (
		value === 'common' ||
		value === 'uncommon' ||
		value === 'rare' ||
		value === 'epic' ||
		value === 'legendary'
	);
}

function isValidSpecies(value: unknown): value is Species {
	return typeof value === 'string' && SPECIES.includes(value as Species);
}

function isValidEye(value: unknown): boolean {
	return typeof value === 'string' && EYES.includes(value as never);
}

function isValidHat(value: unknown): boolean {
	return typeof value === 'string' && HATS.includes(value as never);
}

function isValidStats(value: unknown): value is CompanionStats {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const stats = value as Partial<Record<keyof CompanionStats, unknown>>;
	return COMPANION_STATS.every(stat => typeof stats[stat] === 'number');
}

function isStoredCompanion(value: unknown): value is StoredCompanion {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<StoredCompanion>;
	return (
		typeof candidate.name === 'string' &&
		typeof candidate.personality === 'string' &&
		typeof candidate.hatchedAt === 'number' &&
		isValidRarity(candidate.rarity) &&
		isValidSpecies(candidate.species) &&
		isValidEye(candidate.eye) &&
		isValidHat(candidate.hat) &&
		typeof candidate.shiny === 'boolean' &&
		isValidStats(candidate.stats)
	);
}

function readBuddyStateFile(): BuddyState {
	ensureBuddyDirectory();
	if (!existsSync(BUDDY_STATE_FILE)) {
		return {version: BUDDY_STATE_VERSION};
	}
	try {
		const parsed = JSON.parse(
			readFileSync(BUDDY_STATE_FILE, 'utf8'),
		) as Partial<BuddyState>;
		const aiProfile =
			typeof parsed.aiProfile === 'string' && parsed.aiProfile.trim()
				? parsed.aiProfile.trim()
				: undefined;
		return {
			version: parsed.version ?? BUDDY_STATE_VERSION,
			companion: isStoredCompanion(parsed.companion)
				? parsed.companion
				: undefined,
			muted: Boolean(parsed.muted),
			aiProfile,
		};
	} catch {
		return {version: BUDDY_STATE_VERSION};
	}
}

function writeBuddyStateFile(state: BuddyState): void {
	ensureBuddyDirectory();
	writeFileSync(
		BUDDY_STATE_FILE,
		JSON.stringify({...state, version: BUDDY_STATE_VERSION}, null, 2),
		'utf8',
	);
}

function legacyCompanionFromConfig(): StoredCompanion | undefined {
	const legacy = loadConfig().companion;
	if (!legacy) {
		return undefined;
	}
	if (isStoredCompanion(legacy)) {
		return legacy;
	}
	const partial = legacy as Partial<StoredCompanion>;
	if (
		typeof partial.name !== 'string' ||
		typeof partial.personality !== 'string' ||
		typeof partial.hatchedAt !== 'number'
	) {
		return undefined;
	}
	return {
		...rollWithSeed(`${companionUserId()}:${partial.hatchedAt}`),
		name: partial.name,
		personality: partial.personality,
		hatchedAt: partial.hatchedAt,
	};
}

function loadBuddyState(): BuddyState {
	const state = readBuddyStateFile();
	if (state.companion) {
		return state;
	}
	const legacyCompanion = legacyCompanionFromConfig();
	if (!legacyCompanion) {
		return state;
	}
	const migratedState: BuddyState = {
		version: BUDDY_STATE_VERSION,
		companion: legacyCompanion,
		muted: Boolean(loadConfig().companionMuted),
	};
	writeBuddyStateFile(migratedState);
	return migratedState;
}

function saveBuddyState(state: BuddyState): void {
	writeBuddyStateFile(state);
}

export function companionUserId(): string {
	const config = loadConfig() as AppConfig & {
		userID?: string;
		oauthAccount?: {accountUuid?: string};
	};
	return (
		config.oauthAccount?.accountUuid ||
		config.userID ||
		process.env['USERNAME'] ||
		process.env['USER'] ||
		'anon'
	);
}

export function rollWithSeed(seed: string): CompanionBones {
	const random = mulberry32(hashString(`${SALT}:${seed}`));
	const rarity = rollRarity(random);
	return {
		rarity,
		species: roll(SPECIES, random),
		eye: roll(EYES, random),
		hat: rarity === 'common' && random() < 0.75 ? 'none' : roll(HATS, random),
		shiny: random() < (rarity === 'legendary' ? 0.12 : 0.025),
		stats: rollStats(random),
	};
}

export function createDefaultCompanion(species?: Species): StoredCompanion {
	const hatchedAt = Date.now();
	const seed = `${companionUserId()}:${hatchedAt}:${randomUUID()}`;
	const random = mulberry32(hashString(`${SALT}:soul:${seed}`));
	const bones = rollWithSeed(seed);
	return {
		...bones,
		species: species ?? bones.species,
		name: roll(DEFAULT_NAMES, random),
		personality: roll(DEFAULT_PERSONALITIES, random),
		hatchedAt,
	};
}

export function getStoredCompanion(): StoredCompanion | undefined {
	return loadBuddyState().companion;
}

export function getCompanion(): Companion | undefined {
	return getStoredCompanion();
}

export function isCompanionMuted(): boolean {
	return Boolean(loadBuddyState().muted);
}

export function getBuddyAiProfile(): string | undefined {
	return loadBuddyState().aiProfile;
}

export function setBuddyAiProfile(profileName: string | undefined): void {
	const state = loadBuddyState();
	const trimmedProfileName = profileName?.trim();
	if (trimmedProfileName) {
		state.aiProfile = trimmedProfileName;
	} else {
		delete state.aiProfile;
	}
	saveBuddyState(state);
}

export function saveCompanion(companion: StoredCompanion | undefined): void {
	const state = loadBuddyState();
	if (companion) {
		state.companion = companion;
	} else {
		delete state.companion;
	}
	saveBuddyState(state);

	const config = loadConfig();
	delete config.companion;
	saveConfig(config);
}

export function setCompanionMuted(muted: boolean): void {
	const state = loadBuddyState();
	state.muted = muted;
	saveBuddyState(state);

	const config = loadConfig();
	delete config.companionMuted;
	saveConfig(config);
}

export function hatchCompanion(
	name?: string,
	personality?: string,
	species?: Species,
): Companion {
	const stored = createDefaultCompanion(species);
	const trimmedName = name?.trim();
	const trimmedPersonality = personality?.trim();
	const finalStored: StoredCompanion = {
		...stored,
		name: trimmedName || stored.name,
		personality: trimmedPersonality || stored.personality,
	};
	saveCompanion(finalStored);
	return finalStored;
}

export function renameCompanion(name: string): Companion | undefined {
	const companion = getStoredCompanion();
	const trimmedName = name.trim();
	if (!companion || !trimmedName) {
		return companion;
	}

	const renamedCompanion: StoredCompanion = {
		...companion,
		name: trimmedName,
	};
	saveCompanion(renamedCompanion);
	return renamedCompanion;
}

export function resetCompanion(): void {
	saveCompanion(undefined);
}
