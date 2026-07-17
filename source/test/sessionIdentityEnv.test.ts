import anyTest, {type TestFn} from 'ava';

import {
	buildSessionIdentityEnv,
	enrichHookContext,
} from '../utils/execution/sessionIdentityEnv.js';
import {
	buildSessionStartHookContext,
	sessionManager,
	type ChatMessage,
} from '../utils/session/sessionManager.js';

const test = anyTest as unknown as TestFn;

test('buildSessionIdentityEnv sets SNOW_SESSION_ID and TRELLIS_CONTEXT_ID', t => {
	const env = buildSessionIdentityEnv({
		sessionId: 'abc-123',
		cwd: 'E:\\proj',
		baseEnv: {},
	});

	t.is(env['SNOW_SESSION_ID'], 'abc-123');
	t.is(env['TRELLIS_CONTEXT_ID'], 'snow-abc-123');
	t.is(env['SNOW_CWD'], 'E:\\proj');
	t.is(env['SNOW_PLATFORM'], 'snow');
});

test('buildSessionIdentityEnv does not overwrite existing TRELLIS_CONTEXT_ID', t => {
	const env = buildSessionIdentityEnv({
		sessionId: 'abc-123',
		baseEnv: {TRELLIS_CONTEXT_ID: 'custom-key'},
	});

	t.is(env['TRELLIS_CONTEXT_ID'], 'custom-key');
	t.is(env['SNOW_SESSION_ID'], 'abc-123');
});

test('buildSessionIdentityEnv does not overwrite existing SNOW_PLATFORM', t => {
	const env = buildSessionIdentityEnv({
		sessionId: 'abc-123',
		baseEnv: {SNOW_PLATFORM: 'custom-platform'},
	});

	t.is(env['SNOW_PLATFORM'], 'custom-platform');
	t.is(env['SNOW_SESSION_ID'], 'abc-123');
});

test('buildSessionIdentityEnv overwrites existing SNOW_SESSION_ID with current session', t => {
	const env = buildSessionIdentityEnv({
		sessionId: 'current-session',
		baseEnv: {
			SNOW_SESSION_ID: 'stale-session',
			TRELLIS_CONTEXT_ID: 'keep-me',
		},
	});

	t.is(env['SNOW_SESSION_ID'], 'current-session');
	// Parent Trellis context stays authoritative; SNOW_SESSION_ID tracks Snow's current session.
	t.is(env['TRELLIS_CONTEXT_ID'], 'keep-me');
});

test('buildSessionIdentityEnv preserves unrelated base env', t => {
	const env = buildSessionIdentityEnv({
		sessionId: 's1',
		baseEnv: {PATH: '/usr/bin', FOO: 'bar'},
	});

	t.is(env['PATH'], '/usr/bin');
	t.is(env['FOO'], 'bar');
	t.is(env['SNOW_PLATFORM'], 'snow');
});

test('buildSessionIdentityEnv without sessionId still sets platform and cwd', t => {
	const env = buildSessionIdentityEnv({
		cwd: '/tmp/x',
		baseEnv: {},
	});

	t.is(env['SNOW_SESSION_ID'], undefined);
	t.is(env['TRELLIS_CONTEXT_ID'], undefined);
	t.is(env['SNOW_CWD'], '/tmp/x');
	t.is(env['SNOW_PLATFORM'], 'snow');
});

test('buildSessionIdentityEnv trims sessionId and treats blank as missing', t => {
	const trimmed = buildSessionIdentityEnv({
		sessionId: '  sid-trim  ',
		baseEnv: {},
	});
	t.is(trimmed['SNOW_SESSION_ID'], 'sid-trim');
	t.is(trimmed['TRELLIS_CONTEXT_ID'], 'snow-sid-trim');

	const blank = buildSessionIdentityEnv({
		sessionId: '   ',
		cwd: '/only-cwd',
		baseEnv: {},
	});
	t.is(blank['SNOW_SESSION_ID'], undefined);
	t.is(blank['TRELLIS_CONTEXT_ID'], undefined);
	t.is(blank['SNOW_CWD'], '/only-cwd');
});

