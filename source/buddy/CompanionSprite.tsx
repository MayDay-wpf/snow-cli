import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text} from 'ink';
import stringWidth from 'string-width';
import {getCompanion, isCompanionMuted} from './companion.js';
import {companionEvents} from './companionEvents.js';
import {
	renderFace,
	renderPetSprite,
	renderSprite,
	speciesColor,
	spriteFrameCount,
} from './sprites.js';
import type {Companion} from './types.js';

const TICK_MS = 500;
const BUBBLE_SHOW = 20;
const FADE_WINDOW = 6;
const PET_BURST_MS = 2500;
const MIN_COLS_FOR_FULL_SPRITE = 64;
const MAX_RESERVED_COLUMNS = 30;
const SPEAKING_RESERVED_COLUMNS = 18;
const DIALOGUE_MAX_WIDTH = 36;
const IDLE_SEQUENCE = [0, 0, 0, 0, 1, 0, 0, 0, -1, 0, 0, 2, 0, 0, 0];
const PET_SEQUENCE = [2, 1, 0, 1, 2, 0];

function textWidth(value: string): number {
	return stringWidth(value);
}

function maxLineWidth(lines: string[]): number {
	return lines.reduce((max, line) => Math.max(max, textWidth(line)), 0);
}

function padRight(value: string, width: number): string {
	return `${value}${' '.repeat(Math.max(0, width - textWidth(value)))}`;
}

function wrapText(value: string, maxWidth: number): string[] {
	const normalized = value.trim().replace(/\s+/g, ' ');
	if (!normalized) {
		return [];
	}

	const lines: string[] = [];
	let current = '';

	for (const word of normalized.split(' ')) {
		if (textWidth(word) > maxWidth) {
			if (current) {
				lines.push(current);
				current = '';
			}

			let chunk = '';
			for (const character of word) {
				const nextChunk = `${chunk}${character}`;
				if (chunk && textWidth(nextChunk) > maxWidth) {
					lines.push(chunk);
					chunk = character;
				} else {
					chunk = nextChunk;
				}
			}

			if (chunk) {
				current = chunk;
			}

			continue;
		}

		const next = current ? `${current} ${word}` : word;
		if (textWidth(next) > maxWidth) {
			lines.push(current);
			current = word;
		} else {
			current = next;
		}
	}

	if (current) {
		lines.push(current);
	}

	return lines;
}

function renderDialogueBox(value: string, maxWidth: number): string[] {
	const contentLines = wrapText(value, maxWidth);
	if (contentLines.length === 0) {
		return [];
	}

	const contentWidth = Math.max(...contentLines.map(line => textWidth(line)));
	const horizontal = '─'.repeat(contentWidth + 2);

	return [
		`┌${horizontal}┐`,
		...contentLines.map(line => `│ ${padRight(line, contentWidth)} │`),
		`└${horizontal}┘`,
	];
}

function getBubbleText(
	reaction: string | undefined,
	tick: number,
): string | undefined {
	if (!reaction) {
		return undefined;
	}
	const age = tick % BUBBLE_SHOW;
	if (age >= BUBBLE_SHOW) {
		return undefined;
	}
	return reaction;
}

export function companionReservedColumns(
	terminalColumns: number,
	speaking = false,
): number {
	const companion = getCompanion();
	if (
		!companion ||
		isCompanionMuted() ||
		terminalColumns < MIN_COLS_FOR_FULL_SPRITE
	) {
		return 0;
	}
	const spriteWidth = maxLineWidth(renderSprite(companion, 0));
	const nameWidth = textWidth(companion.name) + 2;
	const bubbleWidth = speaking ? SPEAKING_RESERVED_COLUMNS : 0;
	return Math.min(
		MAX_RESERVED_COLUMNS,
		Math.max(spriteWidth, nameWidth, bubbleWidth) + 2,
	);
}

interface CompanionSpriteProps {
	terminalColumns: number;
}

