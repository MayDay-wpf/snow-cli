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
import {
	COMPANION_NAMED_COLORS,
	COMPANION_STATS,
	EYES,
	HATS,
	SPECIES,
} from './types.js';

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
	if (typeof value !== 'string') {
		return false;
	}
	const eye = value.trim();
	if (!eye) {
		return false;
	}
	// Presets or freeform 1–2 Unicode characters (no whitespace/control).
	if (EYES.includes(eye as never) || eye === '-') {
		return true;
	}
	if (/\s/u.test(eye) || /[\u0000-\u001F\u007F]/u.test(eye)) {
		return false;
	}
	const chars = Array.from(eye);
	return chars.length >= 1 && chars.length <= 2;
}

function isValidHat(value: unknown): boolean {
	return typeof value === 'string' && HATS.includes(value as never);
}

function normalizeCompanionColor(
	value: string,
): {ok: true; value: string} | {ok: false; error: string} {
	const trimmed = value.trim();
	if (
		!trimmed ||
		['default', 'auto', 'none', 'clear', 'reset', 'off'].includes(
			trimmed.toLowerCase(),
		)
	) {
		return {ok: true, value: ''};
	}

	if (trimmed.startsWith('#')) {
		const hex = trimmed.slice(1);
		if (/^[0-9a-fA-F]{3}$/.test(hex) || /^[0-9a-fA-F]{6}$/.test(hex)) {
			return {ok: true, value: `#${hex.toLowerCase()}`};
		}
		return {
			ok: false,
			error: `Invalid color "${trimmed}". Use #RGB / #RRGGBB or a named color.`,
		};
	}

	const named = COMPANION_NAMED_COLORS.find(
		color => color.toLowerCase() === trimmed.toLowerCase(),
	);
	if (named) {
		return {ok: true, value: named};
	}

	return {
		ok: false,
		error: `Invalid color "${trimmed}". Available: ${COMPANION_NAMED_COLORS.join(
			', ',
		)}, or #RGB/#RRGGBB, or default`,
	};
}
function isValidCompanionColor(value: unknown): boolean {
	if (typeof value !== 'string') {
		return false;
	}
	const parsed = normalizeCompanionColor(value);
	// Reset tokens normalize to empty and must not be stored as a color.
	return parsed.ok && parsed.value !== '';
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
	const colorOk =
		candidate.color === undefined ||
		(typeof candidate.color === 'string' &&
			isValidCompanionColor(candidate.color));

	return (
		typeof candidate.name === 'string' &&
		typeof candidate.personality === 'string' &&
		typeof candidate.hatchedAt === 'number' &&
		isValidRarity(candidate.rarity) &&
		isValidSpecies(candidate.species) &&
		isValidEye(candidate.eye) &&
		isValidHat(candidate.hat) &&
		typeof candidate.shiny === 'boolean' &&
		isValidStats(candidate.stats) &&
		colorOk
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

export type CompanionUpdate = {
	name?: string;
	personality?: string;
	species?: string;
	eye?: string;
	hat?: string;
	rarity?: string;
	shiny?: boolean;
	/** Named color / #hex, or empty/default/clear to reset. */
	color?: string | null;
	stats?: Partial<CompanionStats>;
};

export type UpdateCompanionResult =
	| {ok: true; companion: Companion; changed: string[]}
	| {
			ok: false;
			code: 'NOT_FOUND' | 'INVALID_ARGS' | 'NO_CHANGES';
			error: string;
	  };

export function updateCompanion(
	updates: CompanionUpdate,
): UpdateCompanionResult {
	const companion = getStoredCompanion();
	if (!companion) {
		return {
			ok: false,
			code: 'NOT_FOUND',
			error: 'No buddy has hatched yet.',
		};
	}

	const next: StoredCompanion = {...companion, stats: {...companion.stats}};
	const changed: string[] = [];

	if (updates.name !== undefined) {
		const name = updates.name.trim();
		if (!name) {
			return {
				ok: false,
				code: 'INVALID_ARGS',
				error: 'Name cannot be empty.',
			};
		}
		if (name !== next.name) {
			next.name = name;
			changed.push('name');
		}
	}

	if (updates.personality !== undefined) {
		const personality = updates.personality.trim();
		if (!personality) {
			return {
				ok: false,
				code: 'INVALID_ARGS',
				error: 'Personality cannot be empty.',
			};
		}
		if (personality !== next.personality) {
			next.personality = personality;
			changed.push('personality');
		}
	}

	if (updates.species !== undefined) {
		if (!isValidSpecies(updates.species)) {
			return {
				ok: false,
				code: 'INVALID_ARGS',
				error: `Invalid species "${updates.species}". Available: ${SPECIES.join(
					', ',
				)}`,
			};
		}
		if (updates.species !== next.species) {
			next.species = updates.species as Species;
			changed.push('species');
		}
	}

	if (updates.eye !== undefined) {
		const eye = updates.eye.trim();
		if (!isValidEye(eye)) {
			return {
				ok: false,
				code: 'INVALID_ARGS',
				error: `Invalid eye "${updates.eye}". Use a preset (${EYES.join(
					' ',
				)}) or 1–2 characters.`,
			};
		}
		if (eye !== next.eye) {
			next.eye = eye;
			changed.push('eye');
		}
	}

	if (updates.hat !== undefined) {
		if (!isValidHat(updates.hat)) {
			return {
				ok: false,
				code: 'INVALID_ARGS',
				error: `Invalid hat "${updates.hat}". Available: ${HATS.join(', ')}`,
			};
		}
		if (updates.hat !== next.hat) {
			next.hat = updates.hat as Companion['hat'];
			changed.push('hat');
		}
	}

	if (updates.rarity !== undefined) {
		if (!isValidRarity(updates.rarity)) {
			return {
				ok: false,
				code: 'INVALID_ARGS',
				error: `Invalid rarity "${updates.rarity}". Available: common, uncommon, rare, epic, legendary`,
			};
		}
		if (updates.rarity !== next.rarity) {
			next.rarity = updates.rarity as Rarity;
			changed.push('rarity');
		}
	}

	if (updates.shiny !== undefined) {
		if (updates.shiny !== next.shiny) {
			next.shiny = updates.shiny;
			changed.push('shiny');
		}
	}

	if (updates.color !== undefined) {
		if (updates.color === null) {
			if (next.color !== undefined) {
				delete next.color;
				changed.push('color');
			}
		} else {
			const parsed = normalizeCompanionColor(updates.color);
			if (!parsed.ok) {
				return {
					ok: false,
					code: 'INVALID_ARGS',
					error: parsed.error,
				};
			}
			if (!parsed.value) {
				if (next.color !== undefined) {
					delete next.color;
					changed.push('color');
				}
			} else if (parsed.value !== next.color) {
				next.color = parsed.value;
				changed.push('color');
			}
		}
	}

	if (updates.stats) {
		for (const stat of COMPANION_STATS) {
			const value = updates.stats[stat];
			if (value === undefined) {
				continue;
			}
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				return {
					ok: false,
					code: 'INVALID_ARGS',
					error: `Invalid stats.${stat}: expected a number.`,
				};
			}
			const normalized = Math.max(1, Math.min(10, Math.round(value)));
			if (normalized !== next.stats[stat]) {
				next.stats[stat] = normalized;
				if (!changed.includes('stats')) {
					changed.push('stats');
				}
			}
		}
	}

	if (changed.length === 0) {
		return {
			ok: false,
			code: 'NO_CHANGES',
			error: 'No valid changes provided.',
		};
	}

	if (!isStoredCompanion(next)) {
		return {
			ok: false,
			code: 'INVALID_ARGS',
			error: 'Updated companion failed validation.',
		};
	}

	saveCompanion(next);
	return {ok: true, companion: next, changed};
}

export function resetCompanion(): void {
	saveCompanion(undefined);
}
