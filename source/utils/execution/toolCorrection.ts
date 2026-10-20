/**
 * Tool-call correction agent (TUI parity with Snow App's `tool_correction.rs`).
 *
 * When a tool invocation fails, the executor asks this module for a repaired
 * argument object. The executor owns the retry loop (at most
 * `MAX_TOOL_CORRECTION_ATTEMPTS` repaired executions) and re-executes the tool
 * itself, so this module never touches tools, files or conversation state.
 *
 * The request runs as an ephemeral auxiliary completion with the active API
 * profile's basic model and never blocks the Node.js event loop.
 */

import {EventEmitter} from 'events';
import {createStreamingAnthropicCompletion} from '../../api/anthropic.js';
import {
	createStreamingChatCompletion,
	type ChatMessage,
} from '../../api/chat.js';
import {createStreamingGeminiCompletion} from '../../api/gemini.js';
import {createStreamingResponse} from '../../api/responses.js';
import {
	getCustomSystemPromptForConfig,
	getSnowConfig,
	type RequestMethod,
} from '../config/apiConfig.js';
import {getToolCorrectionEnabled} from '../config/projectSettings.js';
import {logger} from '../core/logger.js';
import {BUILT_IN_TOOL_PREFIXES, collectAllMCPTools} from './mcpToolsManager.js';

/** Maximum number of repaired executions the executor is allowed to perform. */
export const MAX_TOOL_CORRECTION_ATTEMPTS = 3;

/** Hard timeout for a single correction request. */
const CORRECTION_TIMEOUT_MS = 60_000;

/** Maximum context sent to the repair model, mirroring the Snow App side. */
const MAX_DESCRIPTION_CHARS = 2_000;
const MAX_SCHEMA_CHARS = 12_000;
const MAX_ARGUMENTS_CHARS = 8_000;
const MAX_FAILURE_CHARS = 6_000;
const MAX_ATTEMPT_ARGUMENTS_CHARS = 2_000;
const MAX_ATTEMPT_ERROR_CHARS = 1_500;

/**
 * Tools whose arguments must not be silently mutated by the repair agent.
 *
 * - `askuser-ask_question`: the arguments are the user's own answer; rewriting
 *   them would fabricate user input.
 * - `terminal-execute`: stderr and the exit code are diagnostic output the main
 *   model must see verbatim. Auto-repairing the command would hide the original
 *   failure and break the "run, read the error, then decide" debugging loop.
 * - `session-command-run`: mutates session/config state (yolo, profile, privacy
 *   rules, buddy reset...). A silent retry can repeat medium/high-risk writes
 *   and bypass the confirmation semantics.
 * - `scheduler-schedule_task`: blocking wait. Retrying after a failure makes the
 *   user wait twice and breaks the "schedule exactly once" semantics.
 */
export const TOOL_CORRECTION_BLOCKED_TOOLS: readonly string[] = [
	'askuser-ask_question',
	'terminal-execute',
	'session-command-run',
	'scheduler-schedule_task',
];

/**
 * Tool-name prefixes that must never be auto-corrected. Team and sub-agent
 * tools own their execution pipelines (child processes, confirmations,
 * multi-agent side effects), so a silent retry is unsafe.
 */
const TOOL_CORRECTION_BLOCKED_PREFIXES: readonly string[] = [
	'team-',
	'subagent-',
];

const CORRECTION_SYSTEM_PROMPT = `You are a tool-call repair agent inside a coding assistant. A tool invocation failed. Your job is to repair ONLY the arguments of the SAME tool call so it can succeed.

You will receive the tool name, its description, its JSON input schema, the original arguments, the failure message, and the previously attempted repairs.

Respond with ONLY one JSON object in this exact format:
{"retry": true, "arguments": {...}, "reasoning": "one short sentence"}

Rules:
- Keep the original intent. Never switch to another tool and never invent unrelated actions.
- Fix malformed JSON, wrong field names, wrong types, invalid enum values, missing required fields, invalid paths or obviously wrong values.
- Use only facts from the provided context. Do not invent file contents or command output.
- The arguments value MUST be a JSON object that conforms to the input schema.
- If the failure cannot be fixed by changing arguments (permission denied, missing binary, network failure, user rejection, or an environmental error), respond with {"retry": false, "reasoning": "why it cannot be repaired"}.
- Do not include explanations outside the JSON object.`;

export type ToolCorrectionPhase =
	| 'correcting'
	| 'retrying'
	| 'success'
	| 'exhausted'
	| 'idle';

export type ToolCorrectionStatusEvent = {
	phase: ToolCorrectionPhase;
	toolName: string;
	/** 1-based repair number currently in flight. */
	attempt: number;
	maxAttempts: number;
	/** Short explanation produced by the repair model. */
	reasoning?: string;
};

type ToolCorrectionStatusListener = (
	event: ToolCorrectionStatusEvent | null,
) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(50);
const EVENT = 'tool-correction-status';

export function emitToolCorrectionStatus(
	event: ToolCorrectionStatusEvent | null,
): void {
	emitter.emit(EVENT, event);
}

