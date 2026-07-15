import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/translations.js';
import type {CompanionStat, Species} from '../../buddy/types.js';
import {COMPANION_STATS, EYES, HATS, SPECIES} from '../../buddy/types.js';
import {
	getBuddyAiProfile,
	getCompanion,
	hatchCompanion,
	isCompanionMuted,
	renameCompanion,
	resetCompanion,
	setBuddyAiProfile,
	setCompanionMuted,
	updateCompanion,
	type CompanionUpdate,
} from '../../buddy/companion.js';
import {getActiveProfileName, getAllProfiles} from '../config/configManager.js';
import {
	generateBuddyPetReply,
	generateBuddyReply,
	getCompanionHatchGreeting,
} from '../../buddy/buddyAi.js';
import {
	companionPetAt,
	companionReaction,
	companionRefresh,
} from '../../buddy/companionEvents.js';

type BuddyTranslations =
	(typeof translations.en.commandPanel.commandOutput)['buddy'];

function buddyTranslations(): BuddyTranslations {
	return translations[getCurrentLanguage()].commandPanel.commandOutput.buddy;
}

function formatTemplate(
	template: string,
	values: Record<string, string | number>,
): string {
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
		template,
	);
}

function currentBuddyProfileName(): string {
	return getBuddyAiProfile() || getActiveProfileName();
}

const YELLOW_STAR = '\u001B[33m★\u001B[39m';

function formatStatStars(value: number): string {
	return YELLOW_STAR.repeat(Math.max(0, value));
}

function formatCompanionStatus(): string {
	const t = buddyTranslations();
	const companion = getCompanion();
	if (!companion) {
		return t.noCompanion;
	}

	const muted = isCompanionMuted();
	const stats = Object.entries(companion.stats)
		.map(([name, value]) => `${name}: ${formatStatStars(value)}`)
		.join('\n');

	return [
		formatTemplate(t.statusLine, {
			name: companion.name,
			shiny: companion.shiny ? t.shinyPrefix : '',
			rarity: companion.rarity,
			species: companion.species,
		}),
		`${t.personalityLabel}: ${companion.personality}`,
		`${t.hatLabel}: ${companion.hat}`,
		`${t.eyeLabel}: ${companion.eye}`,
		`${t.mutedLabel}: ${muted ? t.mutedYes : t.mutedNo}`,
		`${t.profileLabel}: ${currentBuddyProfileName()}`,
		`${t.hatchedLabel}: ${new Date(companion.hatchedAt).toLocaleString()}`,
		`${t.statsLabel}:`,
		stats,
	].join('\n');
}

function formatProfileList(): string {
	const t = buddyTranslations();
	const currentProfile = currentBuddyProfileName();
	const activeProfile = getActiveProfileName();
	const items = getAllProfiles().map(profile =>
		formatTemplate(t.profileListItem, {
			marker: profile.name === currentProfile ? '*' : ' ',
			name: profile.name,
			active: profile.name === activeProfile ? t.currentProfileLabel : '',
		}),
	);

	return [
		formatTemplate(t.profileListTitle, {profile: currentProfile}),
		...items,
	].join('\n');
}

function speciesList(): string {
	return SPECIES.join(', ');
}

function isSpecies(value: string): value is Species {
	return SPECIES.includes(value as Species);
}

function isCompanionStat(value: string): value is CompanionStat {
	return COMPANION_STATS.includes(value as CompanionStat);
}

function parseBooleanFlag(
	value: string,
): {ok: true; value: boolean} | {ok: false; error: string} {
	const normalized = value.trim().toLowerCase();
	if (['true', '1', 'yes', 'on'].includes(normalized)) {
		return {ok: true, value: true};
	}
	if (['false', '0', 'no', 'off'].includes(normalized)) {
		return {ok: true, value: false};
	}
	return {
		ok: false,
		error: `Invalid boolean "${value}". Use true|false|on|off.`,
	};
}

