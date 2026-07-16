/**
 * Session / slash control plane entry (issue #190).
 * Shared by CLI `snow cmd`, Agent tool, and SSE.
 */

import {
	listSessionCommands,
	needsConfirmation,
	resolveSessionCommandMeta,
} from './sessionCommandRegistry.js';
import {executeSessionCommandHandler} from './sessionCommandHandlers.js';
import {
	failResult,
	okResult,
	type SessionCommandMeta,
	type SessionCommandMode,
	type SessionCommandRequest,
	type SessionCommandResult,
} from './sessionCommandTypes.js';

export type {
	SessionCommandErrorCode,
	SessionCommandMode,
	SessionCommandRequest,
	SessionCommandResult,
	SessionCommandRisk,
	SessionCommandMeta,
} from './sessionCommandTypes.js';

export {
	listSessionCommands,
	resolveSessionCommandMeta,
} from './sessionCommandRegistry.js';

/** Treat explicit query invocations as read even when a command also supports writes. */
function isStatusOnlyArgs(meta: SessionCommandMeta, args?: string): boolean {
	if (meta.risk === 'read') {
		return true;
	}
	const trimmed = (args ?? '').trim().toLowerCase();
	// Only the first token decides read-vs-write. Extra flags like
	// "status --period=day" must still count as status-only.
	const tokens = trimmed.split(/\s+/).filter(Boolean);
	const token = tokens[0] ?? '';
	// Only a command resolved as a bare/query command may use a query token as
	// a read-only operation. Explicit write subcommands (e.g. profiles.switch
	// status) must retain their write risk and confirmation requirement.
	if (
		(meta.subcommand === undefined ||
			meta.subcommand === 'status' ||
			meta.subcommand === 'list' ||
			meta.subcommand === 'current') &&
		(token === 'status' || token === 'list' || token === 'current')
	) {
		return true;
	}
	if (
		meta.id === 'codebase' &&
		(token === 'agent-review' ||
			token === 'agent_review' ||
			token === 'reranking' ||
			token === 'rerank') &&
		(!tokens[1] || tokens[1] === 'status')
	) {
		return true;
	}
	if (
		meta.id === 'privacy' &&
		token === 'scope' &&
		(tokens[1] === 'global' || tokens[1] === 'project') &&
		(!tokens[2] || tokens[2] === 'status')
	) {
		return true;
	}
	if (!token) {
		// Pure action commands: empty args still means "run the write".
		if (
			meta.id === 'reindex' ||
			meta.id === 'compact' ||
			meta.id === 'export'
		) {
			return false;
		}
		// Write subcommands resolved via dotted form (e.g. buddy.reset) keep write risk.
		const sub = meta.subcommand?.toLowerCase();
		if (
			sub &&
			sub !== 'status' &&
			sub !== 'list' &&
			sub !== 'current' &&
			sub !== 'snapshot'
		) {
			return false;
		}
		// Bare get-or-set commands (yolo/simple/tool-display/...) default to status.
		return true;
	}
	return false;
}