export function onToolCorrectionStatus(
	listener: ToolCorrectionStatusListener,
): () => void {
	emitter.on(EVENT, listener);
	return () => {
		emitter.off(EVENT, listener);
	};
}

export type ToolCorrectionAttempt = {
	/** Serialized repaired arguments that were executed. */
	argumentsJson: string;
	/** Failure text returned by that repaired execution. */
	error: string;
};

export type ToolCorrectionInput = {
	toolName: string;
	toolDescription: string;
	inputSchemaJson: string;
	originalArgumentsJson: string;
	failure: string;
	attempts: ToolCorrectionAttempt[];
	/** 1-based number of the repair being requested. */
	attempt: number;
	abortSignal?: AbortSignal;
};

export type ToolCorrectionDecision = {
	/** Whether the model produced a repaired argument object. */
	retry: boolean;
	/** Serialized repaired arguments (empty when `retry` is false). */
	argumentsJson: string;
	/** Short explanation of the repair or of why it is not repairable. */
	reasoning: string;
};

/**
 * Whether automatic correction is enabled and allowed for this tool.
 *
 * Only tools shipped by Snow participate. User-configured MCP server tools are
 * excluded because their side effects are unknown: automatically repairing
 * arguments and retrying could duplicate a write (send a message, create a
 * ticket, issue a refund...). The main model still sees the failure and can
 * decide on a corrected call itself.
 */
export function isToolCorrectionEnabledForTool(toolName: string): boolean {
	if (!getToolCorrectionEnabled()) {
		return false;
	}
	if (TOOL_CORRECTION_BLOCKED_TOOLS.includes(toolName)) {
		return false;
	}
	if (
		TOOL_CORRECTION_BLOCKED_PREFIXES.some(prefix => toolName.startsWith(prefix))
	) {
		return false;
	}
	return BUILT_IN_TOOL_PREFIXES.some(prefix => toolName.startsWith(prefix));
}

/**
 * Resolve the tool description + JSON schema from the cached MCP tool list.
 * Missing metadata degrades gracefully: the repair model still receives the
 * failure and the original arguments.
 */
export async function resolveToolMetadata(toolName: string): Promise<{
	description: string;
	inputSchemaJson: string;
}> {
	try {
		const tools = await collectAllMCPTools();
		const tool = tools.find(item => item.function.name === toolName);
		if (tool) {
			return {
				description: tool.function.description ?? '',
				inputSchemaJson: JSON.stringify(tool.function.parameters ?? {}),
			};
		}
	} catch (error) {
		logger.debug(
			`Tool correction: failed to resolve metadata for ${toolName}`,
			error,
		);
	}

	return {description: '', inputSchemaJson: '{}'};
}

/**
 * Ask the basic model for repaired arguments.
 *
 * Returns `null` when the auxiliary request itself failed (network error,
 * timeout, unparseable response). Callers treat that as "stop retrying" so a
 * broken repair channel can never disturb the main conversation.
 */
export async function requestToolCorrection(
	input: ToolCorrectionInput,
): Promise<ToolCorrectionDecision | null> {
	const toolName = input.toolName.trim();
	if (!toolName) {
		return null;
	}

	const config = getSnowConfig();
	const model = config.basicModel?.trim() || config.advancedModel?.trim();
	if (!model) {
		logger.debug('Tool correction: no model configured, skipping repair');
		return null;
	}

	const userContent = buildCorrectionUserContent(input);

	// System-prompt precedence mirrors the main flow / Snow App's
	// `apply_configured_system_prompts`:
	// - When the active API profile (or the global fallback) binds custom system
	//   prompts, they own the system slot. The repair prompt is demoted to a
	//   leading user message so it is never dropped or duplicated per provider.
	// - When no custom prompt is bound (or it is explicitly disabled with ''), the
	//   repair prompt stays in the system slot.
	const configuredSystemPrompts = getCustomSystemPromptForConfig(config);
	const repairHasSystemSlot =
		!configuredSystemPrompts || configuredSystemPrompts.length === 0;
	const messages: ChatMessage[] = [
		repairHasSystemSlot
			? {role: 'system', content: CORRECTION_SYSTEM_PROMPT}
			: {role: 'user', content: CORRECTION_SYSTEM_PROMPT},
		{role: 'user', content: userContent},
	];

	try {
		const text = await requestCorrectionText({
			model,
			requestMethod: config.requestMethod,
			messages,
			abortSignal: input.abortSignal,
		});

		if (!text.trim()) {
			return null;
		}

		return parseCorrectionResponse(text);
	} catch (error) {
		logger.debug('Tool correction request failed', error);
		return null;
	}
}

type RequestCorrectionTextOptions = {
	model: string;
	requestMethod: RequestMethod;
	messages: ChatMessage[];
	abortSignal?: AbortSignal;
};