function takeOptionValue(
	args: string,
	marker: string,
): {value?: string; remainder: string} {
	const index = args.indexOf(marker);
	if (index === -1) {
		return {remainder: args};
	}

	const before = args.slice(0, index).trimEnd();
	const after = args.slice(index + marker.length);
	if (after.startsWith('"')) {
		const endQuote = after.indexOf('"', 1);
		if (endQuote === -1) {
			return {
				value: after.slice(1).trim(),
				remainder: before,
			};
		}
		const value = after.slice(1, endQuote);
		const rest = `${before} ${after.slice(endQuote + 1)}`.trim();
		return {value, remainder: rest};
	}

	const match = after.match(/^(\S+)/);
	const value = match?.[1];
	const rest = `${before} ${after.slice(value?.length ?? 0)}`.trim();
	return {value, remainder: rest};
}

function parseSetArgs(args: string): {
	updates: CompanionUpdate;
	errors: string[];
	showOptions: boolean;
	hasAny: boolean;
} {
	let remainder = args.trim();
	const updates: CompanionUpdate = {};
	const errors: string[] = [];
	let showOptions = false;
	let hasAny = false;

	const listFlags = ['--list', '--options', 'list', 'options'];
	const tokens = remainder.split(/\s+/).filter(Boolean);
	if (tokens.some(token => listFlags.includes(token.toLowerCase()))) {
		showOptions = true;
		remainder = tokens
			.filter(token => !listFlags.includes(token.toLowerCase()))
			.join(' ');
	}

	const extract = (marker: string): string | undefined => {
		const extracted = takeOptionValue(remainder, marker);
		remainder = extracted.remainder;
		return extracted.value;
	};

	const name = extract('--name=');
	if (name !== undefined) {
		hasAny = true;
		updates.name = name;
	}

	const personality = extract('--personality=');
	if (personality !== undefined) {
		hasAny = true;
		updates.personality = personality;
	}

	const species = extract('--species=');
	if (species !== undefined) {
		hasAny = true;
		updates.species = species.trim().toLowerCase();
	}

	const hat = extract('--hat=');
	if (hat !== undefined) {
		hasAny = true;
		updates.hat = hat.trim().toLowerCase();
	}

	const eye = extract('--eye=');
	if (eye !== undefined) {
		hasAny = true;
		updates.eye = eye.trim();
	}

	const rarity = extract('--rarity=');
	if (rarity !== undefined) {
		hasAny = true;
		updates.rarity = rarity.trim().toLowerCase();
	}

	const shiny = extract('--shiny=');
	if (shiny !== undefined) {
		hasAny = true;
		const parsed = parseBooleanFlag(shiny);
		if (!parsed.ok) {
			errors.push(parsed.error);
		} else {
			updates.shiny = parsed.value;
		}
	}

	const stats: Partial<Record<CompanionStat, number>> = {};
	for (const stat of COMPANION_STATS) {
		const value = extract(`--${stat.toLowerCase()}=`);
		if (value === undefined) {
			continue;
		}
		hasAny = true;
		const numeric = Number(value);
		if (!Number.isFinite(numeric)) {
			errors.push(`Invalid --${stat.toLowerCase()}=${value}. Expected 1-10.`);
			continue;
		}
		stats[stat] = numeric;
	}

	// Support compact form: hat=crown eye=✦ rarity=legendary
	for (const part of remainder.split(/\s+/).filter(Boolean)) {
		const eq = part.indexOf('=');
		if (eq <= 0) {
			errors.push(`Unknown option "${part}".`);
			continue;
		}
		const key = part.slice(0, eq).trim().toLowerCase();
		const value = part.slice(eq + 1).trim();
		if (!value) {
			errors.push(`Empty value for "${key}".`);
			continue;
		}
		hasAny = true;
		if (key === 'name') {
			updates.name = value;
			continue;
		}
		if (key === 'personality') {
			updates.personality = value;
			continue;
		}
		if (key === 'species') {
			updates.species = value.toLowerCase();
			continue;
		}
		if (key === 'hat') {
			updates.hat = value.toLowerCase();
			continue;
		}
		if (key === 'eye') {
			updates.eye = value;
			continue;
		}
		if (key === 'rarity') {
			updates.rarity = value.toLowerCase();
			continue;
		}
		if (key === 'shiny') {
			const parsed = parseBooleanFlag(value);
			if (!parsed.ok) {
				errors.push(parsed.error);
			} else {
				updates.shiny = parsed.value;
			}
			continue;
		}
		const statKey = key.toUpperCase();
		if (isCompanionStat(statKey)) {
			const numeric = Number(value);
			if (!Number.isFinite(numeric)) {
				errors.push(`Invalid ${key}=${value}. Expected 1-10.`);
			} else {
				stats[statKey] = numeric;
			}
			continue;
		}
		errors.push(`Unknown option "${part}".`);
	}

	if (Object.keys(stats).length > 0) {
		updates.stats = stats;
	}

	return {updates, errors, showOptions, hasAny};
}

