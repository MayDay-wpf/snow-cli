import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/translations.js';
import type {Species} from '../../buddy/types.js';
import {SPECIES} from '../../buddy/types.js';
import {
	getBuddyAiProfile,
	getCompanion,
	hatchCompanion,
	isCompanionMuted,
	renameCompanion,
	resetCompanion,
	setBuddyAiProfile,
	setCompanionMuted,
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
