/**
 * Headless handlers for session/slash control plane (issue #190).
 * Prefer shared config/domain APIs over TUI-only actions.
 */

import {
	getCompanion,
	hatchCompanion,
	isCompanionMuted,
	renameCompanion,
	resetCompanion,
	setCompanionMuted,
	getBuddyAiProfile,
	setBuddyAiProfile,
	updateCompanion,
	type CompanionUpdate,
} from '../../buddy/companion.js';
import {
	COMPANION_STATS,
	EYES,
	HATS,
	SPECIES,
	type CompanionStat,
	type Species,
} from '../../buddy/types.js';
import {
	getSimpleMode,
	setSimpleMode,
	getToolDisplayMode,
	setToolDisplayMode,
	getThinkDisplayMode,
	setThinkDisplayMode,
	type ToolDisplayMode,
	type ThinkDisplayMode,
} from '../config/themeConfig.js';
import {configEvents} from '../config/configEvents.js';
import {
	getYoloMode,
	setYoloMode,
	getPlanMode,
	setPlanMode,
	getToolSearchEnabled,
	setToolSearchEnabled,
	getVulnerabilityHuntingMode,
	setVulnerabilityHuntingMode,
	getTeamMode,
	setTeamMode,
	getUltraTodoEnabled,
	setUltraTodoEnabled,
	getImageCompressEnabled,
	setImageCompressEnabled,
	getAutoFormatEnabled,
	setAutoFormatEnabled,
	getTelemetryEnabled,
	setTelemetryEnabled,
	getTelemetryConfig,
} from '../config/projectSettings.js';
import {
	getActiveProfileName,
	getAllProfiles,
	switchProfile,
} from '../config/configManager.js';
import {
	loadCodebaseConfig,
	isCodebaseEnabled,
	enableCodebase,
	disableCodebase,
} from '../config/codebaseConfig.js';
import {
	failResult,
	okResult,
	type SessionCommandMeta,
	type SessionCommandResult,
} from './sessionCommandTypes.js';

function parseTokens(args?: string): string[] {
	return (args ?? '').trim().split(/\s+/).filter(Boolean);
}

function parseOnOffToggle(
	args: string | undefined,
	current: boolean,
):
	| {ok: true; value: boolean; isStatus: boolean}
	| {ok: false; message: string} {
	const token = (args ?? '').trim().toLowerCase();
	if (!token || token === 'status') {
		return {ok: true, value: current, isStatus: true};
	}
	if (
		token === 'on' ||
		token === 'true' ||
		token === '1' ||
		token === 'enable'
	) {
		return {ok: true, value: true, isStatus: false};
	}
	if (
		token === 'off' ||
		token === 'false' ||
		token === '0' ||
		token === 'disable'
	) {
		return {ok: true, value: false, isStatus: false};
	}
	if (token === 'toggle') {
		return {ok: true, value: !current, isStatus: false};
	}
	return {
		ok: false,
		message: `Invalid argument "${token}". Use on|off|status|toggle.`,
	};
}

function companionPublic(
	companion: NonNullable<ReturnType<typeof getCompanion>>,
) {
	return {
		name: companion.name,
		species: companion.species,
		rarity: companion.rarity,
		personality: companion.personality,
		shiny: companion.shiny,
		hat: companion.hat,
		eye: companion.eye,
		hatchedAt: companion.hatchedAt,
		stats: companion.stats,
	};
}

function parseHatchArgs(raw: string): {
	name?: string;
	personality?: string;
	species?: string;
	listSpecies?: boolean;
} {
	const personalityMarker = '--personality=';
	const markerIndex = raw.indexOf(personalityMarker);
	let optionText = raw;
	let personality: string | undefined;
	if (markerIndex >= 0) {
		optionText = raw.slice(0, markerIndex).trim();
		personality = raw.slice(markerIndex + personalityMarker.length).trim();
	}

	const tokens = optionText.split(/\s+/).filter(Boolean);
	const nameParts: string[] = [];
	let species: string | undefined;
	let listSpecies = false;

	for (const token of tokens) {
		if (token === '--list-species' || token === '--species=list') {
			listSpecies = true;
			continue;
		}
		if (token.startsWith('--species=')) {
			species = token.slice('--species='.length);
			continue;
		}
		nameParts.push(token);
	}

	return {
		name: nameParts.join(' ') || undefined,
		personality,
		species,
		listSpecies,
	};
}

function isSpecies(value: string): value is Species {
	return (SPECIES as readonly string[]).includes(value);
}