async function requestCorrectionText(
	options: RequestCorrectionTextOptions,
): Promise<string> {
	const {model, requestMethod, messages} = options;

	// Compose the caller abort signal with a local hard timeout.
	const controller = new AbortController();
	let timedOut = false;
	const onAbort = () => controller.abort();
	if (options.abortSignal) {
		if (options.abortSignal.aborted) {
			controller.abort();
		} else {
			options.abortSignal.addEventListener('abort', onAbort, {once: true});
		}
	}

	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, CORRECTION_TIMEOUT_MS);

	let streamGenerator: AsyncGenerator<any, void, unknown>;
	const request = {
		model,
		messages,
		stream: true,
		max_tokens: 1200,
		includeBuiltinSystemPrompt: false,
		disableThinking: true,
		// The repair belongs to no conversation: keep `{{session_id}}` header
		// placeholders neutralized, exactly like Snow App passes an empty
		// session id for tool correction.
		sessionId: '',
	};
	// Custom request headers, OAuth provider headers and placeholder resolution
	// are applied inside every createStreaming* call from the active profile's
	// config (`getCustomHeadersForConfig(config)`), matching the main flow.

	switch (requestMethod) {
		case 'anthropic':
			streamGenerator = createStreamingAnthropicCompletion(
				request,
				controller.signal,
			);
			break;
		case 'gemini':
			streamGenerator = createStreamingGeminiCompletion(
				request,
				controller.signal,
			);
			break;
		case 'responses':
			streamGenerator = createStreamingResponse(request, controller.signal);
			break;
		case 'chat':
		default:
			streamGenerator = createStreamingChatCompletion(
				request,
				controller.signal,
			);
			break;
	}

	try {
		let content = '';
		for await (const chunk of streamGenerator) {
			if (controller.signal.aborted) {
				throw new Error(
					timedOut ? 'Tool correction request timed out.' : 'Aborted',
				);
			}
			if (chunk.type === 'content' && chunk.content) {
				content += chunk.content;
			}
		}
		return content.trim();
	} finally {
		clearTimeout(timer);
		if (options.abortSignal) {
			options.abortSignal.removeEventListener('abort', onAbort);
		}
	}
}

function buildCorrectionUserContent(input: ToolCorrectionInput): string {
	const lines: string[] = [];
	lines.push(`Tool: ${input.toolName.trim()}`);
	lines.push(
		`Description: ${truncateText(
			input.toolDescription.trim(),
			MAX_DESCRIPTION_CHARS,
		)}`,
	);
	lines.push(
		`Input schema:\n${truncateText(
			input.inputSchemaJson.trim(),
			MAX_SCHEMA_CHARS,
		)}`,
	);
	lines.push(
		`Original arguments:\n${truncateText(
			input.originalArgumentsJson.trim(),
			MAX_ARGUMENTS_CHARS,
		)}`,
	);
	lines.push(
		`Failure:\n${truncateText(input.failure.trim(), MAX_FAILURE_CHARS)}`,
	);
	lines.push(
		`Repair attempt: ${Math.max(
			1,
			input.attempt,
		)}/${MAX_TOOL_CORRECTION_ATTEMPTS}`,
	);

	if (input.attempts.length > 0) {
		lines.push('Previous repair attempts (all failed):');
		for (const [index, attempt] of input.attempts.entries()) {
			lines.push(
				`${index + 1}. arguments: ${truncateText(
					attempt.argumentsJson.trim(),
					MAX_ATTEMPT_ARGUMENTS_CHARS,
				)}`,
			);
			lines.push(
				`   error: ${truncateText(
					attempt.error.trim(),
					MAX_ATTEMPT_ERROR_CHARS,
				)}`,
			);
		}
	}

	return lines.join('\n');
}

/**
 * Parse the model's repair JSON, tolerating markdown fences and surrounding
 * prose. The repaired arguments must be a JSON object.
 */
export function parseCorrectionResponse(
	text: string,
): ToolCorrectionDecision | null {
	const jsonStr = extractJsonObject(stripCodeFence(text.trim()));
	if (!jsonStr) {
		return null;
	}

	let parsed: any;
	try {
		parsed = JSON.parse(jsonStr);
	} catch {
		return null;
	}

	const retry = parsed?.retry === true;
	const reasoning =
		typeof parsed?.reasoning === 'string' ? parsed.reasoning.trim() : '';

	if (!retry) {
		return {retry: false, argumentsJson: '', reasoning};
	}

	const rawArguments =
		parsed?.arguments ?? parsed?.argumentsJson ?? parsed?.arguments_json;
	let normalized: Record<string, unknown> | null = null;

	if (typeof rawArguments === 'string') {
		try {
			const parsedArguments = JSON.parse(rawArguments);
			if (isPlainObject(parsedArguments)) {
				normalized = parsedArguments;
			}
		} catch {
			normalized = null;
		}
	} else if (isPlainObject(rawArguments)) {
		normalized = rawArguments;
	}

	if (!normalized) {
		return null;
	}

	return {
		retry: true,
		argumentsJson: JSON.stringify(normalized),
		reasoning,
	};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) {
		return value;
	}
	return `${value.slice(0, maxLength)}…[truncated]`;
}

function stripCodeFence(text: string): string {
	const fencePattern = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/;
	const match = text.match(fencePattern);
	return match?.[1]?.trim() ?? text;
}

function extractJsonObject(text: string): string | null {
	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end <= start) {
		return null;
	}
	return text.slice(start, end + 1);
}