function formatSetOptions(): string {
	const t = buddyTranslations();
	return [
		t.setOptionsTitle,
		formatTemplate(t.setOptionsHats, {hats: HATS.join(', ')}),
		formatTemplate(t.setOptionsEyes, {eyes: EYES.join(' ')}),
		formatTemplate(t.setOptionsRarities, {
			rarities: 'common, uncommon, rare, epic, legendary',
		}),
		formatTemplate(t.setOptionsSpecies, {species: SPECIES.join(', ')}),
		formatTemplate(t.setOptionsStats, {stats: COMPANION_STATS.join(', ')}),
	].join('\n');
}

function parseHatchArgs(args: string): {
	name?: string;
	personality?: string;
	species?: string;
	showSpeciesList: boolean;
} {
	const result: {
		name?: string;
		personality?: string;
		species?: string;
		showSpeciesList: boolean;
	} = {showSpeciesList: false};
	const personalityMarker = '--personality=';
	const markerIndex = args.indexOf(personalityMarker);
	const optionText = (
		markerIndex === -1 ? args : args.slice(0, markerIndex)
	).trim();
	const personality =
		markerIndex === -1
			? undefined
			: args.slice(markerIndex + personalityMarker.length).trim();
	const nameParts: string[] = [];

	for (const part of optionText.split(/\s+/).filter(Boolean)) {
		if (part === '--list-species' || part === '--species=list') {
			result.showSpeciesList = true;
			continue;
		}

		if (part.startsWith('--species=')) {
			result.species = part.slice('--species='.length).trim().toLowerCase();
			continue;
		}

		nameParts.push(part);
	}

	const name = nameParts.join(' ').trim();
	if (name) {
		result.name = name;
	}

	if (personality) {
		result.personality = personality;
	}

	return result;
}

