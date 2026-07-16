import {
	getSnowDoc,
	listSnowDocs,
	resetSnowDocsCache,
	resolveBuiltInSkillsRoot,
	resolveSnowDocsRoot,
	searchSnowDocs,
} from '../dist/utils/docs/snowDocs.js';
import {executeSnowDocsTool} from '../dist/mcp/snowDocs.js';
import {existsSync} from 'fs';
import {join} from 'path';

resetSnowDocsCache();

const docsRoot = resolveSnowDocsRoot();
const skillsRoot = resolveBuiltInSkillsRoot();
console.log('docsRoot=', docsRoot);
console.log('skillsRoot=', skillsRoot);

if (!docsRoot) throw new Error('docsRoot missing');
if (!skillsRoot) throw new Error('skillsRoot missing');
if (!existsSync(join(skillsRoot, 'snow-docs', 'SKILL.md'))) {
	throw new Error('builtin snow-docs skill missing');
}

const listed = listSnowDocs({locale: 'en'});
console.log('list count=', listed.docs.length, 'locale=', listed.locale);
console.log(
	'first3=',
	listed.docs
		.slice(0, 3)
		.map(d => d.id)
		.join(' | '),
);
if (listed.docs.length < 10) throw new Error('expected many docs');

const search = searchSnowDocs({query: 'mcp', locale: 'en', maxResults: 5});
console.log(
	'search hits=',
	search.hits.map(h => `${h.score}:${h.id}`).join(' | '),
);
if (search.hits.length === 0) throw new Error('expected mcp hits');

const doc = getSnowDoc({path: '14.MCP Configuration.md', locale: 'en'});
console.log(
	'get id=',
	doc.id,
	'title=',
	doc.title,
	'truncated=',
	doc.truncated,
	'len=',
	doc.content.length,
);
if (!doc.content.includes('MCP')) throw new Error('doc content unexpected');

const zh = searchSnowDocs({query: 'MCP', locale: 'zh', maxResults: 3});
console.log(
	'zh hits=',
	zh.hits.map(h => h.id).join(' | '),
);

const listTool = await executeSnowDocsTool('list', {locale: 'en'});
if (!listTool.includes('Snow CLI docs catalogue')) {
	throw new Error('list tool output unexpected');
}
const searchTool = await executeSnowDocsTool('search', {
	query: 'skills',
	locale: 'en',
});
if (!searchTool.includes('hits')) throw new Error('search tool unexpected');
const getTool = await executeSnowDocsTool('get', {
	path: search.hits[0].id,
	locale: 'en',
});
if (!getTool.includes('id:')) throw new Error('get tool unexpected');

const bundleDocs = join(process.cwd(), 'bundle', 'docs', 'usage');
const bundleSkills = join(process.cwd(), 'bundle', 'skills', 'snow-docs', 'SKILL.md');
console.log('bundle docs exists=', existsSync(bundleDocs));
console.log('bundle skill exists=', existsSync(bundleSkills));
if (!existsSync(bundleDocs) || !existsSync(bundleSkills)) {
	throw new Error('bundle packaging missing docs/skills');
}

console.log('SMOKE OK');
