import anyTest, {type TestFn} from 'ava';

import {
	AGENTS_INJECT_END_MARKER,
	resolvePersistedUserContent,
	stripPersistedAgentsContext,
} from '../prompt/contextInject/stripPersistedAgents.js';

const test = anyTest as unknown as TestFn;

test('strip simple heading + body + user text', t => {
	const dirty =
		'## Project Context (AGENTS.md)\n\ninjected\n\nreal user text';
	t.is(stripPersistedAgentsContext(dirty), 'real user text');
});

test('strip with end marker is exact', t => {
	const dirty = [
		'## Project Context (AGENTS.md)',
		'',
		'Instructions loaded from AGENTS.md (and optional CLAUDE.md fallback). Follow unless the user explicitly overrides. ROLE.md persona rules are separate and still apply.',
		'',
		'### Project AGENTS — `AGENTS.md`',
		'',
		'- rule body with blank lines',
		'',
		'still inject',
		'',
		AGENTS_INJECT_END_MARKER,
		'',
		'user says hi',
	].join('\n');
	t.is(stripPersistedAgentsContext(dirty), 'user says hi');
});

test('non-leading heading is left alone', t => {
	const text = 'please read ## Project Context (AGENTS.md) carefully';
	t.is(stripPersistedAgentsContext(text), text);
});

test('resolve prefers originalContent', t => {
	t.is(
		resolvePersistedUserContent({
			content: '## Project Context (AGENTS.md)\n\ninjected\n\ndirty',
			originalContent: 'clean',
		}),
		'clean',
	);
});