test('buildSessionIdentityEnv does not mutate the provided baseEnv object', t => {
	const baseEnv: NodeJS.ProcessEnv = {PATH: '/bin'};
	const env = buildSessionIdentityEnv({
		sessionId: 's-copy',
		baseEnv,
	});

	t.is(env['SNOW_SESSION_ID'], 's-copy');
	t.is(baseEnv['SNOW_SESSION_ID'], undefined);
	t.is(baseEnv['PATH'], '/bin');
});

test('enrichHookContext dual-keys sessionId and session_id', t => {
	const out = enrichHookContext({
		message: 'hi',
		sessionId: 'sess-1',
	} as Record<string, any>);

	t.is(out['sessionId'], 'sess-1');
	t.is(out['session_id'], 'sess-1');
	t.is(out['platform'], 'snow');
	t.truthy(out['cwd']);
});

test('enrichHookContext accepts session_id only', t => {
	const out = enrichHookContext({
		session_id: 'from-snake',
		cwd: '/repo',
	} as Record<string, any>);

	t.is(out['sessionId'], 'from-snake');
	t.is(out['session_id'], 'from-snake');
	t.is(out['cwd'], '/repo');
});

test('enrichHookContext prefers camelCase sessionId when both keys differ', t => {
	const out = enrichHookContext({
		sessionId: 'camel-wins',
		session_id: 'snake-loses',
	} as Record<string, any>);

	t.is(out['sessionId'], 'camel-wins');
	t.is(out['session_id'], 'camel-wins');
});

test('enrichHookContext keeps existing platform and extra fields', t => {
	const out = enrichHookContext({
		message: 'keep-me',
		platform: 'custom',
		sessionId: 's1',
		cwd: '/explicit',
	} as Record<string, any>);

	t.is(out['message'], 'keep-me');
	t.is(out['platform'], 'custom');
	t.is(out['cwd'], '/explicit');
	t.is(out['sessionId'], 's1');
	t.is(out['session_id'], 's1');
});

test('enrichHookContext ignores blank session keys', t => {
	const out = enrichHookContext({
		sessionId: '  ',
		session_id: '',
		messageCount: 3,
	} as Record<string, any>);

	t.is(out['sessionId'], undefined);
	t.is(out['session_id'], undefined);
	t.is(out['messageCount'], 3);
	t.is(out['platform'], 'snow');
	t.truthy(out['cwd']);
});
test('enrichHookContext passes through nullish', t => {
	t.is(enrichHookContext(undefined), undefined);
	t.is(enrichHookContext(null), null);
});

test('session start hook context uses the explicit target session id', t => {
	const messages = [
		{role: 'user', content: 'resume', timestamp: 1},
	] as ChatMessage[];
	const context = buildSessionStartHookContext(messages, 'target-session');

	t.is(context.sessionId, 'target-session');
	t.is(context.messageCount, 1);
	t.true(context.isResume);
});

test.serial(
	'reserved new session id is stable and used by lazy creation',
	async t => {
		sessionManager.clearCurrentSession();
		const reserved = sessionManager.reserveNewSessionId();

		t.is(sessionManager.reserveNewSessionId(), reserved);
		const session = await sessionManager.createNewSession(true, true);
		t.is(session.id, reserved);

		sessionManager.clearCurrentSession();
	},
);

test.serial(
	'clear flow can reserve the exact id used by the next session',
	async t => {
		sessionManager.clearCurrentSession();
		const nextSessionId = sessionManager.createSessionId();
		sessionManager.setPendingNewSessionId(nextSessionId);

		const session = await sessionManager.createNewSession(true, true);
		t.is(session.id, nextSessionId);

		sessionManager.clearCurrentSession();
	},
);
