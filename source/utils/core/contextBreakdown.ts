/**
 * Build a human-readable breakdown of what fills the model context window.
 * Used by the TUI `/context` panel.
 *
 * Fast path: chars/4 estimate (default, cheap).
 * Precise path: single shared tiktoken encoder when options.precise === true.
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
	/** Child rows shown when the bucket is expanded. */
	files?: ContextFileItem[];
	meta?: string;
	/** Short detail for the right side / second line. */
	detail?: string;
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
	/** 'fast' = chars/4; 'precise' = tiktoken when available. */
	estimateMode: 'fast' | 'precise';
	generatedAt: number;
}

type TokenCounter = (text: string) => number;

function estimateTokensFast(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function estimateTokensFromChars(chars: number): number {
	if (chars <= 0) return 0;
	return Math.ceil(chars / 4);
}

async function createTokenCounter(precise: boolean): Promise<{
	count: TokenCounter;
	mode: 'fast' | 'precise';
	free: () => void;
}> {
	if (!precise) {
		return {count: estimateTokensFast, mode: 'fast', free: () => {}};
	}

	try {
		const {encoding_for_model} = await import('tiktoken');
		let encoder;
		try {
			encoder = encoding_for_model('gpt-5' as any);
		} catch {
			encoder = encoding_for_model('gpt-3.5-turbo');
		}
		return {
			count: (text: string) => {
				if (!text) return 0;
				try {
					return encoder.encode(text).length;
				} catch {
					return estimateTokensFast(text);
				}
			},
			mode: 'precise',
			free: () => {
				try {
					encoder.free();
				} catch {
					// ignore
				}
			},
		};
	} catch {
		return {count: estimateTokensFast, mode: 'fast', free: () => {}};
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

function roleFiles(
	sources: RoleSource[],
	count: TokenCounter,
): ContextFileItem[] {
	return sources.map(source => ({
		label: source.relLabel,
		absPath: source.absPath,
		chars: source.content.length,
		tokens: count(source.content),
		included: true,
		kind: source.scope,
		note: source.scope === 'global' ? 'global' : 'project',
	}));
}

function modeLabel(mode: {
	planMode: boolean;
	vulnerabilityHuntingMode: boolean;
	teamMode: boolean;
}): string {
	if (mode.teamMode) return 'team mode';
	if (mode.vulnerabilityHuntingMode) return 'vuln mode';
	if (mode.planMode) return 'plan mode';
	return 'default mode';
}

/**
 * Snapshot of what will (approximately) fill the next model request.
 * Default is fast estimate; pass `{precise: true}` for tiktoken.
 */
export async function buildContextBreakdown(options?: {
	cwd?: string;
	/** Use tiktoken for more accurate counts (slower). Default false. */
	precise?: boolean;
}): Promise<ContextBreakdown> {
	const cwd = options?.cwd ?? process.cwd();
	const config = getSnowConfig();
	const maxContextTokens = config.maxContextTokens || 200000;
	const precise = options?.precise === true;

	const planMode = getPlanMode();
	const vulnerabilityHuntingMode = getVulnerabilityHuntingMode();
	const teamMode = getTeamMode();
	const toolSearchEnabled = getToolSearchEnabled();
	const toolSearchDisabled = !toolSearchEnabled;

	const counter = await createTokenCounter(precise);
	const count = counter.count;

	// Start tools collection early so it overlaps with prompt work.
	const toolsPromise = collectAllMCPTools().catch(() => [] as any[]);

	try {
		// --- System (+ ROLE inlined) ---
		const systemPrompt = getSystemPromptForMode(
			planMode,
			vulnerabilityHuntingMode,
			toolSearchDisabled,
			teamMode,
		);
		const systemTokens = count(systemPrompt);

		// --- ROLE files (display; already inside system) ---
		let roles: RoleSource[] = [];
		try {
			roles = collectUniqueRoleSources();
		} catch {
			roles = [];
		}
		const roleFileItems = roleFiles(roles, count);
		const roleTokens = roleFileItems.reduce((sum, f) => sum + f.tokens, 0);
		const roleChars = roleFileItems.reduce((sum, f) => sum + f.chars, 0);

		// --- AGENTS inject (user-message path; settings profile) ---
		const agentsDetails = getInjectedRulesDetails({
			cwd,
			writeBreadcrumb: false,
		});
		const agentsTokens = count(agentsDetails.section);
		const agentsFiles: ContextFileItem[] = (agentsDetails.sources || []).map(
			source => {
				const base: ContextFileItem = {
					label: source.relLabel,
					chars: source.chars,
					tokens: estimateTokensFromChars(source.chars),
					included: source.included,
					truncated: source.truncated,
					kind: source.kind,
				};
				if (
					source.included &&
					agentsDetails.totalChars > 0 &&
					agentsTokens > 0
				) {
					base.tokens = Math.max(
						1,
						Math.round(
							(source.chars / agentsDetails.totalChars) * agentsTokens,
						),
					);
				} else if (!source.included) {
					base.note = 'budget dropped';
				}
				return base;
			},
		);

		// --- Hooks pending additionalContext ---
		const pendingHooks = sessionManager.peekPendingAdditionalContext();
		const hooksText = pendingHooks?.trim() ?? '';
		const hooksTokens = count(hooksText);

		// --- Tool definitions ---
		// Start tools fetch early so it overlaps with other work above.
		// Never zero tools just because the first open is slow — wait for real cache.
		let toolsJson = '[]';
		let toolCount = 0;
		let toolsTokens = 0;
		const toolItems: ContextFileItem[] = [];
		try {
			const tools = await toolsPromise;
			toolCount = tools.length;
			// Cap stringify work for very large tool lists
			const MAX_TOOLS_FOR_JSON = 120;
			const toolsForJson =
				tools.length > MAX_TOOLS_FOR_JSON
					? tools.slice(0, MAX_TOOLS_FOR_JSON)
					: tools;
			toolsJson = JSON.stringify(toolsForJson);
			const sampleTokens = count(toolsJson);
			toolsTokens =
				tools.length > MAX_TOOLS_FOR_JSON && toolsForJson.length > 0
					? Math.round((sampleTokens / toolsForJson.length) * tools.length)
					: sampleTokens;

			const MAX_TOOL_ROWS = 40;
			for (let i = 0; i < Math.min(tools.length, MAX_TOOL_ROWS); i++) {
				// MCPTool is OpenAI-style: {type:'function', function:{name,description,parameters}}
				const tool = tools[i] as {
					name?: string;
					description?: string;
					function?: {name?: string; description?: string};
				};
				const name = tool?.function?.name || tool?.name || `tool-${i + 1}`;
				const description =
					tool?.function?.description || tool?.description || '';
				const desc =
					typeof description === 'string' ? description.slice(0, 48) : '';
				const raw = JSON.stringify(tool ?? {});
				toolItems.push({
					label: name,
					chars: raw.length,
					tokens: estimateTokensFast(raw),
					included: true,
					note: desc || undefined,
				});
			}
			if (tools.length > MAX_TOOL_ROWS) {
				toolItems.push({
					label: `… +${tools.length - MAX_TOOL_ROWS} more tools`,
					chars: 0,
					tokens: 0,
					included: true,
					note: 'truncated list',
				});
			}
		} catch {
			toolsJson = '[]';
			toolsTokens = 0;
		}

		// --- Conversation messages ---
		const session = sessionManager.getCurrentSession();
		const messages = session?.messages ?? [];
		// Cap message scanning for very long sessions
		const MAX_MSGS = 400;
		const msgs =
			messages.length > MAX_MSGS
				? messages.slice(messages.length - MAX_MSGS)
				: messages;
		let messagesText = '';
		const roleCounts: Record<string, number> = {};
		const messageItems: ContextFileItem[] = [];
		for (const msg of msgs) {
			const role = typeof msg?.role === 'string' ? msg.role : 'unknown';
			roleCounts[role] = (roleCounts[role] || 0) + 1;
			messagesText += messageToText(msg) + '\n';
		}
		let messagesTokens = count(messagesText);
		if (messages.length > MAX_MSGS && msgs.length > 0) {
			const ratio = messages.length / msgs.length;
			messagesTokens = Math.round(messagesTokens * ratio);
		}

		for (const [role, n] of Object.entries(roleCounts).sort((a, b) =>
			a[0].localeCompare(b[0]),
		)) {
			messageItems.push({
				label: role,
				chars: 0,
				tokens: 0,
				included: true,
				note: `${n} msg${n === 1 ? '' : 's'}`,
			});
		}
		if (messages.length > MAX_MSGS) {
			messageItems.push({
				label: `… scanned last ${MAX_MSGS}`,
				chars: 0,
				tokens: 0,
				included: true,
				note: `${messages.length} total`,
			});
		}

		const mode = {
			planMode,
			vulnerabilityHuntingMode,
			teamMode,
			toolSearchEnabled,
		};

		const systemDetailItems: ContextFileItem[] = [
			{
				label: modeLabel(mode),
				chars: systemPrompt.length,
				tokens: systemTokens,
				included: true,
				note: 'full system text',
			},
			{
				label: toolSearchEnabled ? 'tool-search: on' : 'tool-search: off',
				chars: 0,
				tokens: 0,
				included: true,
				note: toolSearchEnabled
					? 'subset of tools may be sent'
					: 'all tools loaded',
			},
		];

		const buckets: ContextBucket[] = [
			{
				id: 'system',
				label: 'System prompt',
				chars: systemPrompt.length,
				tokens: systemTokens,
				files: systemDetailItems,
				meta: modeLabel(mode),
				detail: `${systemPrompt.length.toLocaleString()} chars`,
			},
			{
				id: 'role',
				label: 'ROLE.md',
				chars: roleChars,
				tokens: roleTokens,
				displayOnly: true,
				files: roleFileItems,
				meta: roleFileItems.length
					? `${roleFileItems.length} file(s) · in system`
					: 'none active',
				detail: roleFileItems.length ? 'not double-counted' : undefined,
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
					? `${agentsFiles.filter(f => f.included).length}/${
							agentsFiles.length
					  } files · user prepend`
					: 'no AGENTS found',
				detail: agentsFiles.length ? 'expand for files' : undefined,
			},
			{
				id: 'hooks',
				label: 'Hooks context',
				chars: hooksText.length,
				tokens: hooksTokens,
				files: hooksText
					? [
							{
								label: 'pending additionalContext',
								chars: hooksText.length,
								tokens: hooksTokens,
								included: true,
								note: `${hooksText.length} chars`,
							},
					  ]
					: [],
				meta: hooksText ? 'pending session inject' : 'none pending',
			},
			{
				id: 'tools',
				label: 'Tool definitions',
				chars: toolsJson.length,
				tokens: toolsTokens,
				files: toolItems,
				meta: `${toolCount} tools · ${
					toolSearchEnabled ? 'tool-search on' : 'all loaded'
				}`,
				detail: toolItems.length ? 'expand for names' : undefined,
			},
			{
				id: 'messages',
				label: 'Conversation',
				chars: messagesText.length,
				tokens: messagesTokens,
				files: messageItems,
				meta: `${messages.length} messages`,
				detail: messageItems.length ? 'expand by role' : undefined,
			},
		];

		const totalEstimatedTokens = buckets
			.filter(b => !b.displayOnly)
			.reduce((sum, b) => sum + b.tokens, 0);

		const percentage = Math.min(
			100,
			maxContextTokens > 0
				? (totalEstimatedTokens / maxContextTokens) * 100
				: 0,
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
			mode,
			estimateMode: counter.mode,
			generatedAt: Date.now(),
		};
	} finally {
		counter.free();
	}
}