function isCompanionStat(value: string): value is CompanionStat {
	return (COMPANION_STATS as readonly string[]).includes(value);
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

function parseSetArgs(raw: string): {
	updates: CompanionUpdate;
	errors: string[];
	showOptions: boolean;
	hasAny: boolean;
} {
	let remainder = raw.trim();
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

async function handleBuddy(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const tokens = parseTokens(args);
	const sub = meta.subcommand ?? tokens[0] ?? 'status';
	const rest = meta.subcommand ? tokens.join(' ') : tokens.slice(1).join(' ');

	if (sub === 'status' || sub === '') {
		const companion = getCompanion();
		if (!companion) {
			return okResult(
				meta.id,
				{exists: false, muted: isCompanionMuted()},
				'No buddy has hatched yet.',
				meta.risk,
			);
		}
		return okResult(
			meta.id,
			{
				exists: true,
				muted: isCompanionMuted(),
				aiProfile: getBuddyAiProfile() ?? null,
				companion: companionPublic(companion),
			},
			`${companion.name} the ${companion.species}`,
			meta.risk,
		);
	}

	if (sub === 'species' || rest.includes('--list-species')) {
		return okResult(
			meta.id,
			{species: [...SPECIES]},
			`Available species: ${SPECIES.join(', ')}`,
			meta.risk,
		);
	}

	if (sub === 'hatch') {
		const parsed = parseHatchArgs(rest);
		if (parsed.listSpecies) {
			return okResult(
				meta.id,
				{species: [...SPECIES]},
				`Available species: ${SPECIES.join(', ')}`,
				meta.risk,
			);
		}
		if (parsed.species && !isSpecies(parsed.species)) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				`Invalid species "${parsed.species}". Available: ${SPECIES.join(', ')}`,
				meta.risk,
			);
		}
		if (getCompanion()) {
			return failResult(
				meta.id,
				'ALREADY_EXISTS',
				'A buddy already exists. Use buddy reset before hatching a new one.',
				meta.risk,
				{companion: companionPublic(getCompanion()!)},
			);
		}
		const companion = hatchCompanion(
			parsed.name,
			parsed.personality,
			parsed.species && isSpecies(parsed.species) ? parsed.species : undefined,
		);
		setCompanionMuted(false);
		return okResult(
			meta.id,
			{companion: companionPublic(companion)},
			`${companion.name} hatched as a ${companion.rarity} ${companion.species}.`,
			meta.risk,
		);
	}

	if (sub === 'pet') {
		const companion = getCompanion();
		if (!companion) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				'No buddy to pet yet. Hatch one first.',
				meta.risk,
			);
		}
		return okResult(
			meta.id,
			{companion: companionPublic(companion), petted: true},
			`You gently pet ${companion.name}.`,
			meta.risk,
		);
	}

	if (sub === 'rename') {
		const companion = getCompanion();
		if (!companion) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				'No buddy to rename yet. Hatch one first.',
				meta.risk,
			);
		}
		const newName = rest.trim();
		if (!newName) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: buddy rename <name>',
				meta.risk,
			);
		}
		const renamed = renameCompanion(newName);
		return okResult(
			meta.id,
			{companion: renamed ? companionPublic(renamed) : null},
			renamed ? `Renamed buddy to ${renamed.name}.` : 'Rename failed.',
			meta.risk,
		);
	}

	if (sub === 'set' || sub === 'customize') {
		const companion = getCompanion();
		if (!companion) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				'No buddy to customize yet. Hatch one first.',
				meta.risk,
			);
		}

		const parsed = parseSetArgs(rest);
		if (parsed.showOptions) {
			return okResult(
				meta.id,
				{
					hats: [...HATS],
					eyes: [...EYES],
					rarities: ['common', 'uncommon', 'rare', 'epic', 'legendary'],
					species: [...SPECIES],
					stats: [...COMPANION_STATS],
				},
				`Hats: ${HATS.join(', ')} | Eyes: ${EYES.join(
					' ',
				)} | Rarities: common, uncommon, rare, epic, legendary`,
				meta.risk,
			);
		}
		if (parsed.errors.length > 0) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				parsed.errors.join('; '),
				meta.risk,
			);
		}
		if (!parsed.hasAny) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: buddy set --hat=crown --eye=✦ --rarity=legendary --shiny=true [--species=fox] [--personality="..."] [--debugging=10]',
				meta.risk,
			);
		}

		const result = updateCompanion(parsed.updates);
		if (!result.ok) {
			const code = result.code === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_ARGS';
			return failResult(meta.id, code, result.error, meta.risk);
		}

		return okResult(
			meta.id,
			{
				companion: companionPublic(result.companion),
				changed: result.changed,
			},
			`Updated ${result.companion.name}: ${result.changed.join(', ')}.`,
			meta.risk,
		);
	}

	if (sub === 'mute') {
		setCompanionMuted(true);
		return okResult(meta.id, {muted: true}, 'Buddy muted.', meta.risk);
	}

	if (sub === 'unmute') {
		setCompanionMuted(false);
		return okResult(meta.id, {muted: false}, 'Buddy unmuted.', meta.risk);
	}

	if (sub === 'profile') {
		const profileArgs = parseTokens(rest);
		const action = (profileArgs[0] ?? 'list').toLowerCase();
		if (action === 'list' || action === '') {
			const profiles = getAllProfiles().map(p => ({
				name: p.name,
				isActive: p.isActive,
			}));
			return okResult(
				meta.id,
				{
					buddyProfile: getBuddyAiProfile() ?? null,
					profiles,
				},
				`Buddy profile: ${getBuddyAiProfile() ?? '(default / follow Snow)'}`,
				meta.risk,
			);
		}
		if (action === 'current') {
			return okResult(
				meta.id,
				{buddyProfile: getBuddyAiProfile() ?? null},
				`Buddy profile: ${getBuddyAiProfile() ?? '(default / follow Snow)'}`,
				meta.risk,
			);
		}
		if (action === 'default' || action === 'reset') {
			setBuddyAiProfile(undefined);
			return okResult(
				meta.id,
				{buddyProfile: null},
				'Buddy profile reset to follow current Snow profile.',
				meta.risk,
			);
		}
		const profileName = profileArgs.join(' ');
		const found = getAllProfiles().find(p => p.name === profileName);
		if (!found) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				`Profile "${profileName}" not found.`,
				meta.risk,
			);
		}
		setBuddyAiProfile(profileName);
		return okResult(
			meta.id,
			{buddyProfile: profileName},
			`Buddy profile set to ${profileName}.`,
			meta.risk,
		);
	}

	if (sub === 'reset') {
		resetCompanion();
		setCompanionMuted(false);
		return okResult(meta.id, {exists: false}, 'Buddy reset.', meta.risk);
	}

	if (sub === 'say') {
		const companion = getCompanion();
		if (!companion) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				'No buddy to talk to yet. Hatch one first.',
				meta.risk,
			);
		}
		const message = rest.trim();
		if (!message) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: buddy say <message>',
				meta.risk,
			);
		}
		const {generateBuddyReply} = await import('../../buddy/buddyAi.js');
		const reply = await generateBuddyReply(companion, message);
		return okResult(
			meta.id,
			{
				companion: companionPublic(companion),
				message,
				reply,
			},
			reply,
			meta.risk,
		);
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown buddy subcommand "${sub}".`,
		meta.risk,
	);
}

function handleBooleanSetting(
	meta: SessionCommandMeta,
	args: string | undefined,
	getter: () => boolean,
	setter: (value: boolean) => void,
	label: string,
	onChange?: (value: boolean) => void,
): SessionCommandResult {
	const current = getter();
	const parsed = parseOnOffToggle(args, current);
	if (!parsed.ok) {
		return failResult(meta.id, 'INVALID_ARGS', parsed.message, meta.risk);
	}
	if (parsed.isStatus) {
		return okResult(
			meta.id,
			{enabled: current},
			`${label}: ${current ? 'on' : 'off'}`,
			meta.risk,
		);
	}
	setter(parsed.value);
	onChange?.(parsed.value);
	return okResult(
		meta.id,
		{enabled: parsed.value, previous: current},
		`${label}: ${parsed.value ? 'on' : 'off'}`,
		meta.risk,
	);
}

async function handleMcpStatus(
	meta: SessionCommandMeta,
): Promise<SessionCommandResult> {
	try {
		const {getMCPServicesInfo} = await import('./mcpToolsManager.js');
		const services = await getMCPServicesInfo();
		const summary = services.map(service => ({
			name: service.serviceName,
			isBuiltIn: service.isBuiltIn,
			connected: service.connected,
			enabled: service.enabled !== false,
			toolCount: service.tools.length,
			error: service.error,
			source: service.source,
		}));
		return okResult(
			meta.id,
			{
				services: summary,
				total: summary.length,
				connected: summary.filter(s => s.connected).length,
			},
			`MCP services: ${summary.filter(s => s.connected).length}/${
				summary.length
			} connected`,
			meta.risk,
		);
	} catch (error) {
		return failResult(
			meta.id,
			'EXECUTION_FAILED',
			error instanceof Error ? error.message : 'Failed to load MCP status',
			meta.risk,
		);
	}
}

function handleProfiles(
	meta: SessionCommandMeta,
	args?: string,
): SessionCommandResult {
	const tokens = parseTokens(args);
	const sub = meta.subcommand ?? tokens[0] ?? 'list';

	if (sub === 'list' || sub === '') {
		const profiles = getAllProfiles().map(p => ({
			name: p.name,
			isActive: p.isActive,
		}));
		return okResult(
			meta.id,
			{current: getActiveProfileName(), profiles},
			`Active profile: ${getActiveProfileName()}`,
			meta.risk,
		);
	}

	if (sub === 'current') {
		const current = getActiveProfileName();
		return okResult(
			meta.id,
			{current},
			`Active profile: ${current}`,
			meta.risk,
		);
	}

	if (sub === 'switch') {
		const name = (
			meta.subcommand === 'switch'
				? tokens.join(' ')
				: tokens.slice(1).join(' ')
		).trim();
		// When resolved as profiles.switch with args "switch foo", strip leading switch
		const target = name.startsWith('switch ')
			? name.slice('switch '.length).trim()
			: name;
		if (!target) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: profiles switch <name>',
				meta.risk,
			);
		}
		try {
			switchProfile(target);
			return okResult(
				meta.id,
				{current: getActiveProfileName()},
				`Switched to profile ${getActiveProfileName()}`,
				meta.risk,
			);
		} catch (error) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				error instanceof Error ? error.message : 'Profile switch failed',
				meta.risk,
			);
		}
	}

	// bare profiles <name> treated as switch when meta is profiles.switch
	if (meta.id === 'profiles.switch') {
		const target =
			tokens[0] === 'switch' ? tokens.slice(1).join(' ') : tokens.join(' ');
		if (!target.trim()) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'Usage: profiles switch <name>',
				meta.risk,
			);
		}
		try {
			switchProfile(target.trim());
			return okResult(
				meta.id,
				{current: getActiveProfileName()},
				`Switched to profile ${getActiveProfileName()}`,
				meta.risk,
			);
		} catch (error) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				error instanceof Error ? error.message : 'Profile switch failed',
				meta.risk,
			);
		}
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		`Unknown profiles subcommand "${sub}".`,
		meta.risk,
	);
}

function handleCodebase(
	meta: SessionCommandMeta,
	args?: string,
): SessionCommandResult {
	const token = (args ?? '').trim().toLowerCase();
	const config = loadCodebaseConfig();
	const hasEmbedding = Boolean(
		config.embedding.baseUrl && config.embedding.apiKey,
	);
	const enabled = isCodebaseEnabled();

	if (!token || token === 'status') {
		return okResult(
			meta.id,
			{
				enabled,
				configured: hasEmbedding,
				embeddingModel: config.embedding.modelName || null,
			},
			hasEmbedding
				? `Codebase: ${enabled ? 'on' : 'off'}`
				: 'Codebase embedding is not configured.',
			meta.risk,
		);
	}

	if (token === 'on' || token === 'enable') {
		if (!hasEmbedding) {
			return failResult(
				meta.id,
				'NOT_CONFIGURED',
				'Cannot enable codebase: embedding is not configured.',
				meta.risk,
			);
		}
		enableCodebase();
		return okResult(
			meta.id,
			{enabled: true, previous: enabled},
			'Codebase: on',
			meta.risk,
		);
	}

	if (token === 'off' || token === 'disable') {
		disableCodebase();
		return okResult(
			meta.id,
			{enabled: false, previous: enabled},
			'Codebase: off',
			meta.risk,
		);
	}

	if (token === 'toggle') {
		if (!enabled && !hasEmbedding) {
			return failResult(
				meta.id,
				'NOT_CONFIGURED',
				'Cannot enable codebase: embedding is not configured.',
				meta.risk,
			);
		}
		if (enabled) {
			disableCodebase();
		} else {
			enableCodebase();
		}
		const next = isCodebaseEnabled();
		return okResult(
			meta.id,
			{enabled: next, previous: enabled},
			`Codebase: ${next ? 'on' : 'off'}`,
			meta.risk,
		);
	}

	return failResult(
		meta.id,
		'INVALID_ARGS',
		'Usage: codebase [status|on|off|toggle]',
		meta.risk,
	);
}

function handleToolDisplay(
	meta: SessionCommandMeta,
	args?: string,
): SessionCommandResult {
	const token = (args ?? '').trim().toLowerCase();
	const current = getToolDisplayMode();
	if (!token || token === 'status') {
		return okResult(
			meta.id,
			{mode: current},
			`Tool display: ${current}`,
			meta.risk,
		);
	}
	if (token === 'full' || token === 'compact' || token === 'hidden') {
		const mode = token as ToolDisplayMode;
		setToolDisplayMode(mode);
		// Best-effort notify TUI subscribers (same as /tool-display slash path).
		configEvents.emitConfigChange({type: 'toolDisplayMode', value: mode});
		return okResult(
			meta.id,
			{mode, previous: current},
			`Tool display: ${mode}`,
			meta.risk,
		);
	}
	return failResult(
		meta.id,
		'INVALID_ARGS',
		'Usage: tool-display [full|compact|hidden|status]',
		meta.risk,
	);
}

function handleThinkDisplay(
	meta: SessionCommandMeta,
	args?: string,
): SessionCommandResult {
	const token = (args ?? '').trim().toLowerCase();
	const current = getThinkDisplayMode();
	if (!token || token === 'status') {
		return okResult(
			meta.id,
			{mode: current},
			`Think display: ${current}`,
			meta.risk,
		);
	}
	if (token === 'full' || token === 'compact') {
		const mode = token as ThinkDisplayMode;
		setThinkDisplayMode(mode);
		// Best-effort notify TUI subscribers (same as /think-display slash path).
		configEvents.emitConfigChange({type: 'thinkDisplayMode', value: mode});
		return okResult(
			meta.id,
			{mode, previous: current},
			`Think display: ${mode}`,
			meta.risk,
		);
	}
	return failResult(
		meta.id,
		'INVALID_ARGS',
		'Usage: think-display [full|compact|status]',
		meta.risk,
	);
}

function handleTelemetry(
	meta: SessionCommandMeta,
	args?: string,
): SessionCommandResult {
	const token = (args ?? '').trim().toLowerCase();
	const config = getTelemetryConfig();
	if (!token || token === 'status') {
		return okResult(
			meta.id,
			{
				enabled: config.enabled === true,
				serviceName: config.serviceName,
				tracesExporter: config.tracesExporter,
				metricsExporter: config.metricsExporter,
			},
			`Telemetry: ${config.enabled ? 'on' : 'off'}`,
			meta.risk,
		);
	}
	return handleBooleanSetting(
		meta,
		args,
		getTelemetryEnabled,
		setTelemetryEnabled,
		'Telemetry',
	);
}

async function handleUsage(
	meta: SessionCommandMeta,
): Promise<SessionCommandResult> {
	// Prefer session contextUsage when present.
	const {sessionManager} = await import('../session/sessionManager.js');
	const session = sessionManager.getCurrentSession();
	const contextUsage = session?.contextUsage ?? null;
	return okResult(
		meta.id,
		{
			cwd: process.cwd(),
			sessionId: session?.id ?? null,
			messageCount: session?.messageCount ?? session?.messages?.length ?? 0,
			contextUsage,
			modes: {
				yolo: getYoloMode(),
				plan: getPlanMode(),
				toolSearch: getToolSearchEnabled(),
			},
		},
		contextUsage
			? 'Usage snapshot from current session context.'
			: 'Usage snapshot (no active session contextUsage).',
		meta.risk,
	);
}

function parseExportArgs(args?: string):
	| {
			ok: true;
			format: 'txt' | 'md' | 'html' | 'json';
			sessionId?: string;
			outPath?: string;
	  }
	| {
			ok: false;
			message: string;
	  } {
	const tokens = parseTokens(args);
	const allowed = new Set(['txt', 'md', 'html', 'json']);
	let format: 'txt' | 'md' | 'html' | 'json' = 'md';
	let sessionId: string | undefined;
	let outPath: string | undefined;
	let sawFormat = false;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;
		const lower = token.toLowerCase();

		if (lower.startsWith('--session=')) {
			sessionId = token.slice('--session='.length).trim() || undefined;
			continue;
		}
		if (lower === '--session') {
			sessionId = tokens[i + 1];
			i += 1;
			continue;
		}
		if (lower.startsWith('--out=')) {
			outPath = token.slice('--out='.length).trim() || undefined;
			continue;
		}
		if (lower === '--out' || lower === '-o') {
			outPath = tokens[i + 1];
			i += 1;
			continue;
		}
		if (allowed.has(lower)) {
			if (sawFormat) {
				return {
					ok: false,
					message:
						'Usage: export [txt|md|html|json] [--session=<id>] [--out=<path>|-o <path>]',
				};
			}
			format = lower as 'txt' | 'md' | 'html' | 'json';
			sawFormat = true;
			continue;
		}
		// Reject unknown format-like tokens (e.g. "pdf") instead of treating as session id.
		if (/^[a-z][a-z0-9]*$/i.test(token) && token.length <= 10) {
			return {
				ok: false,
				message: `Invalid export format "${token}". Use txt|md|html|json.`,
			};
		}
		// Bare session id token when not a known format/flag
		if (!sessionId && !token.startsWith('-')) {
			sessionId = token;
			continue;
		}
		return {
			ok: false,
			message: `Invalid export argument "${token}". Usage: export [txt|md|html|json] [--session=<id>] [--out=<path>|-o <path>]`,
		};
	}

	return {ok: true, format, sessionId, outPath};
}

function parseReindexArgs(args?: string):
	| {
			ok: true;
			force: boolean;
	  }
	| {
			ok: false;
			message: string;
	  } {
	const tokens = parseTokens(args);
	let force = false;
	for (const token of tokens) {
		const lower = token.toLowerCase();
		if (lower === '--force' || lower === 'force') {
			force = true;
			continue;
		}
		return {
			ok: false,
			message: `Invalid reindex argument "${token}". Usage: reindex [--force|force]`,
		};
	}
	return {ok: true, force};
}

async function handleCompact(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	try {
		const {sessionManager} = await import('../session/sessionManager.js');
		const {compressContext} = await import('../core/contextCompressor.js');

		const tokens = parseTokens(args);
		const explicitSessionId = tokens[0]?.trim() || undefined;

		let session = explicitSessionId
			? await sessionManager.loadSession(explicitSessionId)
			: sessionManager.getCurrentSession();

		// If only in-memory current session exists without id match path above
		if (!session && !explicitSessionId) {
			session = sessionManager.getCurrentSession();
		}

		if (!session) {
			return failResult(
				meta.id,
				explicitSessionId ? 'NOT_FOUND' : 'SESSION_REQUIRED',
				explicitSessionId
					? `Session "${explicitSessionId}" not found.`
					: 'No active session. Provide a session id or run inside a session context.',
				meta.risk,
			);
		}

		const messages = session.messages ?? [];
		if (messages.length === 0) {
			return failResult(
				meta.id,
				'INVALID_ARGS',
				'No messages to compress.',
				meta.risk,
			);
		}

		const result = await compressContext(messages as any);
		if (!result) {
			return okResult(
				meta.id,
				{
					skipped: true,
					sessionId: session.id,
					messageCount: messages.length,
					message: 'Compression skipped (no history to compress)',
				},
				'Compression skipped (no history to compress)',
				meta.risk,
			);
		}

		if (result.hookFailed) {
			return failResult(
				meta.id,
				'EXECUTION_FAILED',
				'Blocked by beforeCompress hook',
				meta.risk,
				{
					hookFailed: true,
					hookErrorDetails: result.hookErrorDetails,
					sessionId: session.id,
				},
			);
		}

		// Apply compression by creating a new session (mirrors TUI /compact path).
		const preservedMessages = result.preservedMessages ?? [];
		let finalContent = `[Context Summary from Previous Conversation]\n\n${result.summary}`;
		if (preservedMessages.length > 0) {
			finalContent +=
				'\n\n---\n\n[Last Interaction - Preserved Below for Continuity]';
		}

		const newSessionMessages: Array<any> = [
			{
				role: 'user',
				content: finalContent,
				timestamp: Date.now(),
			},
		];
		if (preservedMessages.length > 0) {
			newSessionMessages.push(
				...preservedMessages.map((msg: any) => ({
					...msg,
					timestamp: Date.now(),
				})),
			);
		}

		const compressedSession = await sessionManager.createNewSession(
			false,
			true,
		);
		compressedSession.messages = newSessionMessages as any;
		compressedSession.messageCount = newSessionMessages.length;
		compressedSession.updatedAt = Date.now();
		compressedSession.title = session.title;
		compressedSession.summary = session.summary;
		compressedSession.compressedFrom = session.id;
		compressedSession.compressedAt = Date.now();
		compressedSession.originalMessageIndex = result.preservedMessageStartIndex;
		if (session.hasGoal) {
			compressedSession.hasGoal = true;
		}
		await sessionManager.saveSession(compressedSession);

		// Best-effort TODO inheritance (same as TUI).
		try {
			const {getTodoService} = await import('./mcpToolsManager.js');
			await getTodoService().copyTodoList(session.id, compressedSession.id);
		} catch {
			// Non-fatal for headless compact.
		}

		// Best-effort goal migration when hasGoal is set.
		if (session.hasGoal) {
			try {
				const {goalManager} = await import('../task/goalManager.js');
				await goalManager.migrateGoalToSession(
					session.id,
					compressedSession.id,
				);
			} catch {
				// Non-fatal for headless compact.
			}
		}

		const reloaded = await sessionManager.loadSession(compressedSession.id);
		if (reloaded) {
			sessionManager.setCurrentSession(reloaded);
		} else {
			sessionManager.setCurrentSession(compressedSession);
		}

		return okResult(
			meta.id,
			{
				applied: true,
				sourceSessionId: session.id,
				sessionId: compressedSession.id,
				messageCountBefore: messages.length,
				messageCountAfter: newSessionMessages.length,
				summaryLength: result.summary?.length ?? 0,
				preservedMessageCount: preservedMessages.length,
				usage: result.usage,
			},
			`Compact applied. New session ${compressedSession.id} (from ${session.id}).`,
			meta.risk,
		);
	} catch (error) {
		return failResult(
			meta.id,
			'EXECUTION_FAILED',
			error instanceof Error ? error.message : 'Compact failed',
			meta.risk,
		);
	}
}

async function handleExport(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const parsed = parseExportArgs(args);
	if (!parsed.ok) {
		return failResult(meta.id, 'INVALID_ARGS', parsed.message, meta.risk);
	}

	try {
		const {sessionManager} = await import('../session/sessionManager.js');
		const {
			exportSessionToFile,
			getDefaultExportDirectory,
			resolveExportFilePath,
		} = await import('../session/chatExporter.js');

		const sessionId =
			parsed.sessionId ?? sessionManager.getCurrentSession()?.id;
		if (!sessionId) {
			return failResult(
				meta.id,
				'SESSION_REQUIRED',
				'No session to export. Provide --session=<id> or run with an active session.',
				meta.risk,
			);
		}

		const session = await sessionManager.getSessionForExport(sessionId);
		if (!session) {
			return failResult(
				meta.id,
				'NOT_FOUND',
				`Session "${sessionId}" not found.`,
				meta.risk,
			);
		}

		const filePath = resolveExportFilePath(
			session.id,
			parsed.format,
			parsed.outPath,
		);

		await exportSessionToFile(session, filePath, parsed.format);

		return okResult(
			meta.id,
			{
				path: filePath,
				format: parsed.format,
				sessionId: session.id,
				defaultDir: parsed.outPath ? undefined : getDefaultExportDirectory(),
				messageCount: session.messages?.length ?? session.messageCount ?? 0,
			},
			`Exported session ${session.id} to ${filePath}`,
			meta.risk,
		);
	} catch (error) {
		return failResult(
			meta.id,
			'EXECUTION_FAILED',
			error instanceof Error ? error.message : 'Export failed',
			meta.risk,
		);
	}
}

async function handleReindex(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	const parsed = parseReindexArgs(args);
	if (!parsed.ok) {
		return failResult(meta.id, 'INVALID_ARGS', parsed.message, meta.risk);
	}

	if (!isCodebaseEnabled()) {
		return failResult(
			meta.id,
			'NOT_CONFIGURED',
			'Codebase indexing is not enabled. Enable it with /codebase on after configuring embedding.',
			meta.risk,
			{codebaseEnabled: false, cwd: process.cwd()},
		);
	}

	const cwd = process.cwd();
	let lastProgress:
		| {
				totalFiles?: number;
				processedFiles?: number;
				totalChunks?: number;
				currentFile?: string;
				status?: string;
				error?: string;
		  }
		| undefined;

	try {
		const {reindexCodebase} = await import('../codebase/reindexCodebase.js');
		const agent = await reindexCodebase(
			cwd,
			null,
			progressData => {
				lastProgress = {
					totalFiles: progressData.totalFiles,
					processedFiles: progressData.processedFiles,
					totalChunks: progressData.totalChunks,
					currentFile: progressData.currentFile,
					status: progressData.status,
					error: progressData.error,
				};
			},
			parsed.force,
		);

		// Headless path awaits full rebuild; stop watching so process can exit cleanly.
		try {
			agent.stopWatching?.();
		} catch {
			// ignore
		}

		return okResult(
			meta.id,
			{
				started: true,
				completed: true,
				force: parsed.force,
				cwd,
				progress: lastProgress,
				agentActive: Boolean(agent),
			},
			parsed.force
				? `Codebase force reindex completed for ${cwd}`
				: `Codebase reindex completed for ${cwd}`,
			meta.risk,
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Reindex failed';
		const notConfigured = /not enabled|not configured|embedding/i.test(message);
		return failResult(
			meta.id,
			notConfigured ? 'NOT_CONFIGURED' : 'EXECUTION_FAILED',
			message,
			meta.risk,
			{
				force: parsed.force,
				cwd,
				progress: lastProgress,
				codebaseEnabled: isCodebaseEnabled(),
			},
		);
	}
}

/**
 * Execute an allowlisted session command.
 */
export async function executeSessionCommandHandler(
	meta: SessionCommandMeta,
	args?: string,
): Promise<SessionCommandResult> {
	// Strip leading subcommand token when it was part of dotted/subcommand resolution
	const normalizedArgs = normalizeArgsForMeta(meta, args);

	switch (meta.command) {
		case 'buddy':
			return handleBuddy(meta, normalizedArgs);
		case 'simple':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getSimpleMode,
				setSimpleMode,
				'Simple mode',
				value => {
					// Best-effort notify TUI subscribers (same as /simple slash path).
					configEvents.emitConfigChange({type: 'simpleMode', value});
				},
			);
		case 'tool-display':
			return handleToolDisplay(meta, normalizedArgs);
		case 'think-display':
			return handleThinkDisplay(meta, normalizedArgs);
		case 'image-compress':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getImageCompressEnabled,
				setImageCompressEnabled,
				'Image compress',
				value => {
					configEvents.emitConfigChange({
						type: 'imageCompressEnabled',
						value,
					});
				},
			);
		case 'yolo':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getYoloMode,
				setYoloMode,
				'YOLO',
				value => {
					configEvents.emitConfigChange({type: 'yoloMode', value});
				},
			);
		case 'plan':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getPlanMode,
				setPlanMode,
				'Plan',
				value => {
					configEvents.emitConfigChange({type: 'planMode', value});
				},
			);
		case 'tool-search':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getToolSearchEnabled,
				setToolSearchEnabled,
				'Tool search',
				value => {
					configEvents.emitConfigChange({
						type: 'toolSearchEnabled',
						value,
					});
				},
			);
		case 'vulnerability-hunting':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getVulnerabilityHuntingMode,
				setVulnerabilityHuntingMode,
				'Vulnerability hunting',
				value => {
					configEvents.emitConfigChange({
						type: 'vulnerabilityHuntingMode',
						value,
					});
				},
			);
		case 'team':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getTeamMode,
				setTeamMode,
				'Team',
				value => {
					configEvents.emitConfigChange({type: 'teamMode', value});
				},
			);
		case 'ultra-todo':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getUltraTodoEnabled,
				setUltraTodoEnabled,
				'Ultra todo',
				value => {
					configEvents.emitConfigChange({
						type: 'ultraTodoEnabled',
						value,
					});
				},
			);
		case 'mcp': {
			const {handleMcpManage} = await import(
				'./sessionCommandHandlersExtra.js'
			);
			return handleMcpManage(meta, normalizedArgs, handleMcpStatus);
		}
		case 'profiles':
			return handleProfiles(meta, normalizedArgs);
		case 'codebase':
			return handleCodebase(meta, normalizedArgs);
		case 'reindex':
			return handleReindex(meta, normalizedArgs);
		case 'auto-format':
			return handleBooleanSetting(
				meta,
				normalizedArgs,
				getAutoFormatEnabled,
				setAutoFormatEnabled,
				'Auto-format',
			);
		case 'telemetry':
			return handleTelemetry(meta, normalizedArgs);
		case 'usage':
			return handleUsage(meta);
		case 'permissions': {
			const {handlePermissions} = await import(
				'./sessionCommandHandlersExtra.js'
			);
			return handlePermissions(meta, normalizedArgs);
		}
		case 'theme': {
			const {handleTheme} = await import('./sessionCommandHandlersExtra.js');
			return handleTheme(meta, normalizedArgs);
		}
		case 'statusline': {
			const {handleStatusline} = await import(
				'./sessionCommandHandlersExtra.js'
			);
			return handleStatusline(meta);
		}
		case 'ide':
		case 'connection-status': {
			const {handleIde} = await import('./sessionCommandHandlersExtra.js');
			return handleIde(meta, normalizedArgs);
		}
		case 'session': {
			const {handleSession} = await import('./sessionCommandHandlersExtra.js');
			return handleSession(meta, normalizedArgs);
		}
		case 'goal': {
			const {handleGoal} = await import('./sessionCommandHandlersExtra.js');
			return handleGoal(meta, normalizedArgs);
		}
		case 'loop': {
			const {handleLoop} = await import('./sessionCommandHandlersExtra.js');
			return handleLoop(meta, normalizedArgs);
		}
		case 'skills': {
			const {handleSkills} = await import('./sessionCommandHandlersExtra.js');
			return handleSkills(meta, normalizedArgs);
		}
		case 'help': {
			const {handleHelp} = await import('./sessionCommandHandlersExtra.js');
			return handleHelp(meta);
		}
		case 'config': {
			const {handleConfigSnapshot} = await import(
				'./sessionCommandHandlersExtra.js'
			);
			return handleConfigSnapshot(meta);
		}
		case 'home': {
			const {handleHome} = await import('./sessionCommandHandlersExtra.js');
			return handleHome(meta);
		}
		case 'compact':
			return handleCompact(meta, normalizedArgs);
		case 'export':
			return handleExport(meta, normalizedArgs);
		case 'session-command':
			return okResult(
				meta.id,
				{
					commands: (
						await import('./sessionCommandRegistry.js')
					).listSessionCommands(),
				},
				'Allowlisted session commands',
				meta.risk,
			);
		default:
			return failResult(
				meta.id,
				'HEADLESS_UNSUPPORTED',
				`No headless handler for ${meta.id}`,
				meta.risk,
			);
	}
}

function normalizeArgsForMeta(
	meta: SessionCommandMeta,
	args?: string,
): string | undefined {
	if (!args) {
		return args;
	}
	const tokens = parseTokens(args);
	if (!meta.subcommand) {
		return args;
	}
	// If first token equals subcommand, drop it (e.g. "hatch Mochi" stays, "status" becomes "")
	if (tokens[0]?.toLowerCase() === meta.subcommand.toLowerCase()) {
		return tokens.slice(1).join(' ');
	}
	return args;
}
