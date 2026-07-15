import anyTest, {type TestFn} from 'ava';
import {existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {
	listSessionCommands,
	needsConfirmation,
	resolveSessionCommandMeta,
} from '../utils/execution/sessionCommandRegistry.js';
import {
	parseCmdArgv,
	runSessionCommand,
} from '../utils/execution/sessionCommandPlane.js';
import {
	assertCriticalOverlapPresent,
	CRITICAL_TUI_COMMAND_MODULES,
	getPlaneTopLevelCommands,
	PLANE_TUI_OVERLAP_COMMANDS,
} from '../utils/execution/sessionCommandParity.js';
import {
	configEvents,
	type ConfigChangeEvent,
} from '../utils/config/configEvents.js';

const test = anyTest as unknown as TestFn;

test('allowlist includes buddy and display commands', t => {
	const ids = listSessionCommands().map(c => c.id);
	t.true(ids.includes('buddy.hatch'));
	t.true(ids.includes('buddy.status'));
	t.true(ids.includes('buddy.set'));
	t.true(ids.includes('tool-display'));
	t.true(ids.includes('yolo'));
	t.true(ids.includes('mcp.status'));
	t.true(ids.includes('buddy.say'));
	t.true(ids.includes('theme.status'));
	t.true(ids.includes('mcp.reconnect'));
	t.true(ids.includes('session.list'));
	t.true(ids.includes('goal.status'));
	t.true(ids.includes('skills.list'));
	t.true(ids.includes('speedometer'));
	t.true(ids.includes('hybrid-compress'));
	t.true(ids.includes('auto-format'));
	t.true(ids.includes('image-compress'));
	t.true(ids.includes('subagent-depth'));
	t.true(ids.includes('file-list-display'));
	t.true(ids.includes('language'));
	t.true(ids.includes('show-thinking'));
	t.true(ids.includes('privacy'));
});

test('resolveSessionCommandMeta maps defaults and dotted form', t => {
	t.is(resolveSessionCommandMeta('buddy')?.id, 'buddy.status');
	t.is(resolveSessionCommandMeta('buddy', 'hatch Mochi')?.id, 'buddy.hatch');
	t.is(resolveSessionCommandMeta('buddy.hatch')?.id, 'buddy.hatch');
	t.is(resolveSessionCommandMeta('mcp')?.id, 'mcp.status');
	t.is(resolveSessionCommandMeta('tool-display')?.id, 'tool-display');
	t.is(resolveSessionCommandMeta('theme')?.id, 'theme.status');
	t.is(resolveSessionCommandMeta('session')?.id, 'session.list');
	t.is(resolveSessionCommandMeta('skills')?.id, 'skills.list');
	t.is(resolveSessionCommandMeta('goal')?.id, 'goal.status');
	t.is(resolveSessionCommandMeta('loop')?.id, 'loop.list');
	t.is(resolveSessionCommandMeta('config')?.id, 'config.snapshot');
	t.is(resolveSessionCommandMeta('statusline')?.id, 'statusline.status');
	t.is(resolveSessionCommandMeta('ide')?.id, 'ide.status');
	t.is(resolveSessionCommandMeta('subagent-depth')?.id, 'subagent-depth');
	t.is(resolveSessionCommandMeta('file-list-display')?.id, 'file-list-display');
	t.is(resolveSessionCommandMeta('language')?.id, 'language');
	t.is(resolveSessionCommandMeta('show-thinking')?.id, 'show-thinking');
	t.is(resolveSessionCommandMeta('privacy')?.id, 'privacy');
	t.is(resolveSessionCommandMeta('nope')?.id, undefined);
});

test('needsConfirmation gates medium and high risk', t => {
	const yolo = resolveSessionCommandMeta('yolo')!;
	const simple = resolveSessionCommandMeta('simple')!;
	const reset = resolveSessionCommandMeta('buddy', 'reset')!;

	t.false(needsConfirmation(simple, 'agent', false));
	t.true(needsConfirmation(yolo, 'agent', false));
	t.false(needsConfirmation(yolo, 'agent', true));
	t.true(needsConfirmation(reset, 'cli', false));
	t.false(needsConfirmation(reset, 'cli', true));
});

test('parseCmdArgv extracts json and yes flags', t => {
	const parsed = parseCmdArgv([
		'buddy',
		'hatch',
		'Pip',
		'--species=fox',
		'--json',
		'--yes',
	]);
	t.true(parsed.json);
	t.true(parsed.request.confirm);
	t.is(parsed.request.command, 'buddy');
	t.is(parsed.request.args, 'hatch Pip --species=fox');
});

test('runSessionCommand rejects unknown command', async t => {
	const result = await runSessionCommand({
		command: 'not-a-real-command',
		mode: 'cli',
	});
	t.false(result.ok);
	t.is(result.code, 'UNKNOWN_COMMAND');
});

test('runSessionCommand requires confirm for yolo on', async t => {
	const denied = await runSessionCommand({
		command: 'yolo',
		args: 'on',
		mode: 'agent',
		confirm: false,
	});
	t.false(denied.ok);
	t.is(denied.code, 'CONFIRMATION_REQUIRED');

	const allowed = await runSessionCommand({
		command: 'yolo',
		args: 'status',
		mode: 'agent',
	});
	// status/list/current are treated as read via isStatusOnlyArgs.
	t.true(allowed.ok);
	t.is(typeof (allowed.data as {enabled?: boolean})?.enabled, 'boolean');
});

test('runSessionCommand simple status is readable without confirm', async t => {
	const result = await runSessionCommand({
		command: 'simple',
		args: 'status',
		mode: 'cli',
	});
	t.true(result.ok);
	t.is(typeof (result.data as {enabled?: boolean})?.enabled, 'boolean');
});

test('runSessionCommand speedometer status/on/off without confirm', async t => {
	const status = await runSessionCommand({
		command: 'speedometer',
		args: 'status',
		mode: 'agent',
	});
	t.true(status.ok, status.message);
	const original = Boolean((status.data as {enabled?: boolean})?.enabled);

	try {
		const on = await runSessionCommand({
			command: 'speedometer',
			args: 'on',
			mode: 'agent',
		});
		t.true(on.ok, on.message);
		t.is((on.data as {enabled?: boolean})?.enabled, true);

		const mid = await runSessionCommand({
			command: 'speedometer',
			args: 'status',
			mode: 'agent',
		});
		t.true(mid.ok, mid.message);
		t.is((mid.data as {enabled?: boolean})?.enabled, true);

		const off = await runSessionCommand({
			command: 'speedometer',
			args: 'off',
			mode: 'agent',
		});
		t.true(off.ok, off.message);
		t.is((off.data as {enabled?: boolean})?.enabled, false);
	} finally {
		await runSessionCommand({
			command: 'speedometer',
			args: original ? 'on' : 'off',
			mode: 'agent',
		});
	}
});

test('runSessionCommand hybrid-compress status/toggle without confirm', async t => {
	const status = await runSessionCommand({
		command: 'hybrid-compress',
		args: 'status',
		mode: 'agent',
	});
	t.true(status.ok, status.message);
	const original = Boolean((status.data as {enabled?: boolean})?.enabled);

	try {
		const flipped = await runSessionCommand({
			command: 'hybrid-compress',
			args: original ? 'off' : 'on',
			mode: 'agent',
		});
		t.true(flipped.ok, flipped.message);
		t.is((flipped.data as {enabled?: boolean})?.enabled, !original);
	} finally {
		await runSessionCommand({
			command: 'hybrid-compress',
			args: original ? 'on' : 'off',
			mode: 'agent',
		});
	}
});

test('runSessionCommand subagent-depth status/set without confirm', async t => {
	const status = await runSessionCommand({
		command: 'subagent-depth',
		args: 'status',
		mode: 'agent',
	});
	t.true(status.ok, status.message);
	const original = Number((status.data as {depth?: number})?.depth);
	t.true(Number.isInteger(original));

	const target = original === 2 ? 3 : 2;
	try {
		const setResult = await runSessionCommand({
			command: 'subagent-depth',
			args: String(target),
			mode: 'agent',
		});
		t.true(setResult.ok, setResult.message);
		t.is((setResult.data as {depth?: number})?.depth, target);

		const mid = await runSessionCommand({
			command: 'subagent-depth',
			args: 'status',
			mode: 'agent',
		});
		t.true(mid.ok, mid.message);
		t.is((mid.data as {depth?: number})?.depth, target);

		const invalid = await runSessionCommand({
			command: 'subagent-depth',
			args: 'nope',
			mode: 'agent',
		});
		t.false(invalid.ok);
		t.is(invalid.code, 'INVALID_ARGS');
	} finally {
		await runSessionCommand({
			command: 'subagent-depth',
			args: String(original),
			mode: 'agent',
		});
	}
});

test('runSessionCommand file-list-display status/set without confirm', async t => {
	const status = await runSessionCommand({
		command: 'file-list-display',
		args: 'status',
		mode: 'agent',
	});
	t.true(status.ok, status.message);
	const original = (status.data as {mode?: string})?.mode;
	t.true(original === 'list' || original === 'tree');

	const target = original === 'list' ? 'tree' : 'list';
	try {
		const setResult = await runSessionCommand({
			command: 'file-list-display',
			args: target,
			mode: 'agent',
		});
		t.true(setResult.ok, setResult.message);
		t.is((setResult.data as {mode?: string})?.mode, target);

		const mid = await runSessionCommand({
			command: 'file-list-display',
			args: 'status',
			mode: 'agent',
		});
		t.true(mid.ok, mid.message);
		t.is((mid.data as {mode?: string})?.mode, target);

		const toggled = await runSessionCommand({
			command: 'file-list-display',
			args: 'toggle',
			mode: 'agent',
		});
		t.true(toggled.ok, toggled.message);
		t.is((toggled.data as {mode?: string})?.mode, original);

		const invalid = await runSessionCommand({
			command: 'file-list-display',
			args: 'grid',
			mode: 'agent',
		});
		t.false(invalid.ok);
		t.is(invalid.code, 'INVALID_ARGS');
	} finally {
		await runSessionCommand({
			command: 'file-list-display',
			args: original,
			mode: 'agent',
		});
	}
});

test('runSessionCommand language status/set without confirm', async t => {
	const status = await runSessionCommand({
		command: 'language',
		args: 'status',
		mode: 'agent',
	});
	t.true(status.ok, status.message);
	const original = (status.data as {language?: string})?.language;
	t.true(original === 'en' || original === 'zh' || original === 'zh-TW');

	const target = original === 'en' ? 'zh' : 'en';
	try {
		const setResult = await runSessionCommand({
			command: 'language',
			args: target,
			mode: 'agent',
		});
		t.true(setResult.ok, setResult.message);
		t.is((setResult.data as {language?: string})?.language, target);

		const mid = await runSessionCommand({
			command: 'language',
			args: 'status',
			mode: 'agent',
		});
		t.true(mid.ok, mid.message);
		t.is((mid.data as {language?: string})?.language, target);

		const invalid = await runSessionCommand({
			command: 'language',
			args: 'fr',
			mode: 'agent',
		});
		t.false(invalid.ok);
		t.is(invalid.code, 'INVALID_ARGS');
	} finally {
		await runSessionCommand({
			command: 'language',
			args: original,
			mode: 'agent',
		});
	}
});

test('runSessionCommand show-thinking status/toggle without confirm', async t => {
	const status = await runSessionCommand({
		command: 'show-thinking',
		args: 'status',
		mode: 'agent',
	});
	t.true(status.ok, status.message);
	const original = Boolean((status.data as {enabled?: boolean})?.enabled);

	try {
		const toggled = await runSessionCommand({
			command: 'show-thinking',
			args: 'toggle',
			mode: 'agent',
		});
		t.true(toggled.ok, toggled.message);
		t.is((toggled.data as {enabled?: boolean})?.enabled, !original);

		const mid = await runSessionCommand({
			command: 'show-thinking',
			args: 'status',
			mode: 'agent',
		});
		t.true(mid.ok, mid.message);
		t.is((mid.data as {enabled?: boolean})?.enabled, !original);
	} finally {
		await runSessionCommand({
			command: 'show-thinking',
			args: original ? 'on' : 'off',
			mode: 'agent',
		});
	}
});

test('runSessionCommand privacy status/mode with confirm', async t => {
	const status = await runSessionCommand({
		command: 'privacy',
		args: 'status',
		mode: 'agent',
		confirm: true,
	});
	t.true(status.ok, status.message);
	const originalEnabled = Boolean(
		(status.data as {enabled?: boolean})?.enabled,
	);
	const originalMode = (status.data as {mode?: string})?.mode;
	t.true(originalMode === 'api' || originalMode === 'local');

	const targetMode = originalMode === 'api' ? 'local' : 'api';
	try {
		const modeResult = await runSessionCommand({
			command: 'privacy',
			args: `mode ${targetMode}`,
			mode: 'agent',
			confirm: true,
		});
		t.true(modeResult.ok, modeResult.message);
		t.is((modeResult.data as {mode?: string})?.mode, targetMode);

		const setResult = await runSessionCommand({
			command: 'privacy',
			args: originalEnabled ? 'off' : 'on',
			mode: 'agent',
			confirm: true,
		});
		t.true(setResult.ok, setResult.message);
		t.is((setResult.data as {enabled?: boolean})?.enabled, !originalEnabled);
	} finally {
		await runSessionCommand({
			command: 'privacy',
			args: `mode ${originalMode}`,
			mode: 'agent',
			confirm: true,
		});
		await runSessionCommand({
			command: 'privacy',
			args: originalEnabled ? 'on' : 'off',
			mode: 'agent',
			confirm: true,
		});
	}
});

test('runSessionCommand codebase agent-review/reranking toggles', async t => {
	const status = await runSessionCommand({
		command: 'codebase',
		args: 'status',
		mode: 'agent',
		confirm: true,
	});
	t.true(status.ok, status.message);
	const originalReview = Boolean(
		(status.data as {enableAgentReview?: boolean})?.enableAgentReview,
	);
	const originalRerank = Boolean(
		(status.data as {enableReranking?: boolean})?.enableReranking,
	);

	try {
		const reviewOff = await runSessionCommand({
			command: 'codebase',
			args: 'agent-review off',
			mode: 'agent',
			confirm: true,
		});
		t.true(reviewOff.ok, reviewOff.message);
		t.is(
			(reviewOff.data as {enableAgentReview?: boolean})?.enableAgentReview,
			false,
		);

		const rerankOn = await runSessionCommand({
			command: 'codebase',
			args: 'reranking on',
			mode: 'agent',
			confirm: true,
		});
		t.true(rerankOn.ok, rerankOn.message);
		t.is((rerankOn.data as {enableReranking?: boolean})?.enableReranking, true);
		t.is(
			(rerankOn.data as {enableAgentReview?: boolean})?.enableAgentReview,
			false,
		);
	} finally {
		await runSessionCommand({
			command: 'codebase',
			args: originalReview ? 'agent-review on' : 'agent-review off',
			mode: 'agent',
			confirm: true,
		});
		await runSessionCommand({
			command: 'codebase',
			args: originalRerank ? 'reranking on' : 'reranking off',
			mode: 'agent',
			confirm: true,
		});
	}
});
test('runSessionCommand tool-display status returns mode', async t => {
	const result = await runSessionCommand({
		command: 'tool-display',
		args: 'status',
		mode: 'cli',
	});
	t.true(result.ok);
	t.truthy((result.data as {mode?: string})?.mode);
});

test('runSessionCommand lists allowlist via session-command', async t => {
	const result = await runSessionCommand({
		command: 'session-command',
		args: 'list',
		mode: 'agent',
	});
	t.true(result.ok);
	const data = result.data as {commands?: unknown[]};
	t.true(Array.isArray(data.commands));
	t.true((data.commands?.length ?? 0) > 5);
});

test('runSessionCommand buddy status returns structured data', async t => {
	const result = await runSessionCommand({
		command: 'buddy',
		args: 'status',
		mode: 'cli',
	});
	t.true(result.ok);
	t.is(typeof (result.data as {exists?: boolean})?.exists, 'boolean');
});

test('runSessionCommand export rejects invalid format', async t => {
	const result = await runSessionCommand({
		command: 'export',
		args: 'pdf',
		mode: 'cli',
		confirm: true,
	});
	t.false(result.ok);
	t.is(result.code, 'INVALID_ARGS');
});

test('runSessionCommand export without session fails clearly', async t => {
	const result = await runSessionCommand({
		command: 'export',
		args: 'md',
		mode: 'cli',
		confirm: true,
	});
	t.false(result.ok);
	t.true(
		result.code === 'SESSION_REQUIRED' || result.code === 'NOT_FOUND',
		`expected SESSION_REQUIRED or NOT_FOUND, got ${result.code}`,
	);
});

test('runSessionCommand compact without session fails clearly', async t => {
	const result = await runSessionCommand({
		command: 'compact',
		mode: 'cli',
		confirm: true,
	});
	t.false(result.ok);
	t.true(
		result.code === 'SESSION_REQUIRED' || result.code === 'NOT_FOUND',
		`expected SESSION_REQUIRED or NOT_FOUND, got ${result.code}`,
	);
});

test('runSessionCommand reindex fails when codebase disabled or invalid args', async t => {
	const invalid = await runSessionCommand({
		command: 'reindex',
		args: '--nope',
		mode: 'cli',
		confirm: true,
	});
	t.false(invalid.ok);
	t.is(invalid.code, 'INVALID_ARGS');

	// When codebase is disabled this should be NOT_CONFIGURED.
	// If enabled in the workspace, still assert a real domain result (not requested:true stub).
	const result = await runSessionCommand({
		command: 'reindex',
		mode: 'cli',
		confirm: true,
	});
	if (result.ok) {
		const data = result.data as {
			started?: boolean;
			completed?: boolean;
			requested?: boolean;
		};
		t.true(data.started === true || data.completed === true);
		t.falsy(data.requested);
	} else {
		t.true(
			result.code === 'NOT_CONFIGURED' || result.code === 'EXECUTION_FAILED',
			`expected NOT_CONFIGURED or EXECUTION_FAILED, got ${result.code}`,
		);
		const data = result.data as {requested?: boolean} | undefined;
		t.falsy(data?.requested);
	}
});

test('runSessionCommand theme status is readable without confirm', async t => {
	const result = await runSessionCommand({
		command: 'theme',
		args: 'status',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {
		theme?: string;
		simpleMode?: boolean;
		hasCustomColors?: boolean;
	};
	t.is(typeof data.theme, 'string');
	t.is(typeof data.simpleMode, 'boolean');
	t.is(typeof data.hasCustomColors, 'boolean');
});

test('runSessionCommand permissions status returns alwaysApprovedTools', async t => {
	const result = await runSessionCommand({
		command: 'permissions',
		args: 'status',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {alwaysApprovedTools?: unknown};
	t.true(Array.isArray(data.alwaysApprovedTools));
});

test('runSessionCommand session list ok', async t => {
	const result = await runSessionCommand({
		command: 'session',
		args: 'list',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {sessions?: unknown[]; total?: number};
	t.true(Array.isArray(data.sessions));
	t.is(typeof data.total, 'number');
});

test('runSessionCommand help ok', async t => {
	const result = await runSessionCommand({
		command: 'help',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {commands?: unknown[]; examples?: unknown[]};
	t.true(Array.isArray(data.commands));
	t.true((data.commands?.length ?? 0) > 5);
	t.true(Array.isArray(data.examples));
});

test('runSessionCommand buddy say empty message fails clearly', async t => {
	const result = await runSessionCommand({
		command: 'buddy',
		args: 'say',
		mode: 'cli',
	});
	t.false(result.ok);
	t.true(
		result.code === 'INVALID_ARGS' || result.code === 'NOT_FOUND',
		`expected INVALID_ARGS or NOT_FOUND, got ${result.code}`,
	);
});

test('runSessionCommand unknown still UNKNOWN_COMMAND', async t => {
	const result = await runSessionCommand({
		command: 'definitely-not-real',
		mode: 'agent',
	});
	t.false(result.ok);
	t.is(result.code, 'UNKNOWN_COMMAND');
});

test('runSessionCommand statusline status returns plugins and builtins', async t => {
	const result = await runSessionCommand({
		command: 'statusline',
		args: 'status',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {
		plugins?: unknown[];
		builtinIds?: unknown[];
	};
	t.true(Array.isArray(data.plugins));
	t.true(Array.isArray(data.builtinIds));
});

test('runSessionCommand ide status returns structured connection data', async t => {
	const result = await runSessionCommand({
		command: 'ide',
		args: 'status',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {
		connected?: boolean;
		available?: unknown;
	};
	t.is(typeof data.connected, 'boolean');
	t.true('available' in data);
});

test('runSessionCommand connection-status aliases ide status', async t => {
	const result = await runSessionCommand({
		command: 'connection-status',
		mode: 'cli',
	});
	t.true(result.ok);
	t.is(typeof (result.data as {connected?: boolean})?.connected, 'boolean');
});

test('runSessionCommand goal status ok', async t => {
	const result = await runSessionCommand({
		command: 'goal',
		args: 'status',
		mode: 'cli',
	});
	t.true(result.ok);
	t.is(typeof (result.data as {exists?: boolean})?.exists, 'boolean');
});

test('runSessionCommand loop list ok', async t => {
	const result = await runSessionCommand({
		command: 'loop',
		args: 'list',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {loops?: unknown[]; total?: number};
	t.true(Array.isArray(data.loops));
	t.is(typeof data.total, 'number');
});

test('runSessionCommand skills list ok', async t => {
	const result = await runSessionCommand({
		command: 'skills',
		args: 'list',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {skills?: unknown[]; total?: number};
	t.true(Array.isArray(data.skills));
	t.is(typeof data.total, 'number');
});

test('runSessionCommand config snapshot is secret-free', async t => {
	const result = await runSessionCommand({
		command: 'config',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as Record<string, unknown>;
	t.truthy(data);
	const secretLike = ['apiKey', 'api_key', 'password', 'token', 'secret'];
	for (const key of secretLike) {
		t.false(
			Object.prototype.hasOwnProperty.call(data, key),
			`config snapshot must not expose top-level secret field: ${key}`,
		);
	}
	t.is(typeof data['profile'], 'string');
	t.is(typeof data['theme'], 'string');
	t.is(typeof data['subAgentMaxSpawnDepth'], 'number');
	t.true(
		data['fileListDisplayMode'] === 'list' ||
			data['fileListDisplayMode'] === 'tree',
	);
});

test('runSessionCommand home is HEADLESS_UNSUPPORTED', async t => {
	const result = await runSessionCommand({
		command: 'home',
		mode: 'cli',
	});
	t.false(result.ok);
	t.is(result.code, 'HEADLESS_UNSUPPORTED');
});

test('runSessionCommand permissions clear without confirm requires confirmation', async t => {
	const result = await runSessionCommand({
		command: 'permissions',
		args: 'clear',
		mode: 'cli',
		confirm: false,
	});
	t.false(result.ok);
	t.is(result.code, 'CONFIRMATION_REQUIRED');
});

// ---------------------------------------------------------------------------
// Issue #190 hardening — Phase 1: confirmation gates + stable failure codes
// ---------------------------------------------------------------------------

test('hardening: medium/high writes require confirm (table-driven)', async t => {
	const confirmRequiredCases: Array<{command: string; args?: string}> = [
		{command: 'yolo', args: 'on'},
		{command: 'plan', args: 'on'},
		{command: 'tool-search', args: 'on'},
		{command: 'team', args: 'on'},
		{command: 'ultra-todo', args: 'on'},
		{command: 'vulnerability-hunting', args: 'on'},
		{command: 'mcp', args: 'reconnect fake-service'},
		{command: 'mcp', args: 'enable fake-service'},
		{command: 'mcp', args: 'disable fake-service'},
		{command: 'ide', args: 'connect'},
		{command: 'ide', args: 'disconnect'},
		{command: 'profiles', args: 'switch nonexistent-profile'},
		{command: 'codebase', args: 'on'},
		{command: 'reindex'},
		{command: 'telemetry', args: 'on'},
		{command: 'compact'},
		{command: 'permissions', args: 'allow temp-tool-x'},
		{command: 'permissions', args: 'revoke temp-tool-x'},
		{command: 'permissions', args: 'clear'},
		{command: 'session', args: 'resume some-id'},
		{command: 'session', args: 'load some-id'},
		{command: 'session', args: 'branch'},
		{command: 'goal', args: 'pause'},
		{command: 'goal', args: 'resume'},
		{command: 'goal', args: 'clear'},
		{command: 'loop', args: 'create 5m do something'},
		{command: 'loop', args: 'cancel fake-id'},
		{command: 'skills', args: 'enable snow-docs'},
		{command: 'skills', args: 'disable snow-docs'},
		{command: 'buddy', args: 'reset'},
	];

	for (const [index, c] of confirmRequiredCases.entries()) {
		const mode = index % 2 === 0 ? 'agent' : 'cli';
		const result = await runSessionCommand({
			command: c.command,
			args: c.args,
			mode,
			confirm: false,
		});
		t.false(
			result.ok,
			`${c.command} ${c.args ?? ''} (${mode}) should fail without confirm`,
		);
		t.is(
			result.code,
			'CONFIRMATION_REQUIRED',
			`${c.command} ${c.args ?? ''} (${mode}) => ${result.code}: ${
				result.message
			}`,
		);
	}
});

test('hardening: stable failure codes for write paths', async t => {
	const mcpReconnectEmpty = await runSessionCommand({
		command: 'mcp',
		args: 'reconnect',
		mode: 'cli',
		confirm: true,
	});
	t.false(mcpReconnectEmpty.ok);
	t.is(mcpReconnectEmpty.code, 'INVALID_ARGS');

	const mcpEnableEmpty = await runSessionCommand({
		command: 'mcp',
		args: 'enable',
		mode: 'cli',
		confirm: true,
	});
	t.false(mcpEnableEmpty.ok);
	t.is(mcpEnableEmpty.code, 'INVALID_ARGS');

	const sessionResumeEmpty = await runSessionCommand({
		command: 'session',
		args: 'resume',
		mode: 'cli',
		confirm: true,
	});
	t.false(sessionResumeEmpty.ok);
	t.is(sessionResumeEmpty.code, 'INVALID_ARGS');

	const sessionResumeMissing = await runSessionCommand({
		command: 'session',
		args: 'resume __no_such_session_190_hardening__',
		mode: 'cli',
		confirm: true,
	});
	t.false(sessionResumeMissing.ok);
	t.is(sessionResumeMissing.code, 'NOT_FOUND');

	const sessionBranch = await runSessionCommand({
		command: 'session',
		args: 'branch',
		mode: 'cli',
		confirm: true,
	});
	if (sessionBranch.ok) {
		// Environment already has a current session; branch succeeded — acceptable.
		t.pass('session.branch executed with an active session');
	} else {
		t.true(
			sessionBranch.code === 'SESSION_REQUIRED' ||
				sessionBranch.code === 'NOT_FOUND' ||
				sessionBranch.code === 'EXECUTION_FAILED',
			`session.branch expected SESSION_REQUIRED/NOT_FOUND/EXECUTION_FAILED, got ${sessionBranch.code}`,
		);
	}

	const goalCreateEmpty = await runSessionCommand({
		command: 'goal',
		args: 'create',
		mode: 'cli',
		confirm: true,
	});
	t.false(goalCreateEmpty.ok);
	t.is(goalCreateEmpty.code, 'INVALID_ARGS');

	// Ensure no residual goal, then pause should be NOT_FOUND.
	await runSessionCommand({
		command: 'goal',
		args: 'clear',
		mode: 'cli',
		confirm: true,
	});
	const goalPauseNone = await runSessionCommand({
		command: 'goal',
		args: 'pause',
		mode: 'cli',
		confirm: true,
	});
	t.false(goalPauseNone.ok);
	t.is(goalPauseNone.code, 'NOT_FOUND');

	const loopCancelEmpty = await runSessionCommand({
		command: 'loop',
		args: 'cancel',
		mode: 'cli',
		confirm: true,
	});
	t.false(loopCancelEmpty.ok);
	t.is(loopCancelEmpty.code, 'INVALID_ARGS');

	const loopCancelMissing = await runSessionCommand({
		command: 'loop',
		args: 'cancel __no_such_loop__',
		mode: 'cli',
		confirm: true,
	});
	t.false(loopCancelMissing.ok);
	t.is(loopCancelMissing.code, 'NOT_FOUND');

	const skillsEnableEmpty = await runSessionCommand({
		command: 'skills',
		args: 'enable',
		mode: 'cli',
		confirm: true,
	});
	t.false(skillsEnableEmpty.ok);
	t.is(skillsEnableEmpty.code, 'INVALID_ARGS');

	const permissionsAllowEmpty = await runSessionCommand({
		command: 'permissions',
		args: 'allow',
		mode: 'cli',
		confirm: true,
	});
	t.false(permissionsAllowEmpty.ok);
	t.is(permissionsAllowEmpty.code, 'INVALID_ARGS');

	const themeInvalid = await runSessionCommand({
		command: 'theme',
		args: 'set __not_a_theme__',
		mode: 'cli',
		confirm: true,
	});
	t.false(themeInvalid.ok);
	t.is(themeInvalid.code, 'INVALID_ARGS');

	// External MCP service without tool name → INVALID_ARGS (skip if none configured).
	const mcpStatus = await runSessionCommand({
		command: 'mcp',
		args: 'status',
		mode: 'cli',
	});
	if (mcpStatus.ok) {
		const services =
			(
				mcpStatus.data as {
					services?: Array<{name?: string; isBuiltIn?: boolean}>;
				}
			)?.services ?? [];
		const external = services.find(s => s.name && s.isBuiltIn === false);
		if (external?.name) {
			const enableExternal = await runSessionCommand({
				command: 'mcp',
				args: `enable ${external.name}`,
				mode: 'cli',
				confirm: true,
			});
			t.false(enableExternal.ok);
			t.is(
				enableExternal.code,
				'INVALID_ARGS',
				`external mcp enable without tool: ${enableExternal.code} ${enableExternal.message}`,
			);
		} else {
			t.pass(
				'no external MCP services configured; skip external-tool-required case',
			);
		}
	} else {
		t.pass(`mcp status unavailable (${mcpStatus.code}); skip external case`);
	}
});

test('hardening: status queries remain free of confirm', async t => {
	const cases: Array<{command: string; args?: string}> = [
		{command: 'permissions', args: 'status'},
		{command: 'mcp', args: 'status'},
		{command: 'session', args: 'current'},
		{command: 'loop', args: 'tasks'},
	];
	for (const c of cases) {
		const result = await runSessionCommand({
			command: c.command,
			args: c.args,
			mode: 'cli',
			confirm: false,
		});
		t.true(
			result.ok,
			`${c.command} ${c.args} should be free: ${result.code} ${result.message}`,
		);
	}
});

// ---------------------------------------------------------------------------
// Issue #190 hardening — Phase 2: reversible write paths
// ---------------------------------------------------------------------------

test('hardening: theme toolDisplay reversible write', async t => {
	const status = await runSessionCommand({
		command: 'theme',
		args: 'status',
		mode: 'cli',
	});
	t.true(status.ok);
	const original =
		(status.data as {toolDisplay?: string})?.toolDisplay ?? 'full';
	const next = original === 'compact' ? 'full' : 'compact';

	try {
		const setResult = await runSessionCommand({
			command: 'theme',
			args: `set toolDisplay=${next}`,
			mode: 'cli',
		});
		t.true(setResult.ok, setResult.message);
		const after = await runSessionCommand({
			command: 'theme',
			args: 'status',
			mode: 'cli',
		});
		t.true(after.ok);
		t.is((after.data as {toolDisplay?: string})?.toolDisplay, next);
	} finally {
		await runSessionCommand({
			command: 'theme',
			args: `set toolDisplay=${original}`,
			mode: 'cli',
		});
	}
});

test('hardening: permissions allow/revoke reversible', async t => {
	const tool = 'session-command-hardening-temp-tool';
	try {
		const allow = await runSessionCommand({
			command: 'permissions',
			args: `allow ${tool}`,
			mode: 'cli',
			confirm: true,
		});
		t.true(allow.ok, allow.message);

		const status = await runSessionCommand({
			command: 'permissions',
			args: 'status',
			mode: 'cli',
		});
		t.true(status.ok);
		const tools =
			(status.data as {alwaysApprovedTools?: string[]})?.alwaysApprovedTools ??
			[];
		t.true(tools.includes(tool), `expected ${tool} in alwaysApprovedTools`);

		const revoke = await runSessionCommand({
			command: 'permissions',
			args: `revoke ${tool}`,
			mode: 'cli',
			confirm: true,
		});
		t.true(revoke.ok, revoke.message);

		const after = await runSessionCommand({
			command: 'permissions',
			args: 'status',
			mode: 'cli',
		});
		t.true(after.ok);
		const afterTools =
			(after.data as {alwaysApprovedTools?: string[]})?.alwaysApprovedTools ??
			[];
		t.false(afterTools.includes(tool));
	} finally {
		await runSessionCommand({
			command: 'permissions',
			args: `revoke ${tool}`,
			mode: 'cli',
			confirm: true,
		});
	}
});

test('hardening: skills enable/disable reversible when skill exists', async t => {
	const list = await runSessionCommand({
		command: 'skills',
		args: 'list',
		mode: 'cli',
	});
	t.true(list.ok);
	const skills =
		(list.data as {skills?: Array<{id?: string; enabled?: boolean}>})?.skills ??
		[];
	const target =
		skills.find(s => s.id === 'snow-docs') ?? skills.find(s => Boolean(s.id));
	if (!target?.id) {
		t.pass('no skills available; skip enable/disable reversible test');
		return;
	}

	const skillId = target.id;
	const statusBefore = await runSessionCommand({
		command: 'skills',
		args: `status ${skillId}`,
		mode: 'cli',
	});
	t.true(statusBefore.ok);
	const originalEnabled = Boolean(
		(statusBefore.data as {enabled?: boolean})?.enabled,
	);

	try {
		const flipTo = originalEnabled ? 'disable' : 'enable';
		const flip = await runSessionCommand({
			command: 'skills',
			args: `${flipTo} ${skillId}`,
			mode: 'cli',
			confirm: true,
		});
		t.true(flip.ok, flip.message);

		const mid = await runSessionCommand({
			command: 'skills',
			args: `status ${skillId}`,
			mode: 'cli',
		});
		t.true(mid.ok);
		t.is(Boolean((mid.data as {enabled?: boolean})?.enabled), !originalEnabled);
	} finally {
		const restore = originalEnabled ? 'enable' : 'disable';
		await runSessionCommand({
			command: 'skills',
			args: `${restore} ${skillId}`,
			mode: 'cli',
			confirm: true,
		});
	}
});

test('hardening: goal create/clear reversible', async t => {
	const objective = `hardening-goal-${Date.now()}`;
	try {
		// Clear any existing goal first so create is deterministic.
		await runSessionCommand({
			command: 'goal',
			args: 'clear',
			mode: 'cli',
			confirm: true,
		});

		const created = await runSessionCommand({
			command: 'goal',
			args: `create ${objective}`,
			mode: 'cli',
		});
		t.true(created.ok, created.message);

		const status = await runSessionCommand({
			command: 'goal',
			args: 'status',
			mode: 'cli',
		});
		t.true(status.ok);
		t.is((status.data as {exists?: boolean})?.exists, true);

		const cleared = await runSessionCommand({
			command: 'goal',
			args: 'clear',
			mode: 'cli',
			confirm: true,
		});
		t.true(cleared.ok, cleared.message);

		const after = await runSessionCommand({
			command: 'goal',
			args: 'status',
			mode: 'cli',
		});
		t.true(after.ok);
		t.is((after.data as {exists?: boolean})?.exists, false);
	} finally {
		await runSessionCommand({
			command: 'goal',
			args: 'clear',
			mode: 'cli',
			confirm: true,
		});
	}
});

test('hardening: loop invalid schedule and optional create/cancel', async t => {
	// Freeform text falls back to default interval; interval-without-prompt is invalid.
	const invalid = await runSessionCommand({
		command: 'loop',
		args: 'create 5m',
		mode: 'cli',
		confirm: true,
	});
	t.false(invalid.ok);
	t.is(invalid.code, 'INVALID_ARGS');

	let createdId: string | undefined;
	try {
		const created = await runSessionCommand({
			command: 'loop',
			args: 'create 5m hardening-probe',
			mode: 'cli',
			confirm: true,
		});
		if (!created.ok) {
			t.pass(
				`loop create 5m not supported here (${created.code}); invalid schedule covered`,
			);
			return;
		}
		createdId = (created.data as {loop?: {id?: string}})?.loop?.id;
		t.truthy(createdId);

		const list = await runSessionCommand({
			command: 'loop',
			args: 'list',
			mode: 'cli',
		});
		t.true(list.ok);
		const loops = (list.data as {loops?: Array<{id?: string}>})?.loops ?? [];
		t.true(loops.some(l => l.id === createdId));
	} finally {
		if (createdId) {
			await runSessionCommand({
				command: 'loop',
				args: `cancel ${createdId}`,
				mode: 'cli',
				confirm: true,
			});
		}
	}
});

test('hardening: session.current structured fields', async t => {
	const result = await runSessionCommand({
		command: 'session',
		args: 'current',
		mode: 'cli',
	});
	t.true(result.ok);
	const data = result.data as {exists?: boolean; session?: unknown};
	t.is(typeof data.exists, 'boolean');
	if (data.exists) {
		t.truthy(data.session);
	} else {
		t.is(data.session, null);
	}
});

test('hardening: usage returns object data', async t => {
	const result = await runSessionCommand({
		command: 'usage',
		mode: 'cli',
	});
	t.true(result.ok, result.message);
	t.is(typeof result.data, 'object');
	t.truthy(result.data);
});

test('hardening: config.snapshot has no secret-like keys (deep)', async t => {
	const result = await runSessionCommand({
		command: 'config',
		mode: 'cli',
	});
	t.true(result.ok);
	const secretKey =
		/^(api[_-]?key|password|secret|token|access[_-]?token|refresh[_-]?token|authorization|auth[_-]?header)$/i;

	const walk = (value: unknown, path: string, depth: number): void => {
		if (depth > 6 || value == null) {
			return;
		}
		if (Array.isArray(value)) {
			for (const [i, item] of value.entries()) {
				walk(item, `${path}[${i}]`, depth + 1);
			}
			return;
		}
		if (typeof value !== 'object') {
			return;
		}
		for (const [key, child] of Object.entries(
			value as Record<string, unknown>,
		)) {
			t.false(
				secretKey.test(key),
				`config snapshot must not expose secret-like key at ${path}.${key}`,
			);
			walk(child, path ? `${path}.${key}` : key, depth + 1);
		}
	};

	walk(result.data, 'snapshot', 0);
});

// ---------------------------------------------------------------------------
// Issue #190 hardening — Phase 3: allowlist integrity + dual-path parity
// ---------------------------------------------------------------------------

test('hardening: allowlist integrity never returns HEADLESS_UNSUPPORTED except home', async t => {
	const allowedCodes = new Set([
		undefined,
		'CONFIRMATION_REQUIRED',
		'INVALID_ARGS',
		'NOT_FOUND',
		'NOT_CONFIGURED',
		'SESSION_REQUIRED',
		'EXECUTION_FAILED',
		'ALREADY_EXISTS',
		'COMMAND_NOT_ALLOWED',
	]);

	for (const meta of listSessionCommands()) {
		if (meta.id === 'home') {
			continue;
		}
		// Probe without confirm for write commands to avoid side effects.
		// Prefer dotted id form so subcommands resolve correctly.
		const result = await runSessionCommand({
			command: meta.id,
			mode: 'cli',
			confirm: false,
		});
		t.not(
			result.code,
			'HEADLESS_UNSUPPORTED',
			`${meta.id} unexpectedly HEADLESS_UNSUPPORTED: ${result.message}`,
		);
		if (!result.ok) {
			t.true(
				allowedCodes.has(result.code),
				`${meta.id} unexpected failure code ${result.code}: ${result.message}`,
			);
		}
	}
});

test('hardening: risk metadata sanity', t => {
	for (const meta of listSessionCommands()) {
		if (meta.risk === 'medium_write' || meta.risk === 'high_risk') {
			t.true(
				Boolean(meta.requiresConfirm),
				`${meta.id} medium/high should requireConfirm`,
			);
		}
		if (meta.risk === 'read') {
			t.false(
				Boolean(meta.requiresConfirm),
				`${meta.id} read should not requireConfirm`,
			);
		}
	}
});

test('hardening: plane/TUI overlap inventory', t => {
	const plane = new Set(getPlaneTopLevelCommands());
	for (const name of PLANE_TUI_OVERLAP_COMMANDS) {
		t.true(plane.has(name), `plane missing top-level ${name}`);
	}

	const check = assertCriticalOverlapPresent();
	t.deepEqual(check.missingFromPlane, []);
	t.deepEqual(check.missingTuiModules, []);

	const here = dirname(fileURLToPath(import.meta.url));
	const commandsDir = join(here, '../utils/commands');
	for (const file of CRITICAL_TUI_COMMAND_MODULES) {
		t.true(
			existsSync(join(commandsDir, file)),
			`missing TUI command module ${file}`,
		);
	}
});

test('hardening: same-process plan/yolo/theme writes emit configEvents', async t => {
	const seen: ConfigChangeEvent[] = [];
	const onChange = (event: ConfigChangeEvent) => {
		seen.push(event);
	};
	configEvents.onConfigChange(onChange);

	const planStatus = await runSessionCommand({
		command: 'plan',
		args: 'status',
		mode: 'agent',
	});
	t.true(planStatus.ok, planStatus.message);
	const originalPlan = Boolean(
		(planStatus.data as {enabled?: boolean})?.enabled,
	);

	const yoloStatus = await runSessionCommand({
		command: 'yolo',
		args: 'status',
		mode: 'agent',
	});
	t.true(yoloStatus.ok, yoloStatus.message);
	const originalYolo = Boolean(
		(yoloStatus.data as {enabled?: boolean})?.enabled,
	);

	const themeStatus = await runSessionCommand({
		command: 'theme',
		args: 'status',
		mode: 'cli',
	});
	t.true(themeStatus.ok, themeStatus.message);
	const originalTheme = (themeStatus.data as {theme?: string})?.theme ?? 'dark';
	const availableThemes =
		(themeStatus.data as {availableThemes?: string[]})?.availableThemes ?? [];
	const nextTheme =
		availableThemes.find(name => name !== originalTheme) ??
		(originalTheme === 'dark' ? 'light' : 'dark');

	try {
		seen.length = 0;
		const planOn = await runSessionCommand({
			command: 'plan',
			args: originalPlan ? 'off' : 'on',
			mode: 'agent',
			confirm: true,
		});
		t.true(planOn.ok, planOn.message);
		t.true(
			seen.some(
				e => e.type === 'planMode' && Boolean(e.value) === !originalPlan,
			),
			`expected planMode=${!originalPlan}, got ${JSON.stringify(seen)}`,
		);

		seen.length = 0;
		const yoloOn = await runSessionCommand({
			command: 'yolo',
			args: originalYolo ? 'off' : 'on',
			mode: 'agent',
			confirm: true,
		});
		t.true(yoloOn.ok, yoloOn.message);
		t.true(
			seen.some(
				e => e.type === 'yoloMode' && Boolean(e.value) === !originalYolo,
			),
			`expected yoloMode=${!originalYolo}, got ${JSON.stringify(seen)}`,
		);

		seen.length = 0;
		const themeSet = await runSessionCommand({
			command: 'theme',
			args: `set ${nextTheme}`,
			mode: 'cli',
		});
		t.true(themeSet.ok, themeSet.message);
		t.true(
			seen.some(e => e.type === 'theme' && e.value === nextTheme),
			`expected theme=${nextTheme}, got ${JSON.stringify(seen)}`,
		);
	} finally {
		configEvents.removeConfigChangeListener(onChange);
		await runSessionCommand({
			command: 'plan',
			args: originalPlan ? 'on' : 'off',
			mode: 'agent',
			confirm: true,
		});
		await runSessionCommand({
			command: 'yolo',
			args: originalYolo ? 'on' : 'off',
			mode: 'agent',
			confirm: true,
		});
		await runSessionCommand({
			command: 'theme',
			args: `set ${originalTheme}`,
			mode: 'cli',
		});
	}
});

test('hardening: same-process matrix writes emit configEvents', async t => {
	const seen: ConfigChangeEvent[] = [];
	const onChange = (event: ConfigChangeEvent) => {
		seen.push(event);
	};
	configEvents.onConfigChange(onChange);

	const hybridStatus = await runSessionCommand({
		command: 'hybrid-compress',
		args: 'status',
		mode: 'agent',
	});
	t.true(hybridStatus.ok, hybridStatus.message);
	const originalHybrid = Boolean(
		(hybridStatus.data as {enabled?: boolean})?.enabled,
	);

	const speedStatus = await runSessionCommand({
		command: 'speedometer',
		args: 'status',
		mode: 'agent',
	});
	t.true(speedStatus.ok, speedStatus.message);
	const originalSpeed = Boolean(
		(speedStatus.data as {enabled?: boolean})?.enabled,
	);

	const depthStatus = await runSessionCommand({
		command: 'subagent-depth',
		args: 'status',
		mode: 'agent',
	});
	t.true(depthStatus.ok, depthStatus.message);
	const originalDepth = Number(
		(depthStatus.data as {depth?: number})?.depth ?? 0,
	);

	const fileListStatus = await runSessionCommand({
		command: 'file-list-display',
		args: 'status',
		mode: 'agent',
	});
	t.true(fileListStatus.ok, fileListStatus.message);
	const originalFileList =
		((fileListStatus.data as {mode?: string})?.mode as 'list' | 'tree') ??
		'list';

	const languageStatus = await runSessionCommand({
		command: 'language',
		args: 'status',
		mode: 'agent',
	});
	t.true(languageStatus.ok, languageStatus.message);
	const originalLanguage =
		((languageStatus.data as {language?: string})?.language as string) ?? 'en';

	const nextLanguage = originalLanguage === 'en' ? 'zh' : 'en';
	const nextDepth = originalDepth === 2 ? 3 : 2;
	const nextFileList = originalFileList === 'list' ? 'tree' : 'list';

	try {
		seen.length = 0;
		const hybridWrite = await runSessionCommand({
			command: 'hybrid-compress',
			args: originalHybrid ? 'off' : 'on',
			mode: 'agent',
		});
		t.true(hybridWrite.ok, hybridWrite.message);
		t.true(
			seen.some(
				e =>
					e.type === 'hybridCompressEnabled' &&
					Boolean(e.value) === !originalHybrid,
			),
			`expected hybridCompressEnabled=${!originalHybrid}, got ${JSON.stringify(
				seen,
			)}`,
		);

		seen.length = 0;
		const speedWrite = await runSessionCommand({
			command: 'speedometer',
			args: originalSpeed ? 'off' : 'on',
			mode: 'agent',
		});
		t.true(speedWrite.ok, speedWrite.message);
		t.true(
			seen.some(
				e =>
					e.type === 'speedometerEnabled' &&
					Boolean(e.value) === !originalSpeed,
			),
			`expected speedometerEnabled=${!originalSpeed}, got ${JSON.stringify(
				seen,
			)}`,
		);

		seen.length = 0;
		const depthWrite = await runSessionCommand({
			command: 'subagent-depth',
			args: String(nextDepth),
			mode: 'agent',
		});
		t.true(depthWrite.ok, depthWrite.message);
		t.true(
			seen.some(
				e => e.type === 'subAgentMaxSpawnDepth' && e.value === nextDepth,
			),
			`expected subAgentMaxSpawnDepth=${nextDepth}, got ${JSON.stringify(
				seen,
			)}`,
		);

		seen.length = 0;
		const fileListWrite = await runSessionCommand({
			command: 'file-list-display',
			args: nextFileList,
			mode: 'agent',
		});
		t.true(fileListWrite.ok, fileListWrite.message);
		t.true(
			seen.some(
				e => e.type === 'fileListDisplayMode' && e.value === nextFileList,
			),
			`expected fileListDisplayMode=${nextFileList}, got ${JSON.stringify(
				seen,
			)}`,
		);

		seen.length = 0;
		const languageWrite = await runSessionCommand({
			command: 'language',
			args: nextLanguage,
			mode: 'agent',
		});
		t.true(languageWrite.ok, languageWrite.message);
		t.true(
			seen.some(e => e.type === 'language' && e.value === nextLanguage),
			`expected language=${nextLanguage}, got ${JSON.stringify(seen)}`,
		);
	} finally {
		configEvents.removeConfigChangeListener(onChange);
		await runSessionCommand({
			command: 'hybrid-compress',
			args: originalHybrid ? 'on' : 'off',
			mode: 'agent',
		});
		await runSessionCommand({
			command: 'speedometer',
			args: originalSpeed ? 'on' : 'off',
			mode: 'agent',
		});
		await runSessionCommand({
			command: 'subagent-depth',
			args: String(originalDepth),
			mode: 'agent',
		});
		await runSessionCommand({
			command: 'file-list-display',
			args: originalFileList,
			mode: 'agent',
		});
		await runSessionCommand({
			command: 'language',
			args: originalLanguage,
			mode: 'agent',
		});
	}
});
