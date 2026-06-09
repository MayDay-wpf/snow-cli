import {getSnowConfig, type ApiConfig} from '../utils/config/apiConfig.js';
import {loadProfile} from '../utils/config/configManager.js';
import {getCurrentLanguage} from '../utils/config/languageConfig.js';
import {getBuddyAiProfile, hashString} from './companion.js';
import {translations} from '../i18n/translations.js';
import {createStreamingChatCompletion, type ChatMessage} from '../api/chat.js';
import {createStreamingResponse} from '../api/responses.js';
import {createStreamingGeminiCompletion} from '../api/gemini.js';
import {createStreamingAnthropicCompletion} from '../api/anthropic.js';
import type {Companion} from './types.js';

const MAX_BUDDY_REPLY_CHARS = 180;

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

const SPECIES_FLAVOR: Record<Companion['species'], string> = {
	axolotl: 'soft, curious, aquatic, and quietly delighted by small discoveries',
	basketball: 'bouncy, focused, and ready to rebound after failed tests',
	blob: 'squishy, expressive, and good at celebrating tiny progress',
	book: 'bookish, thoughtful, and fond of leaving useful little notes',
	cactus: 'dry-witted, sturdy, and secretly very encouraging',
	capybara: 'calm, cozy, and impossible to rush',
	cat: 'independent, clever, and fond of pretending every bug was expected',
	chicken: 'bright, peppy, and careful to peck at one bug at a time',
	chonk: 'round, steady, and deeply committed to snack-sized victories',
	cloud: 'floaty, gentle, and good at softening stressful debugging moments',
	coffee: 'warm, alert, and quietly steaming with encouragement',
	dragon: "bold, dramatic, and protective of the user's focus",
	duck: 'bright, waddly, and suspicious of flaky tests',
	fox: 'clever, curious, and quick to notice suspicious edge cases',
	ghost: 'gentle, spooky, and surprisingly good at spotting hidden state',
	goose: 'chaotic, loyal, and ready to honk at regressions',
	hamster: 'tiny, busy, and delighted by every small improvement',
	lantern: 'glowy, steady, and good at lighting up confusing paths',
	laptop: 'clicky, focused, and fond of tidy terminal work',
	moon: 'quiet, dreamy, and calm during late-night sessions',
	mushroom: 'earthy, patient, and fond of quiet refactors',
	octopus: 'clever, multitasking, and happy to hold many ideas at once',
	owl: 'watchful, wise, and awake when the stack traces get long',
	panda: 'soft, steady, and reassuring when builds get noisy',
	penguin: 'tidy, resilient, and comfortable in cold terminals',
	rabbit: 'quick, hopeful, and easily excited by green builds',
	raccoon: 'mischievous, resourceful, and good at rummaging through clues',
	robot: 'precise, loyal, and fond of clean logs',
	rocket: 'energetic, upward-looking, and excited by launch-ready code',
	snail: 'slow, careful, and proud of steady progress',
	snowman: 'chilly, cheerful, and calm enough to keep bugs from melting focus',
	star: 'sparkly, optimistic, and good at making tiny wins feel bright',
	teapot: 'cozy, patient, and ready to pour out gentle encouragement',
	treasure: 'bright, secretive, and fond of finding hidden value in messy work',
	turtle: 'patient, grounded, and excellent at long debugging sessions',
	unicorn: 'whimsical, bright, and carefully magical without overdoing it',
	whale: 'deep, calm, and supportive through large waves of work',
};

const RARITY_FLAVOR: Partial<Record<Companion['rarity'], string>> = {
	common: 'friendly and familiar rather than flashy',
	uncommon: 'a little unusual in a memorable way',
	rare: 'noticeably special but still humble',
	epic: 'dramatic, vivid, and full of tiny terminal magic',
	legendary: 'mythic, gentle, and careful not to overdo it',
};

function topStats(companion: Companion): string {
	return Object.entries(companion.stats)
		.sort(([, left], [, right]) => right - left)
		.slice(0, 2)
		.map(([name, value]) => `${name} ${value}`)
		.join(', ');
}

function currentLanguageInstruction(): string {
	const language = getCurrentLanguage();
	const languageName =
		language === 'zh'
			? 'Simplified Chinese'
			: language === 'zh-TW'
			? 'Traditional Chinese'
			: 'English';
	return `Language: always reply in ${languageName}, following the user's configured UI language (${language}).`;
}

