/**
 * Build a human-readable breakdown of what fills the model context window.
 * Used by the TUI `/context` panel.
 *
 * Estimates use tiktoken when available; falls back to ~4 chars/token.
 * ROLE content is listed for visibility but counted inside the system bucket
 * so totals are not double-counted.
 */

import {getSnowConfig} from '../config/apiConfig.js';
import {
	getPlanMode,
	getTeamMode,
	getToolSearchEnabled,
	getVulnerabilityHuntingMode,
} from '../config/projectSettings.js';
import {collectAllMCPTools} from '../execution/mcpToolsManager.js';
import {sessionManager} from '../session/sessionManager.js';
import {getInjectedRulesDetails} from '../../prompt/contextInject/index.js';
import {getSystemPromptForMode} from '../../prompt/systemPrompt.js';
import {
	collectUniqueRoleSources,
	type RoleSource,
} from '../../prompt/shared/promptHelpers.js';

export type ContextBucketId =
	| 'system'
	| 'role'
	| 'agents'
	| 'hooks'
	| 'tools'
	| 'messages';

export interface ContextFileItem {
	label: string;
	absPath?: string;
	chars: number;
	tokens: number;
	included: boolean;
	truncated?: boolean;
	kind?: string;
	note?: string;
}

export interface ContextBucket {
	id: ContextBucketId;
	label: string;
	chars: number;
	tokens: number;
	/** When true, tokens are already included in another bucket (display-only). */
	displayOnly?: boolean;
	files?: ContextFileItem[];
	meta?: string;
}

export interface ContextBreakdown {
	maxContextTokens: number;
	totalEstimatedTokens: number;
	percentage: number;
	apiPromptTokens?: number;
	apiPercentage?: number;
	buckets: ContextBucket[];
	mode: {
		planMode: boolean;
		vulnerabilityHuntingMode: boolean;
		teamMode: boolean;
		toolSearchEnabled: boolean;
	};
	generatedAt: number;
}

async function countTokens(text: string): Promise<number> {
	if (!text) return 0;
	try {
		const {encoding_for_model} = await import('tiktoken');
		let encoder;
		try {
			encoder = encoding_for_model('gpt-5' as any);
		} catch {
			encoder = encoding_for_model('gpt-3.5-turbo');
		}
		try {
			return encoder.encode(text).length;
		} finally {
			encoder.free();
		}
	} catch {
		return Math.ceil(text.length / 4);
	}
}

function messageToText(msg: any): string {
	const parts: string[] = [];
	if (typeof msg?.content === 'string') {
		parts.push(msg.content);
	} else if (Array.isArray(msg?.content)) {
		for (const block of msg.content) {
			if (typeof block === 'string') parts.push(block);
			else if (block && typeof block === 'object') {
				if (typeof block.text === 'string') parts.push(block.text);
				else if (typeof block.content === 'string') parts.push(block.content);
				else {
					try {
						parts.push(JSON.stringify(block));
					} catch {
						// ignore
					}
				}
			}
		}
	} else if (msg?.content != null) {
		try {
			parts.push(JSON.stringify(msg.content));
		} catch {
			parts.push(String(msg.content));
		}
	}

	if (Array.isArray(msg?.tool_calls)) {
		try {
			parts.push(JSON.stringify(msg.tool_calls));
		} catch {
			// ignore
		}
	}

	return parts.join('\n');
}

function roleFiles(sources: RoleSource[]): ContextFileItem[] {
	return sources.map(source => ({
		label: source.relLabel,
		absPath: source.absPath,
		chars: source.content.length,
		tokens: 0, // filled later
		included: true,
		kind: source.scope,
		note: 'included in system',
	}));
}

/**
 * Snapshot of what will (approximately) fill the next model request.
 */