export function CompanionSprite({
	terminalColumns,
}: CompanionSpriteProps): React.ReactElement | null {
	const [tick, setTick] = useState(0);
	const [reaction, setReaction] = useState<string | undefined>(undefined);
	const [reactionStartedAt, setReactionStartedAt] = useState(0);
	const [petAt, setPetAt] = useState<number | undefined>(undefined);
	const [companion, setCompanion] = useState<Companion | undefined>(() =>
		getCompanion(),
	);

	useEffect(() => {
		const timer = setInterval(() => setTick(value => value + 1), TICK_MS);
		return () => clearInterval(timer);
	}, []);

	useEffect(() => {
		return companionEvents.onChange(payload => {
			if (payload.refresh) {
				setCompanion(getCompanion());
			}
			if (payload.reaction !== undefined) {
				setReaction(payload.reaction);
				setReactionStartedAt(Date.now());
			}
			if (payload.petAt !== undefined) {
				setPetAt(payload.petAt);
			}
		});
	}, []);

	const muted = isCompanionMuted();
	const now = Date.now();
	const isPetting = petAt !== undefined && now - petAt < PET_BURST_MS;
	const petFrame = PET_SEQUENCE[tick % PET_SEQUENCE.length] ?? 0;
	const frameLines = useMemo(() => {
		if (!companion) {
			return [];
		}
		const frameCount = spriteFrameCount(companion.species);
		if (isPetting) {
			return renderPetSprite(
				{...companion, eye: companion.eye === '✦' ? '◉' : '✦'},
				petFrame % frameCount,
			);
		}
		const sequenceFrame = IDLE_SEQUENCE[tick % IDLE_SEQUENCE.length] ?? 0;
		if (sequenceFrame === -1) {
			return renderSprite({...companion, eye: '-'}, 0);
		}
		return renderSprite(companion, sequenceFrame % frameCount);
	}, [companion, isPetting, petFrame, tick]);

	if (!companion || muted) {
		return null;
	}

	const bubbleAgeTicks = Math.floor((now - reactionStartedAt) / TICK_MS);
	const visibleReaction =
		reaction && bubbleAgeTicks < BUBBLE_SHOW ? reaction : undefined;
	const fade = visibleReaction && bubbleAgeTicks >= BUBBLE_SHOW - FADE_WINDOW;
	const spriteWidth = Math.max(
		maxLineWidth(frameLines),
		textWidth(companion.name),
	);
	const companionColor = companion.shiny
		? 'yellow'
		: speciesColor(companion.species);

	if (terminalColumns < MIN_COLS_FOR_FULL_SPRITE) {
		return (
			<Box marginLeft={1}>
				<Text color={isPetting ? 'yellow' : companionColor}>
					{renderFace(isPetting ? {...companion, eye: '✦'} : companion)}
				</Text>
			</Box>
		);
	}

	const reservedColumns = companionReservedColumns(terminalColumns, false);
	const dialogueMaxWidth = Math.min(
		DIALOGUE_MAX_WIDTH,
		terminalColumns - reservedColumns - 4,
	);
	const dialogueLines =
		visibleReaction && dialogueMaxWidth >= 20
			? renderDialogueBox(visibleReaction, dialogueMaxWidth)
			: [];

	return (
		<Box width="100%" justifyContent="flex-end">
			<Box flexDirection="row" alignItems="flex-end" flexShrink={0}>
				{dialogueLines.length > 0 && (
					<Box flexDirection="column" marginRight={2} flexShrink={0}>
						{dialogueLines.map((line, index) => (
							<Text key={`${index}-${line}`} color={fade ? 'gray' : 'cyan'}>
								{line}
							</Text>
						))}
					</Box>
				)}
				<Box flexDirection="column" width={reservedColumns} flexShrink={0}>
					<Box flexDirection="column">
						{frameLines.map((line, index) => (
							<Text
								key={`${index}-${line}`}
								color={isPetting ? 'yellow' : companionColor}
							>
								{line}
							</Text>
						))}
					</Box>
					<Box width={spriteWidth} justifyContent="center">
						<Text color="gray">{companion.name}</Text>
					</Box>
				</Box>
			</Box>
		</Box>
	);
}

export function CompanionFloatingBubble(): React.ReactElement | null {
	const [reaction, setReaction] = useState<string | undefined>(undefined);
	useEffect(() => {
		return companionEvents.onChange(payload => {
			if (payload.reaction !== undefined) {
				setReaction(payload.reaction);
			}
		});
	}, []);

	const companion = getCompanion();
	const bubbleText = getBubbleText(reaction, 0);
	if (!companion || !bubbleText || isCompanionMuted()) {
		return null;
	}
	return (
		<Box>
			<Text color="cyan">{`${companion.name}: ${bubbleText}`}</Text>
		</Box>
	);
}
