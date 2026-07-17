/**
 * Session identity environment contract for hook commands and terminal-execute.
 *
 * Trellis (and other multi-session harnesses) resolve active-task pointers from
 * env vars such as TRELLIS_CONTEXT_ID / platform session ids. Snow must export a
 * stable session identity into child processes; stdin alone is not enough for
 * tools that shell out to task.py without reading hook JSON.
 */

export type SessionIdentityEnvOptions = {
	sessionId?: string | null;
	cwd?: string | null;
	baseEnv?: NodeJS.ProcessEnv;
};

/**
 * Build env for a child process with Snow + Trellis session identity.
 *
 * - SNOW_SESSION_ID: native Snow session uuid
 * - TRELLIS_CONTEXT_ID: snow-<sessionId> (does not overwrite an existing value)
 * - SNOW_CWD: working directory for hooks/tools
 * - SNOW_PLATFORM: "snow"
 */
export function buildSessionIdentityEnv(
	opts: SessionIdentityEnvOptions = {},
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {...(opts.baseEnv ?? process.env)};
	const sid = (opts.sessionId || '').trim();
	const cwd = (opts.cwd || process.cwd()).trim();

	if (sid) {
		env['SNOW_SESSION_ID'] = sid;
		if (!env['TRELLIS_CONTEXT_ID']?.trim()) {
			env['TRELLIS_CONTEXT_ID'] = `snow-${sid}`;
		}
	}

	if (cwd) {
		env['SNOW_CWD'] = cwd;
	}

	if (!env['SNOW_PLATFORM']?.trim()) {
		env['SNOW_PLATFORM'] = 'snow';
	}

	return env;
}

function asString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed || undefined;
}

/**
 * Enrich hook stdin context with dual session keys and platform metadata.
 * Keeps existing fields; fills sessionId / session_id / cwd / platform.
 * Blank session keys are dropped instead of being left as whitespace.
 */
export function enrichHookContext<
	T extends Record<string, any> | null | undefined,
>(ctx: T): T {
	if (!ctx || typeof ctx !== 'object') {
		return ctx;
	}

	const source = ctx as Record<string, any>;
	const sessionId =
		asString(source['sessionId']) ||
		asString(source['session_id']) ||
		undefined;

	const next: Record<string, any> = {...source};
	delete next['sessionId'];
	delete next['session_id'];

	next['platform'] = asString(source['platform']) || 'snow';
	next['cwd'] = asString(source['cwd']) || process.cwd();

	if (sessionId) {
		next['sessionId'] = sessionId;
		next['session_id'] = sessionId;
	}

	return next as unknown as T;
}
