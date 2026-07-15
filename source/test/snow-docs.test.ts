import anyTest, {type TestFn} from 'ava';

import {executeSnowDocsTool} from '../mcp/snowDocs.js';
import {
	getSnowDoc,
	listSnowDocs,
	resetSnowDocsCache,
	resolveBuiltInSkillsRoot,
	resolveDocsLocale,
	resolveSnowDocsRoot,
	searchSnowDocs,
} from '../utils/docs/snowDocs.js';

const test = anyTest as unknown as TestFn;

test.beforeEach(() => {
	resetSnowDocsCache();
});

test('resolveSnowDocsRoot finds docs/usage with zh/en locales', t => {
	const root = resolveSnowDocsRoot();
	t.truthy(root);
	t.regex(root!.replace(/\\/g, '/'), /docs\/usage$/);
});

test('resolveBuiltInSkillsRoot finds snow-docs skill', t => {
	const root = resolveBuiltInSkillsRoot();
	t.truthy(root);
});

test('resolveDocsLocale maps language overrides', t => {
	t.is(resolveDocsLocale('zh'), 'zh');
	t.is(resolveDocsLocale('en'), 'en');
});

test('listSnowDocs returns catalogue without requiring includeOtherLocale', t => {
	const result = listSnowDocs({locale: 'en'});
	t.is(result.locale, 'en');
	t.true(result.docs.length > 0);
	t.true(result.docs.some(doc => doc.id.includes('Catalogue') || doc.id.includes('0.')));
	// Absolute docsRoot is internal; caller tooling must not dump it to users.
	t.truthy(result.docsRoot);
});

test('searchSnowDocs ranks MCP docs and supports zh locale', t => {
	const en = searchSnowDocs({query: 'MCP', locale: 'en', maxResults: 5});
	t.is(en.query, 'MCP');
	t.true(en.hits.length > 0);
	t.true(en.hits.some(hit => /mcp/i.test(hit.id) || /mcp/i.test(hit.title)));

	const zh = searchSnowDocs({query: 'MCP', locale: 'zh', maxResults: 5});
	t.true(zh.hits.length > 0);
	t.true(zh.hits.some(hit => hit.id.includes('MCP') || hit.title.includes('MCP')));
});

test('getSnowDoc resolves exact id and truncates long content', t => {
	const doc = getSnowDoc({
		path: '14.MCP Configuration.md',
		locale: 'en',
	});
	t.is(doc.locale, 'en');
	t.is(doc.id, '14.MCP Configuration.md');
	t.true(doc.content.length > 0);
	t.false(doc.truncated);

	const truncated = getSnowDoc({
		path: '14.MCP Configuration.md',
		locale: 'en',
		maxChars: 1000,
	});
	t.true(truncated.truncated);
	t.true(truncated.content.includes('[truncated'));
});

test('getSnowDoc accepts locale-prefixed path', t => {
	const doc = getSnowDoc({
		path: 'zh/14.MCP配置.md',
	});
	t.is(doc.locale, 'zh');
	t.is(doc.id, '14.MCP配置.md');
});

test('executeSnowDocsTool list/get omit absolute filesystem paths', async t => {
	const listOutput = await executeSnowDocsTool('list', {locale: 'en'});
	t.true(listOutput.includes('Snow CLI docs catalogue'));
	t.false(listOutput.includes('Root:'));
	// Windows absolute path markers should not appear in user-facing list output.
	t.false(/[A-Za-z]:\\/.test(listOutput));
	t.false(listOutput.includes('/Users/'));

	const getOutput = await executeSnowDocsTool('get', {
		path: '14.MCP Configuration.md',
		locale: 'en',
	});
	t.true(getOutput.includes('- id: 14.MCP Configuration.md'));
	t.false(getOutput.includes('- path:'));
	t.false(/[A-Za-z]:\\Users\\/.test(getOutput));
});

test('executeSnowDocsTool search returns structured hits', async t => {
	const raw = await executeSnowDocsTool('search', {
		query: 'skills',
		locale: 'en',
		maxResults: 3,
	});
	const parsed = JSON.parse(raw) as {
		query: string;
		hits: Array<{id: string; score: number}>;
	};
	t.is(parsed.query, 'skills');
	t.true(Array.isArray(parsed.hits));
	t.true(parsed.hits.length > 0);
});
