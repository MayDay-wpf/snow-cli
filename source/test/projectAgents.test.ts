import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
	loadAgentsFromDir,
	parseAgentMarkdownFile,
} from '../utils/config/projectAgents.js';

const test = anyTest as unknown as TestFn;

test('parseAgentMarkdownFile maps frontmatter and body', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-agents-'));
	const file = path.join(dir, 'trellis-implement.md');
	await fs.writeFile(
		file,
		`---
id: trellis-implement
name: trellis-implement
description: Implement from Trellis
tools:
  - filesystem-read
  - terminal-execute
---

You implement tasks.
`,
		'utf8',
	);

	try {
		const agent = parseAgentMarkdownFile(file);
		t.truthy(agent);
		t.is(agent!.id, 'trellis-implement');
		t.is(agent!.name, 'trellis-implement');
		t.is(agent!.description, 'Implement from Trellis');
		t.deepEqual(agent!.tools, ['filesystem-read', 'terminal-execute']);
		t.true(agent!.role?.includes('You implement tasks'));
		t.false(agent!.builtin);
	} finally {
		await fs.rm(dir, {recursive: true, force: true});
	}
});

test('parseAgentMarkdownFile defaults id from filename', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-agents-'));
	const file = path.join(dir, 'my-agent.md');
	await fs.writeFile(
		file,
		`---
description: demo
tools: filesystem-read
---

Role body
`,
		'utf8',
	);

	try {
		const agent = parseAgentMarkdownFile(file);
		t.is(agent!.id, 'my-agent');
		t.is(agent!.name, 'my-agent');
		t.deepEqual(agent!.tools, ['filesystem-read']);
	} finally {
		await fs.rm(dir, {recursive: true, force: true});
	}
});

test('loadAgentsFromDir skips bad files without throwing', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-agents-'));
	await fs.writeFile(path.join(dir, 'good.md'), `---
id: good
tools:
  - ace-search
---
ok
`, 'utf8');
	await fs.writeFile(path.join(dir, 'bad.md'), `---
: not yaml
---
`, 'utf8');

	try {
		const agents = loadAgentsFromDir(dir);
		t.true(agents.some(a => a.id === 'good'));
	} finally {
		await fs.rm(dir, {recursive: true, force: true});
	}
});

test('loadAgentsFromDir recurses nested directories', async t => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'snow-agents-'));
	const nested = path.join(dir, 'team');
	await fs.mkdir(nested, {recursive: true});
	await fs.writeFile(
		path.join(nested, 'nested-agent.md'),
		`---
id: nested-agent
tools:
  - todo-manage
---
nested
`,
		'utf8',
	);

	try {
		const agents = loadAgentsFromDir(dir);
		t.true(agents.some(a => a.id === 'nested-agent'));
	} finally {
		await fs.rm(dir, {recursive: true, force: true});
	}
});