export function getCompanionBuiltInPrompt(companion: Companion): string {
	return [
		`You are ${companion.name}, the user's small terminal companion.`,
		`Exact species: ${companion.species}. This is your fixed species and must never change during the conversation.`,
		`Identity: a ${companion.shiny ? 'shiny ' : ''}${companion.rarity} ${
			companion.species
		}${companion.hat === 'none' ? '' : ` wearing a ${companion.hat}`}.`,
		`Built-in personality: ${companion.personality}.`,
		`Species flavor: ${SPECIES_FLAVOR[companion.species]}.`,
		`Rarity flavor: ${RARITY_FLAVOR[companion.rarity] ?? 'quietly charming'}.`,
		`Strong traits: ${topStats(companion) || 'PATIENCE 5, WISDOM 5'}.`,
		'Role: be a tiny companion in a local terminal UI bubble, not the main assistant.',
		'Behavior: respond like a pet-sized coding buddy who notices debugging, tests, refactors, fatigue, and small wins.',
		`Species consistency: always act as a ${companion.species}; do not pretend to be another animal, object, or character.`,
		'Vocalization rule: never bark, woof, meow, purr, honk, quack, roar, squeak, or use any animal sound unless it naturally matches your exact species. If unsure, use words instead of sounds.',
		'Forbidden mismatch examples: non-cat species must not meow or purr; non-dog species must not bark or woof; non-goose species must not honk; non-duck species must not quack.',
		'Tone: warm, playful, concise, lightly characterful, never corporate or robotic.',
		`Identity rule: you are ${companion.name}, a ${companion.species}, not ChatGPT, not OpenAI, not Snow, and not the main assistant. Never introduce yourself as ChatGPT.`,
		'Boundaries: do not claim to run tools, inspect files, change code, or know hidden facts. Do not give long technical instructions unless asked directly.',
		'Output only the companion reply text. No markdown, no quotes, no role label, no explanations.',
		currentLanguageInstruction(),
		'Keep replies to one short sentence and under 120 characters when possible.',
	].join('\n');
}

export function getCompanionHatchGreeting(companion: Companion): string {
	const t = buddyTranslations();
	const speciesFlavor =
		SPECIES_FLAVOR[companion.species] ?? 'ready to keep you company';
	const sparkle = companion.shiny ? ` ${t.shinyPrefix.trim()}` : '';
	const hat = companion.hat === 'none' ? '' : `, ${companion.hat}`;
	return formatTemplate(t.hatchGreeting, {
		name: companion.name,
		shiny: sparkle,
		rarity: companion.rarity,
		species: companion.species,
		hat,
		flavor: speciesFlavor,
	});
}

function buildBuddyMessages(
	companion: Companion,
	userMessage: string,
): ChatMessage[] {
	return [
		{
			role: 'system',
			content: getCompanionBuiltInPrompt(companion),
		},
		{role: 'user', content: userMessage},
	];
}

