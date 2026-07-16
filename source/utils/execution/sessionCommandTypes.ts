/**
 * Session / slash control plane types (issue #190).
 * Stable JSON contract for CLI, Agent tools, and SSE.
 */

export type SessionCommandMode = 'cli' | 'agent' | 'sse';

/** Risk tiers used by allowlist + confirmation policy. */
export type SessionCommandRisk =
	| 'read'
	| 'low_write'
	| 'medium_write'
	| 'high_risk';

export type SessionCommandErrorCode =
	| 'UNKNOWN_COMMAND'
	| 'COMMAND_NOT_ALLOWED'
	| 'CONFIRMATION_REQUIRED'
	| 'INVALID_ARGS'
	| 'HEADLESS_UNSUPPORTED'
	| 'EXECUTION_FAILED'
	| 'NOT_FOUND'
	| 'ALREADY_EXISTS'
	| 'NOT_CONFIGURED'
	| 'SESSION_REQUIRED';

export interface SessionCommandRequest {
	/** Slash-style command name without leading slash, e.g. "buddy" or "tool-display". */
	command: string;
	/** Remaining args string, e.g. "hatch 小雪 --species=fox". */
	args?: string;
	/** Lossless argument tokens from CLI argv; `args` remains for API compatibility. */
	argTokens?: string[];
	mode?: SessionCommandMode;
	/** Explicit confirmation for medium/high risk writes. */
	confirm?: boolean;
	/** Confirmation established by a trusted transport, never model input. */
	trustedConfirm?: boolean;
}

export interface SessionCommandResult {
	ok: boolean;
	command: string;
	data?: unknown;
	message?: string;
	code?: SessionCommandErrorCode;
	risk?: SessionCommandRisk;
}

export interface SessionCommandMeta {
	/** Canonical command id used in allowlist, e.g. "buddy.hatch". */
	id: string;
	/** Top-level slash command name, e.g. "buddy". */
	command: string;
	/** Optional subcommand token, e.g. "hatch". Empty string means bare command / default. */
	subcommand?: string;
	risk: SessionCommandRisk;
	description: string;
	/** Whether headless/cli/agent/sse may execute this command. */
	headlessSupported: boolean;
	/** When true, medium_write/high_risk still need confirm even in CLI with --yes only if required. */
	requiresConfirm?: boolean;
}

export function okResult(
	command: string,
	data?: unknown,
	message?: string,
	risk?: SessionCommandRisk,
): SessionCommandResult {
	return {
		ok: true,
		command,
		data,
		message,
		risk,
	};
}

export function failResult(
	command: string,
	code: SessionCommandErrorCode,
	message: string,
	risk?: SessionCommandRisk,
	data?: unknown,
): SessionCommandResult {
	return {
		ok: false,
		command,
		code,
		message,
		risk,
		data,
	};
}