function serializeArgTokens(tokens: readonly string[]): string | undefined {
	const serialized = tokens
		.map(token => (/\s|["']/u.test(token) ? JSON.stringify(token) : token))
		.join(' ');
	return serialized || undefined;
}

function normalizeCommandInput(request: SessionCommandRequest): {
	command: string;
	args?: string;
} {
	let command = (request.command ?? '').trim().replace(/^\//, '');
	let args = request.argTokens
		? serializeArgTokens(request.argTokens)
		: request.args?.trim() || undefined;

	// Support "buddy hatch foo" entirely in command field
	if (command.includes(' ') && !args) {
		const parts = command.split(/\s+/).filter(Boolean);
		command = parts[0] ?? '';
		args = parts.slice(1).join(' ') || undefined;
	}

	// Support dotted command: buddy.hatch + optional args
	if (command.includes('.')) {
		const [top, ...rest] = command.split('.');
		const sub = rest.join('.');
		if (top && sub) {
			// Keep dotted form for meta resolution; also expand args with sub if needed
			return {command: `${top}.${sub}`, args};
		}
	}

	return {command, args};
}

/**
 * Run an allowlisted session/slash control command.
 */
async function runSessionCommandUnlocked(
	request: SessionCommandRequest,
): Promise<SessionCommandResult> {
	const mode: SessionCommandMode = request.mode ?? 'cli';
	const {command, args} = normalizeCommandInput(request);

	if (!command) {
		return failResult('', 'INVALID_ARGS', 'Command name is required.');
	}

	// session-command list is always available
	if (
		command === 'session-command' ||
		command === 'session-command.list' ||
		(command === 'list' && !args)
	) {
		const commands = listSessionCommands().map(item => ({
			id: item.id,
			command: item.command,
			subcommand: item.subcommand,
			risk: item.risk,
			description: item.description,
			headlessSupported: item.headlessSupported,
			requiresConfirm: Boolean(item.requiresConfirm),
		}));
		return okResult(
			'session-command.list',
			{commands},
			`${commands.length} allowlisted commands`,
			'read',
		);
	}

	const meta = resolveSessionCommandMeta(
		command.includes('.') ? command : command,
		command.includes('.') ? args : args,
	);

	// For dotted commands, resolve with empty args if needed
	const resolved =
		meta ??
		(command.includes('.')
			? resolveSessionCommandMeta(command, undefined)
			: undefined);

	if (!resolved) {
		return failResult(
			command,
			'UNKNOWN_COMMAND',
			`Unknown or non-allowlisted command: ${command}${args ? ` ${args}` : ''}`,
		);
	}

	if (!resolved.headlessSupported && mode !== 'cli') {
		// Still allow cli to report unsupported clearly
	}

	if (!resolved.headlessSupported) {
		return failResult(
			resolved.id,
			'HEADLESS_UNSUPPORTED',
			`Command ${resolved.id} is not supported in headless/agentic mode.`,
			resolved.risk,
		);
	}

	// Status / pure-read arg forms never require confirmation even if command meta is write-capable.
	const effectiveRisk = isStatusOnlyArgs(resolved, args)
		? 'read'
		: resolved.risk;
	const effectiveMeta = {...resolved, risk: effectiveRisk};

	if (
		needsConfirmation(
			effectiveMeta,
			mode,
			// Only the CLI's explicit flag is user-confirmed. Agent/SSE callers
			// must provide a transport-level trusted confirmation.
			mode === 'cli' ? request.confirm : undefined,
			request.trustedConfirm,
		)
	) {
		return failResult(
			resolved.id,
			'CONFIRMATION_REQUIRED',
			`${resolved.id} requires confirmation (pass --yes / confirm:true). Risk: ${effectiveRisk}.`,
			effectiveRisk,
			{risk: effectiveRisk, requiresConfirm: true},
		);
	}

	// For dotted command form, derive handler args
	let handlerArgs = args;
	if (command.includes('.') && resolved.subcommand) {
		handlerArgs = args;
	} else if (resolved.subcommand && args) {
		// keep as-is; handler normalizes
		handlerArgs = args;
	} else if (resolved.subcommand && !args) {
		// bare default like buddy -> status: pass empty
		handlerArgs = undefined;
	}

	try {
		const result = await executeSessionCommandHandler(resolved, handlerArgs);
		return {
			...result,
			command: result.command || resolved.id,
			// Report the policy risk used for confirmation (status-only => read).
			risk: effectiveRisk,
		};
	} catch (error) {
		return failResult(
			resolved.id,
			'EXECUTION_FAILED',
			error instanceof Error ? error.message : 'Command execution failed',
			effectiveRisk,
		);
	}
}

let commandQueue: Promise<void> = Promise.resolve();

/**
 * Serialize control-plane commands because handlers mutate shared process-wide
 * session/config state and persisted JSON files. This intentionally means a
 * long compact blocks later status reads so callers observe entry order.
 */
export function runSessionCommand(
	request: SessionCommandRequest,
): Promise<SessionCommandResult> {
	const queuedRequest = {...request};
	const result = commandQueue.then(() =>
		runSessionCommandUnlocked(queuedRequest),
	);
	commandQueue = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

/**
 * Parse CLI argv after `snow cmd` into a SessionCommandRequest.
 * Example: ["buddy", "hatch", "Fox", "--species=fox", "--json", "--yes"]
 */
export function parseCmdArgv(argv: string[]): {
	request: SessionCommandRequest;
	json: boolean;
} {
	const json = argv.includes('--json') || argv.includes('-j');
	const confirm =
		argv.includes('--yes') || argv.includes('-y') || argv.includes('--confirm');
	const filtered = argv.filter(
		arg =>
			arg !== '--json' &&
			arg !== '-j' &&
			arg !== '--yes' &&
			arg !== '-y' &&
			arg !== '--confirm',
	);

	const command = filtered[0] ?? '';
	const argTokens = filtered.slice(1);
	const args = argTokens.join(' ') || undefined;

	return {
		request: {
			command,
			args,
			argTokens,
			mode: 'cli',
			confirm,
		},
		json,
	};
}

/**
 * CLI entry: run command and print result, return process exit code.
 */
export async function runCliSessionCommand(argv: string[]): Promise<number> {
	const {request, json} = parseCmdArgv(argv);

	if (!request.command) {
		const help = {
			ok: false,
			code: 'INVALID_ARGS',
			message:
				'Usage: snow cmd <command> [args...] [--json] [--yes]\nExample: snow cmd buddy status --json',
			commandsHint: 'snow cmd session-command list --json',
		};
		if (json) {
			console.log(JSON.stringify(help, null, 2));
		} else {
			console.error(help.message);
			console.error(help.commandsHint);
		}
		return 1;
	}

	const result = await runSessionCommand(request);

	if (json) {
		console.log(JSON.stringify(result, null, 2));
	} else if (result.ok) {
		if (result.message) {
			console.log(result.message);
		}
		if (result.data !== undefined) {
			console.log(JSON.stringify(result.data, null, 2));
		}
	} else {
		console.error(`[${result.code ?? 'ERROR'}] ${result.message ?? 'Failed'}`);
	}

	return result.ok ? 0 : 1;
}