registerCommand('buddy', {
	execute: async (args?: string): Promise<CommandResult> => {
		const t = buddyTranslations();
		const rawArgs = args?.trim() ?? '';
		const [subcommand = 'status', ...rest] = rawArgs
			.split(/\s+/)
			.filter(Boolean);
		const remainder = rest.join(' ');

		if (subcommand === 'hatch') {
			const {name, personality, species, showSpeciesList} =
				parseHatchArgs(remainder);

			if (showSpeciesList) {
				return {
					success: true,
					message: formatTemplate(t.availableSpecies, {
						species: speciesList(),
					}),
				};
			}

			if (species && !isSpecies(species)) {
				return {
					success: true,
					message: formatTemplate(t.invalidSpecies, {
						species,
						available: speciesList(),
					}),
				};
			}

			if (getCompanion()) {
				return {
					success: true,
					message: formatTemplate(t.alreadyExists, {
						status: formatCompanionStatus(),
					}),
				};
			}

			const selectedSpecies =
				species && isSpecies(species) ? species : undefined;
			const companion = hatchCompanion(name, personality, selectedSpecies);
			const hatchGreeting = getCompanionHatchGreeting(companion);
			setCompanionMuted(false);
			companionReaction(hatchGreeting);
			companionRefresh();
			return {
				success: true,
				message: [
					formatTemplate(t.hatchedSummary, {
						name: companion.name,
						rarity: companion.rarity,
						species: companion.species,
					}),
					hatchGreeting,
					t.hatchKeepChatting,
				].join('\n'),
			};
		}

		if (subcommand === 'pet') {
			const companion = getCompanion();
			if (!companion) {
				return {
					success: true,
					message: t.noBuddyToPet,
				};
			}

			companionPetAt();
			companionReaction(formatTemplate(t.petReaction, {name: companion.name}));
			void generateBuddyPetReply(companion)
				.then(reply => {
					companionPetAt();
					companionReaction(reply);
				})
				.catch(() => {});

			return {
				success: true,
				message: formatTemplate(t.petSuccess, {name: companion.name}),
			};
		}

		if (subcommand === 'rename') {
			const companion = getCompanion();
			if (!companion) {
				return {
					success: true,
					message: t.noBuddyToRename,
				};
			}

			const newName = remainder.trim();
			if (!newName) {
				return {
					success: true,
					message: t.renameUsage,
				};
			}

			const renamedCompanion = renameCompanion(newName) ?? companion;
			companionRefresh();
			companionReaction(
				formatTemplate(t.renameReaction, {
					oldName: companion.name,
					newName: renamedCompanion.name,
				}),
			);
			return {
				success: true,
				message: formatTemplate(t.renameSuccess, {
					oldName: companion.name,
					newName: renamedCompanion.name,
				}),
			};
		}

		if (subcommand === 'set' || subcommand === 'customize') {
			const companion = getCompanion();
			if (!companion) {
				return {
					success: true,
					message: t.noBuddyToSet,
				};
			}

			const parsed = parseSetArgs(remainder);
			if (parsed.showOptions) {
				return {
					success: true,
					message: formatSetOptions(),
				};
			}
			if (parsed.errors.length > 0) {
				return {
					success: false,
					message: parsed.errors.join('\n'),
				};
			}
			if (!parsed.hasAny) {
				return {
					success: true,
					message: t.setUsage,
				};
			}

			const result = updateCompanion(parsed.updates);
			if (!result.ok) {
				return {
					success: false,
					message: result.error,
				};
			}

			companionRefresh();
			companionReaction(
				formatTemplate(t.setReaction, {
					name: result.companion.name,
					changed: result.changed.join(', '),
				}),
			);
			return {
				success: true,
				message: [
					formatTemplate(t.setSuccess, {
						name: result.companion.name,
						changed: result.changed.join(', '),
					}),
					formatCompanionStatus(),
				].join('\n'),
			};
		}

		if (subcommand === 'say') {
			const companion = getCompanion();
			if (!companion) {
				return {
					success: true,
					message: t.noBuddyToTalk,
				};
			}
			if (!remainder.trim()) {
				return {
					success: true,
					message: t.sayUsage,
				};
			}
			const reply = await generateBuddyReply(companion, remainder);
			companionReaction(reply);
			return {
				success: true,
				message: `${companion.name}: ${reply}`,
			};
		}

		if (subcommand === 'profile') {
			const requestedProfile = remainder.trim();
			if (!requestedProfile || requestedProfile === 'list') {
				return {
					success: true,
					message: formatProfileList(),
				};
			}

			if (requestedProfile === 'current') {
				return {
					success: true,
					message: formatTemplate(t.profileListTitle, {
						profile: currentBuddyProfileName(),
					}),
				};
			}

			if (requestedProfile === 'default' || requestedProfile === 'reset') {
				setBuddyAiProfile(undefined);
				return {
					success: true,
					message: formatTemplate(t.profileCleared, {
						profile: getActiveProfileName(),
					}),
				};
			}

			const profile = getAllProfiles().find(
				item => item.name === requestedProfile,
			);
			if (!profile) {
				return {
					success: false,
					message: formatTemplate(t.profileNotFound, {
						profile: requestedProfile,
					}),
				};
			}

			setBuddyAiProfile(profile.name);
			return {
				success: true,
				message: formatTemplate(t.profileSet, {profile: profile.name}),
			};
		}

		if (subcommand === 'mute') {
			setCompanionMuted(true);
			companionRefresh();
			return {
				success: true,
				message: t.muted,
			};
		}

		if (subcommand === 'unmute') {
			setCompanionMuted(false);
			companionRefresh();
			companionReaction(t.unmutedReaction);
			return {
				success: true,
				message: t.unmuted,
			};
		}

		if (subcommand === 'status' || subcommand === '') {
			return {
				success: true,
				message: formatCompanionStatus(),
			};
		}

		if (subcommand === 'reset') {
			resetCompanion();
			setCompanionMuted(false);
			companionRefresh();
			return {
				success: true,
				message: t.reset,
			};
		}

		return {
			success: true,
			message: t.usage,
		};
	},
});

export default {};