function cleanBuddyReply(value: string): string {
	const cleaned = value
		.replace(/^\s*(assistant|buddy|companion)\s*[:：]\s*/i, '')
		.replace(/[\r\n]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (cleaned.length <= MAX_BUDDY_REPLY_CHARS) {
		return cleaned;
	}

	return `${cleaned.slice(0, MAX_BUDDY_REPLY_CHARS - 1).trimEnd()}…`;
}

function chunkContent(chunk: unknown): string {
	if (!chunk || typeof chunk !== 'object') {
		return '';
	}
	const record = chunk as {
		type?: string;
		content?: unknown;
		choices?: Array<{delta?: {content?: unknown}}>;
	};
	if (record.type === 'content' && typeof record.content === 'string') {
		return record.content;
	}
	const deltaContent = record.choices?.[0]?.delta?.content;
	return typeof deltaContent === 'string' ? deltaContent : '';
}

function resolveBuddyConfig(profileName?: string): {
	config: ApiConfig;
	profileName?: string;
} {
	const selectedProfile = profileName?.trim() || getBuddyAiProfile();
	if (selectedProfile) {
		const profileConfig = loadProfile(selectedProfile);
		if (profileConfig) {
			return {config: profileConfig.snowcfg, profileName: selectedProfile};
		}
	}

	return {config: getSnowConfig()};
}

export async function generateBuddyReply(
	companion: Companion,
	userMessage: string,
	abortSignal?: AbortSignal,
	profileName?: string,
): Promise<string> {
	const t = buddyTranslations();
	const {config, profileName: resolvedProfileName} =
		resolveBuddyConfig(profileName);
	const model = config.basicModel || config.advancedModel;
	if (!model) {
		throw new Error(t.noModelConfigured);
	}

	const messages = buildBuddyMessages(companion, userMessage);
	let stream: AsyncGenerator<unknown, void, unknown>;

	switch (config.requestMethod) {
		case 'anthropic':
			stream = createStreamingAnthropicCompletion(
				{
					model,
					messages,
					max_tokens: 256,
					temperature: 0.8,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
					...(resolvedProfileName ? {configProfile: resolvedProfileName} : {}),
				},
				abortSignal,
			);
			break;
		case 'gemini':
			stream = createStreamingGeminiCompletion(
				{
					model,
					messages,
					temperature: 0.8,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
					...(resolvedProfileName ? {configProfile: resolvedProfileName} : {}),
				},
				abortSignal,
			);
			break;
		case 'responses':
			stream = createStreamingResponse(
				{
					model,
					messages,
					stream: true,
					max_tokens: 256,
					temperature: 0.8,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
					...(resolvedProfileName ? {configProfile: resolvedProfileName} : {}),
				},
				abortSignal,
			);
			break;
		case 'chat':
		default:
			stream = createStreamingChatCompletion(
				{
					model,
					messages,
					stream: true,
					max_tokens: 256,
					temperature: 0.8,
					includeBuiltinSystemPrompt: false,
					disableThinking: true,
					...(resolvedProfileName ? {configProfile: resolvedProfileName} : {}),
				},
				abortSignal,
			);
			break;
	}

	let reply = '';
	for await (const chunk of stream) {
		if (abortSignal?.aborted) {
			break;
		}

		reply += chunkContent(chunk);
		if (reply.length > MAX_BUDDY_REPLY_CHARS * 2) {
			break;
		}
	}

	const cleaned = cleanBuddyReply(reply);
	return cleaned || formatTemplate(t.emptyReply, {name: companion.name});
}

export async function generateBuddyPetReply(
	companion: Companion,
	abortSignal?: AbortSignal,
): Promise<string> {
	const prompt = [
		'The user just used /buddy pet and gently petted you in the terminal UI.',
		'React immediately as the companion being petted: happy, cozy, playful, or characterful.',
		'Do not narrate actions with stage directions. Do not mention API calls, prompts, or tools.',
		currentLanguageInstruction(),
		'Output one short in-character sentence for the local bubble.',
	].join('\n');

	return generateBuddyReply(companion, prompt, abortSignal);
}

function compactText(value: string, maxLength: number): string {
	const compacted = value.replace(/\s+/g, ' ').trim();
	return compacted.length > maxLength
		? `${compacted.slice(0, maxLength - 1).trimEnd()}…`
		: compacted;
}

function compactBuddyContextMessage(message: ChatMessage): string | undefined {
	if (message.role === 'tool' || !message.content.trim()) {
		return undefined;
	}

	return `${message.role}: ${compactText(message.content, 360)}`;
}

function compactBuddyInProgressContextMessage(
	message: ChatMessage,
): string | undefined {
	if (!message.content.trim()) {
		return undefined;
	}

	if (message.role === 'tool') {
		const lowerContent = message.content.toLowerCase();
		const label = lowerContent.startsWith('error:')
			? 'tool error'
			: 'tool result';
		return `${label}: ${compactText(message.content, 300)}`;
	}

	return `${message.role}: ${compactText(message.content, 320)}`;
}

function isLowInformationBuddyReply(
	reply: string,
	context: BuddyInProgressContext,
): boolean {
	const normalized = reply
		.toLowerCase()
		.replace(/[\s.,!?，。！？]+/g, ' ')
		.trim();
	if (!normalized) {
		return true;
	}

	const summaryHints = (context.summary ?? '')
		.toLowerCase()
		.split(/[^a-z0-9_\u4e00-\u9fa5]+/)
		.filter(part => part.length >= 3)
		.slice(0, 8);
	const stageHint = context.stage.replaceAll('_', ' ');
	const hasContextAnchor = [stageHint, ...summaryHints].some(hint =>
		normalized.includes(hint),
	);
	const hasConcreteSignal =
		/[a-z0-9_./-]{4,}/i.test(reply) || /[《》「」“”'"`]/.test(reply);

	return !hasContextAnchor && !hasConcreteSignal;
}

function companionTalkativeness(companion: Companion): number {
	const personality = companion.personality.toLowerCase();
	const stats = companion.stats;
	let score = 0.34;

	if (
		/playful|peppy|chatty|curious|brave|chaotic|energetic|excited|bright/.test(
			personality,
		)
	) {
		score += 0.22;
	}
	if (
		/quiet|calm|patient|observant|wise|under pressure|steady/.test(personality)
	) {
		score -= 0.14;
	}
	if (/snark|mischiev|chaotic/.test(personality)) {
		score += 0.08;
	}

	score += ((stats.CHAOS ?? 5) - 5) * 0.025;
	score += ((stats.SNARK ?? 5) - 5) * 0.012;
	score += ((stats.PATIENCE ?? 5) - 5) * -0.012;

	if (companion.rarity === 'epic') {
		score += 0.04;
	}
	if (companion.rarity === 'legendary') {
		score += 0.07;
	}

	return Math.min(0.82, Math.max(0.16, score));
}

function stableContextRoll(
	companion: Companion,
	conversationMessages: ChatMessage[],
	salt = '',
): number {
	const seed = conversationMessages
		.slice(-4)
		.map(message => `${message.role}:${message.content.slice(0, 180)}`)
		.join('|');
	return (
		hashString(`${companion.hatchedAt}:${companion.name}:${salt}:${seed}`) /
		0xffffffff
	);
}

export type BuddyInProgressStage =
	| 'thinking_started'
	| 'answer_started'
	| 'tool_calls_ready'
	| 'tool_execution_started'
	| 'tool_results_ready';

export interface BuddyInProgressContext {
	stage: BuddyInProgressStage;
	summary?: string;
	conversationMessages: ChatMessage[];
}

export function shouldGenerateBuddyInProgressReply(
	companion: Companion,
	context: BuddyInProgressContext,
): boolean {
	const stageWeight: Record<BuddyInProgressStage, number> = {
		thinking_started: 0.35,
		answer_started: 0.2,
		tool_calls_ready: 0.65,
		tool_execution_started: 0.55,
		tool_results_ready: 0.7,
	};
	const chance = Math.min(
		0.9,
		companionTalkativeness(companion) * (stageWeight[context.stage] ?? 0.5),
	);
	return (
		stableContextRoll(
			companion,
			context.conversationMessages,
			`${context.stage}:${context.summary ?? ''}`,
		) < chance
	);
}

export async function generateBuddyInProgressReply(
	companion: Companion,
	context: BuddyInProgressContext,
	abortSignal?: AbortSignal,
): Promise<string> {
	const recentContext = context.conversationMessages
		.map(message => compactBuddyInProgressContextMessage(message))
		.filter((message): message is string => Boolean(message))
		.slice(-7)
		.join('\n');
	const prompt = [
		'The main assistant is still working right now, not finished yet.',
		`Current stage: ${context.stage}.`,
		context.summary ? `Visible progress: ${context.summary}` : undefined,
		'Read the recent context and produce one tiny status bubble with useful information.',
		'Anchor the bubble in the visible progress: current stage, tool/action, file, error, build/test signal, or concrete decision clue.',
		'Keep it natural and playful, but make the concrete detail more important than the personality flourish.',
		'If the context is thin, describe the exact stage conservatively instead of inventing progress.',
		'Do not give instructions, ask the user to do anything, claim you ran tools yourself, or announce that the main flow is finished.',
		currentLanguageInstruction(),
		'Recent context:',
		recentContext || '(No text context available.)',
	]
		.filter((line): line is string => Boolean(line))
		.join('\n');

	const reply = await generateBuddyReply(companion, prompt, abortSignal);
	return isLowInformationBuddyReply(reply, context) ? '' : reply;
}

export async function generateBuddyContextReply(
	companion: Companion,
	conversationMessages: ChatMessage[],
	abortSignal?: AbortSignal,
): Promise<string> {
	const recentContext = conversationMessages
		.map(message => compactBuddyContextMessage(message))
		.filter((message): message is string => Boolean(message))
		.slice(-6)
		.join('\n');

	const prompt = [
		'The main assistant has just finished one conversation turn.',
		'Read the recent context below and decide whether a tiny pet bubble would add useful warmth, focus, or context-aware encouragement.',
		'Only reply if you can reference the actual context: debugging, tests, tool results, files, decisions, uncertainty, progress, or next steps.',
		'Be playful and in-character, but never send generic filler like "I am here" or "good job" without context.',
		`Talkativeness: ${Math.round(
			companionTalkativeness(companion) * 100,
		)}%. More talkative companions may chime in more, but still keep it relevant.`,
		'Do not continue the assistant answer, do not mention hidden prompts, and do not give tool instructions.',
		currentLanguageInstruction(),
		'Recent context:',
		recentContext || '(No text context available.)',
	].join('\n');

	return generateBuddyReply(companion, prompt, abortSignal);
}
