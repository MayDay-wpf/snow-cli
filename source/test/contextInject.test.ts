import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
	applyBudget,
	appendInjectedRules,
	clearContextInjectCache,
	dedupeLoadedSources,
	discoverContextSources,
	getInjectedRulesDetails,
	getInjectedRulesSection,
	prependAgentsContext,
	prependAgentsContextFromSection,
	renderInjectedRulesSection,
	resolveContextInjectConfig,
	summarizeAgentsMd,
} from '../prompt/contextInject/index.js';
import type {
	LoadedSource,
	ResolvedContextInjectConfig,
} from '../prompt/contextInject/types.js';
import {DEFAULT_CONTEXT_INJECT} from '../prompt/contextInject/defaults.js';
import {
	contentFingerprint,
	dedupeByContentOrder,
	isSameInjectContent,
} from '../prompt/shared/contentDedupe.js';
import {
	getSystemPromptWithRole,
	renderRoleSourcesSection,
} from '../prompt/shared/promptHelpers.js';

const test = anyTest as unknown as TestFn;

async function makeTempDir(prefix: string): Promise<string> {
	return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Opt-in AGENTS inject for a temp project (default is off). */
async function enableContextInject(dir: string): Promise<void> {
	const snowDir = path.join(dir, '.snow');
	await fs.promises.mkdir(snowDir, {recursive: true});
	await fs.promises.writeFile(
		path.join(snowDir, 'settings.json'),
		JSON.stringify({contextInject: {enabled: true}}, null, 2),
		'utf-8',
	);
}

function baseConfig(
	overrides: Partial<ResolvedContextInjectConfig> = {},
): ResolvedContextInjectConfig {
	return {
		enabled: true,
		budgetChars: DEFAULT_CONTEXT_INJECT.budgetChars,
		profile: 'full',
		fallbackFilenames: [...DEFAULT_CONTEXT_INJECT.fallbackFilenames],
		writeBreadcrumb: false,
		primaryFilename: DEFAULT_CONTEXT_INJECT.primaryFilename,
		compactBudgetChars: DEFAULT_CONTEXT_INJECT.compactBudgetChars,
		perFileMax: DEFAULT_CONTEXT_INJECT.perFileMax,
		...overrides,
	};
}

function makeLoaded(
	partial: Partial<LoadedSource> &
		Pick<LoadedSource, 'kind' | 'content' | 'absPath'>,
): LoadedSource {
	const content = partial.content;
	return {
		kind: partial.kind,
		absPath: partial.absPath,
		relLabel: partial.relLabel ?? path.basename(partial.absPath),
		priority: partial.priority ?? 10,
		content,
		chars: partial.chars ?? content.length,
		truncated: partial.truncated ?? false,
		mtimeMs: partial.mtimeMs ?? Date.now(),
	};
}

test('summarizeAgentsMd strips frontmatter and truncates', t => {
	const short = summarizeAgentsMd('# Hi\n\nHello', 100);
	t.is(short, '# Hi\n\nHello');

	const withFm = summarizeAgentsMd('---\ntitle: x\n---\n\n# Body\n\ntext', 100);
	t.true(withFm.startsWith('# Body'));
	t.false(withFm.includes('title: x'));

	const long = 'A'.repeat(2000);
	const summarized = summarizeAgentsMd(long, 100);
	t.true(summarized.length <= 100);
	t.true(summarized.endsWith('...(truncated)'));
});

test('applyBudget keeps earlier sources when over budget', t => {
	const loaded = [
		makeLoaded({
			kind: 'global-agents',
			absPath: '/g/AGENTS.md',
			relLabel: 'global',
			priority: 0,
			content: 'G'.repeat(100),
		}),
		makeLoaded({
			kind: 'project-agents',
			absPath: '/p/AGENTS.md',
			relLabel: 'project',
			priority: 1,
			content: 'P'.repeat(100),
		}),
	];

	const {kept, dropped, truncated} = applyBudget(loaded, 150);
	t.is(kept.length, 1);
	t.is(kept[0]?.kind, 'global-agents');
	t.is(dropped.length, 1);
	t.true(truncated);
});

test('renderInjectedRulesSection returns empty for no sources', t => {
	t.is(renderInjectedRulesSection([]), '');
});

test('appendInjectedRules leaves prompt when section empty', t => {
	t.is(appendInjectedRules('hello', ''), 'hello');
	t.true(
		appendInjectedRules('hello', '## Project Context (AGENTS.md)\nx').includes(
			'AGENTS.md',
		),
	);
});

test('prependAgentsContextFromSection prepends and skips empty', t => {
	t.is(prependAgentsContextFromSection('user says hi', ''), 'user says hi');
	t.is(
		prependAgentsContextFromSection(
			'user says hi',
			'## Project Context (AGENTS.md)\n- rule',
		),
		'## Project Context (AGENTS.md)\n- rule\n\nuser says hi',
	);
});

test('discoverContextSources finds project AGENTS.md chain', async t => {
	const dir = await makeTempDir('snow-ctx-discover-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});

	// Fake git root so discovery walks from dir
	await fs.promises.mkdir(path.join(dir, '.git'));
	await fs.promises.writeFile(
		path.join(dir, 'AGENTS.md'),
		'# Root agents\n',
		'utf-8',
	);
	const nested = path.join(dir, 'packages', 'app');
	await fs.promises.mkdir(nested, {recursive: true});
	await fs.promises.writeFile(
		path.join(nested, 'AGENTS.md'),
		'# Nested agents\n',
		'utf-8',
	);

	const discovered = discoverContextSources({
		cwd: nested,
		config: baseConfig(),
	});

	const project = discovered.filter(s => s.kind === 'project-agents');
	t.true(project.length >= 2);
	t.true(
		project.some(
			s => s.relLabel === 'AGENTS.md' || s.relLabel.endsWith('AGENTS.md'),
		),
	);
	t.true(
		project.some(
			s =>
				s.relLabel.includes('packages/app') ||
				s.absPath.includes(`${path.sep}packages${path.sep}app`),
		),
	);
});

test('discoverContextSources falls back to CLAUDE.md', async t => {
	const dir = await makeTempDir('snow-ctx-claude-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	await fs.promises.mkdir(path.join(dir, '.git'));
	await fs.promises.writeFile(
		path.join(dir, 'CLAUDE.md'),
		'# Claude rules\n',
		'utf-8',
	);

	const discovered = discoverContextSources({
		cwd: dir,
		config: baseConfig(),
	});
	t.true(discovered.some(s => s.absPath.endsWith('CLAUDE.md')));
});

test('getInjectedRulesSection injects AGENTS.md body when enabled', async t => {
	const dir = await makeTempDir('snow-ctx-inject-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	await fs.promises.mkdir(path.join(dir, '.git'));
	await enableContextInject(dir);
	await fs.promises.writeFile(
		path.join(dir, 'AGENTS.md'),
		'- never commit secrets\n- run tests before done\n',
		'utf-8',
	);

	clearContextInjectCache();
	const section = getInjectedRulesSection({
		cwd: dir,
		profile: 'full',
		writeBreadcrumb: false,
	});

	t.true(section.includes('Project Context (AGENTS.md)'));
	t.true(section.includes('never commit secrets'));
	t.true(section.includes('ROLE.md persona rules are separate'));
});

test('getInjectedRulesSection is empty by default even with AGENTS.md', async t => {
	const dir = await makeTempDir('snow-ctx-default-off-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	await fs.promises.mkdir(path.join(dir, '.git'));
	await fs.promises.writeFile(path.join(dir, 'AGENTS.md'), '- a\n', 'utf-8');

	clearContextInjectCache();
	const section = getInjectedRulesSection({
		cwd: dir,
		profile: 'full',
		writeBreadcrumb: false,
	});
	t.is(section, '');
});

test('getInjectedRulesSection off returns empty', async t => {
	const dir = await makeTempDir('snow-ctx-off-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	await fs.promises.mkdir(path.join(dir, '.git'));
	await enableContextInject(dir);
	await fs.promises.writeFile(path.join(dir, 'AGENTS.md'), '- a\n', 'utf-8');

	clearContextInjectCache();
	const off = getInjectedRulesSection({cwd: dir, profile: 'off'});
	t.is(off, '');
});

test('resolveContextInjectConfig returns AGENTS-first defaults (enabled off)', async t => {
	const dir = await makeTempDir('snow-ctx-defaults-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	// No project settings → pure defaults (global may exist but no contextInject here).
	const cfg = resolveContextInjectConfig(dir);
	t.false(cfg.enabled);
	t.false(DEFAULT_CONTEXT_INJECT.enabled);
	t.is(cfg.budgetChars, 32_000);
	t.is(cfg.primaryFilename, 'AGENTS.md');
	t.true(cfg.fallbackFilenames.includes('CLAUDE.md'));
});

test('ROLE.md is not discovered by contextInject (persona stays separate)', async t => {
	const dir = await makeTempDir('snow-ctx-role-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	await fs.promises.mkdir(path.join(dir, '.git'));
	await fs.promises.writeFile(
		path.join(dir, 'ROLE.md'),
		'You are a strict code reviewer.',
		'utf-8',
	);
	await fs.promises.writeFile(
		path.join(dir, 'AGENTS.md'),
		'- project agents only\\n',
		'utf-8',
	);

	const discovered = discoverContextSources({
		cwd: dir,
		config: baseConfig(),
	});
	t.false(discovered.some(s => s.absPath.endsWith('ROLE.md')));
	t.true(discovered.some(s => s.absPath.endsWith('AGENTS.md')));

	// getSystemPromptWithRole still exists as the ROLE path (unit-level contract).
	t.is(typeof getSystemPromptWithRole, 'function');
});

test('compact profile still injects AGENTS but with smaller budget', async t => {
	const dir = await makeTempDir('snow-ctx-compact-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	await fs.promises.mkdir(path.join(dir, '.git'));
	await enableContextInject(dir);
	await fs.promises.writeFile(
		path.join(dir, 'AGENTS.md'),
		'- compact still sees this\n',
		'utf-8',
	);

	clearContextInjectCache();
	const details = getInjectedRulesDetails({
		cwd: dir,
		profile: 'compact',
		writeBreadcrumb: false,
	});
	t.true(details.section.includes('compact still sees this'));
	t.true(details.sources.some(s => s.kind === 'project-agents' && s.included));
});

test('prependAgentsContext puts AGENTS before typed user text when enabled', async t => {
	const dir = await makeTempDir('snow-ctx-user-path-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	await fs.promises.mkdir(path.join(dir, '.git'));
	await enableContextInject(dir);
	await fs.promises.writeFile(
		path.join(dir, 'AGENTS.md'),
		'- prefer small diffs\n',
		'utf-8',
	);

	clearContextInjectCache();
	const typed = 'please fix the flaky test';
	const modelBound = prependAgentsContext(typed, {
		cwd: dir,
		profile: 'full',
		writeBreadcrumb: false,
	});

	t.true(modelBound.startsWith('## Project Context (AGENTS.md)'));
	t.true(modelBound.includes('prefer small diffs'));
	t.true(modelBound.endsWith(typed));
	t.true(modelBound.indexOf('prefer small diffs') < modelBound.indexOf(typed));
});

test('prependAgentsContext is a no-op when inject is disabled', async t => {
	const dir = await makeTempDir('snow-ctx-user-noop-');
	t.teardown(async () => {
		await fs.promises.rm(dir, {recursive: true, force: true});
	});
	await fs.promises.mkdir(path.join(dir, '.git'));
	await fs.promises.writeFile(
		path.join(dir, 'AGENTS.md'),
		'- should not inject\n',
		'utf-8',
	);

	clearContextInjectCache();
	const typed = 'please fix the flaky test';
	const modelBound = prependAgentsContext(typed, {
		cwd: dir,
		profile: 'full',
		writeBreadcrumb: false,
	});
	t.is(modelBound, typed);
});

test('dedupeByContentOrder keeps first of identical bodies', t => {
	const items = [
		{id: 'g', content: '- rule A\n- rule B\n'},
		{id: 'p', content: '- rule A\n- rule B\n'},
		{id: 'n', content: '- only nested\n'},
	];
	const {kept, dropped} = dedupeByContentOrder(items);
	t.is(kept.length, 2);
	t.is(kept[0]?.id, 'g');
	t.is(kept[1]?.id, 'n');
	t.is(dropped.length, 1);
	t.is(dropped[0]?.id, 'p');
	t.true(isSameInjectContent(items[0]!.content, items[1]!.content));
});

test('dedupeLoadedSources drops AGENTS that match ROLE fingerprints', t => {
	const shared = 'You are a careful reviewer.\nNever invent APIs.';
	const loaded = [
		makeLoaded({
			kind: 'global-agents',
			absPath: '/g/AGENTS.md',
			relLabel: '~/.snow/AGENTS.md',
			priority: 0,
			content: shared,
		}),
		makeLoaded({
			kind: 'project-agents',
			absPath: '/p/AGENTS.md',
			relLabel: 'AGENTS.md',
			priority: 1,
			content: '- project only rule\n',
		}),
	];
	const roleFp = new Set([contentFingerprint(shared)]);
	const {kept, dropped} = dedupeLoadedSources(loaded, roleFp);
	t.is(kept.length, 1);
	t.is(kept[0]?.kind, 'project-agents');
	t.is(dropped.length, 1);
	t.is(dropped[0]?.kind, 'global-agents');
});

test('renderRoleSourcesSection merges global+project ROLE headings', t => {
	const section = renderRoleSourcesSection([
		{
			scope: 'global',
			absPath: '/home/.snow/ROLE.md',
			relLabel: '~/.snow/ROLE.md',
			content: 'Global hard rule',
		},
		{
			scope: 'project',
			absPath: '/repo/ROLE.md',
			relLabel: 'ROLE.md',
			content: 'Project hard rule',
		},
	]);
	t.true(section.includes('### Global ROLE'));
	t.true(section.includes('### Project ROLE'));
	t.true(section.includes('Global hard rule'));
	t.true(section.includes('Project hard rule'));
});