export async function buildContextBreakdown(options?: {
	cwd?: string;
}): Promise<ContextBreakdown> {
	const cwd = options?.cwd ?? process.cwd();
	const config = getSnowConfig();
	const maxContextTokens = config.maxContextTokens || 200000;

	const planMode = getPlanMode();
	const vulnerabilityHuntingMode = getVulnerabilityHuntingMode();
	const teamMode = getTeamMode();
	const toolSearchEnabled = getToolSearchEnabled();
	const toolSearchDisabled = !toolSearchEnabled;

	// --- System (+ ROLE inlined) ---
	const systemPrompt = getSystemPromptForMode(
		planMode,
		vulnerabilityHuntingMode,
		toolSearchDisabled,
		teamMode,
	);
	const systemTokens = await countTokens(systemPrompt);

	// --- ROLE files (display; already inside system) ---
	let roles: RoleSource[] = [];
	try {
		roles = collectUniqueRoleSources();
	} catch {
		roles = [];
	}
	const roleFileItems = roleFiles(roles);
	for (const file of roleFileItems) {
		file.tokens = await countTokens(
			roles.find(r => r.absPath === file.absPath)?.content ?? '',
		);
	}
	const roleTokens = roleFileItems.reduce((sum, f) => sum + f.tokens, 0);
	const roleChars = roleFileItems.reduce((sum, f) => sum + f.chars, 0);

	// --- AGENTS inject (user-message path) ---
	const agentsDetails = getInjectedRulesDetails({
		cwd,
		profile: 'full',
		writeBreadcrumb: false,
	});
	const agentsTokens = await countTokens(agentsDetails.section);
	const agentsFiles: ContextFileItem[] = (agentsDetails.sources || []).map(
		source => ({
			label: source.relLabel,
			chars: source.chars,
			tokens: Math.ceil(source.chars / 4),
			included: source.included,
			truncated: source.truncated,
			kind: source.kind,
		}),
	);
	// Better token estimate for included files from section proportion when small set
	for (const file of agentsFiles) {
		if (file.included && agentsDetails.totalChars > 0) {
			file.tokens = Math.max(
				1,
				Math.round((file.chars / agentsDetails.totalChars) * agentsTokens),
			);
		}
	}

	// --- Hooks pending additionalContext ---
	const pendingHooks = sessionManager.peekPendingAdditionalContext();
	const hooksText = pendingHooks?.trim() ?? '';
	const hooksTokens = await countTokens(hooksText);

	// --- Tool definitions ---
	let toolsJson = '[]';
	let toolCount = 0;
	try {
		const tools = await collectAllMCPTools();
		toolCount = tools.length;
		toolsJson = JSON.stringify(tools);
	} catch {
		toolsJson = '[]';
	}
	const toolsTokens = await countTokens(toolsJson);

	// --- Conversation messages ---
	const session = sessionManager.getCurrentSession();
	const messages = session?.messages ?? [];
	let messagesText = '';
	for (const msg of messages) {
		messagesText += messageToText(msg) + '\n';
	}
	const messagesTokens = await countTokens(messagesText);

	const buckets: ContextBucket[] = [
		{
			id: 'system',
			label: 'System prompt',
			chars: systemPrompt.length,
			tokens: systemTokens,
			meta: teamMode
				? 'team mode'
				: vulnerabilityHuntingMode
				? 'vuln mode'
				: planMode
				? 'plan mode'
				: 'default',
		},
		{
			id: 'role',
			label: 'ROLE.md',
			chars: roleChars,
			tokens: roleTokens,
			displayOnly: true,
			files: roleFileItems,
			meta: roleFileItems.length
				? 'inlined into system (not double-counted)'
				: 'none active',
		},
		{
			id: 'agents',
			label: 'AGENTS.md inject',
			chars: agentsDetails.totalChars,
			tokens: agentsTokens,
			files: agentsFiles,
			meta: agentsDetails.truncated
				? 'truncated to budget'
				: agentsFiles.length
				? 'user-message prepend'
				: 'no AGENTS found',
		},
		{
			id: 'hooks',
			label: 'Hooks additionalContext',
			chars: hooksText.length,
			tokens: hooksTokens,
			meta: hooksText ? 'pending session inject' : 'none pending',
		},
		{
			id: 'tools',
			label: 'Tool definitions',
			chars: toolsJson.length,
			tokens: toolsTokens,
			meta: `${toolCount} tools${
				toolSearchEnabled ? ' (tool-search on)' : ' (all loaded)'
			}`,
		},
		{
			id: 'messages',
			label: 'Conversation',
			chars: messagesText.length,
			tokens: messagesTokens,
			meta: `${messages.length} messages`,
		},
	];

	const totalEstimatedTokens = buckets
		.filter(b => !b.displayOnly)
		.reduce((sum, b) => sum + b.tokens, 0);

	const percentage = Math.min(
		100,
		maxContextTokens > 0 ? (totalEstimatedTokens / maxContextTokens) * 100 : 0,
	);

	// Optional: last API-reported usage for comparison
	let apiPromptTokens: number | undefined;
	let apiPercentage: number | undefined;
	const usage = session?.contextUsage;
	if (usage && typeof usage.prompt_tokens === 'number') {
		const isAnthropic =
			(usage.cache_creation_input_tokens || 0) > 0 ||
			(usage.cache_read_input_tokens || 0) > 0;
		apiPromptTokens = isAnthropic
			? usage.prompt_tokens +
			  (usage.cache_creation_input_tokens || 0) +
			  (usage.cache_read_input_tokens || 0)
			: usage.prompt_tokens;
		apiPercentage = Math.min(100, (apiPromptTokens / maxContextTokens) * 100);
	}

	return {
		maxContextTokens,
		totalEstimatedTokens,
		percentage,
		apiPromptTokens,
		apiPercentage,
		buckets,
		mode: {
			planMode,
			vulnerabilityHuntingMode,
			teamMode,
			toolSearchEnabled,
		},
		generatedAt: Date.now(),
	};
}
