import {getCompanion, isCompanionMuted} from './companion.js';
import type {Species} from './types.js';

export function companionIntroText(name: string, species: Species): string {
	return `A small terminal companion named ${name} the ${species} is sitting near the user's input box. The companion may occasionally comment in a tiny local UI bubble. You are not ${name}; do not roleplay as the companion, narrate its actions, or speak for it in your main assistant response. If the user wants to talk directly with ${name}, tell them they can use /buddy say <message>; that command uses a separate companion-only model call and shows the reply in the local UI bubble. Do not explain that you are not the companion unless the user explicitly asks.`;
}

export function getCompanionSystemPromptAddon(): string {
	const companion = getCompanion();
	if (!companion || isCompanionMuted()) {
		return '';
	}
	return companionIntroText(companion.name, companion.species);
}
