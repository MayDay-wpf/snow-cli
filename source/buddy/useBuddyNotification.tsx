import {useEffect} from 'react';
import {getCurrentLanguage} from '../utils/config/languageConfig.js';
import {translations} from '../i18n/translations.js';
import {getCompanion, isCompanionMuted} from './companion.js';
import {companionReaction} from './companionEvents.js';

const TEASER_START = Date.UTC(2026, 3, 1, 0, 0, 0);
const TEASER_END = Date.UTC(2026, 3, 8, 0, 0, 0);
const LIVE_START = Date.UTC(2026, 3, 1, 0, 0, 0);

export function isBuddyTeaserWindow(now = Date.now()): boolean {
	return now >= TEASER_START && now < TEASER_END;
}

export function isBuddyLive(now = Date.now()): boolean {
	return now >= LIVE_START;
}

export function findBuddyTriggerPositions(text: string): number[] {
	const positions: number[] = [];
	const pattern = /\/buddy\b/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(text)) !== null) {
		positions.push(match.index);
	}
	return positions;
}

export function useBuddyNotification(): void {
	useEffect(() => {
		if (getCompanion() || !isBuddyTeaserWindow() || isCompanionMuted()) {
			return;
		}
		const timer = setTimeout(() => {
			const t =
				translations[getCurrentLanguage()].commandPanel.commandOutput.buddy;
			companionReaction(t.teaser);
		}, 1200);
		return () => clearTimeout(timer);
	}, []);
}
