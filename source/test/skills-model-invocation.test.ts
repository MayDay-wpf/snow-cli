import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import anyTest, {type TestFn} from 'ava';

import {getMCPTools, listAvailableSkills} from '../mcp/skills.js';

const test = anyTest as unknown as TestFn;

async function writeSkill(
	root: string,
	id: string,
	frontmatter: string,
): Promise<void> {
	const directory = path.join(root, '.snow', 'skills', id);
	await fs.mkdir(directory, {recursive: true});
	await fs.writeFile(
		path.join(directory, 'SKILL.md'),
		`---\n${frontmatter}\n---\n\n# ${id}\n`,
		'utf8',
	);
}

test('manual-only skills are parsed and separated from automatic skills', async t => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-skills-test-'));
	t.teardown(async () => fs.rm(root, {recursive: true, force: true}));
	await writeSkill(
		root,
		'manual-grill',
		'name: manual-grill\ndescription: Manual interview\ndisable-model-invocation: true',
	);
	await writeSkill(
		root,
		'auto-helper',
		'name: auto-helper\ndescription: Automatic helper',
	);

	const skills = await listAvailableSkills(root);
	const manual = skills.find(skill => skill.id === 'manual-grill');
	const bundledGrill = skills.find(skill => skill.id === 'grill-me');
	t.true(manual?.disableModelInvocation);
	t.is(bundledGrill?.location, 'builtin');
	t.true(bundledGrill?.disableModelInvocation);

	const tools = await getMCPTools(root);
	const description = String(tools[0]?.description || '');
	const automaticSection =
		/<available_skills>([\s\S]*?)<\/available_skills>/.exec(description)?.[1];
	const manualSection = /<manual_skills>([\s\S]*?)<\/manual_skills>/.exec(
		description,
	)?.[1];

	t.true(automaticSection?.includes('auto-helper'));
	t.false(automaticSection?.includes('manual-grill'));
	t.true(manualSection?.includes('manual-grill'));
	t.false(manualSection?.includes('auto-helper'));
});
