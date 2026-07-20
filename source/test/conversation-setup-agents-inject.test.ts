import anyTest, {type TestFn} from 'ava';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const test = anyTest as unknown as TestFn;

async function makeTempDir(prefix: string): Promise<string> {
	return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function enableContextInject(dir: string): Promise<void> {
	const snowDir = path.join(dir, '.snow');
	await fs.promises.mkdir(snowDir, {recursive: true});
	await fs.promises.writeFile(
		path.join(snowDir, 'settings.json'),
		JSON.stringify({contextInject: {enabled: true}}, null, 2),
		'utf-8',
	);
}

test('appendUserMessageAndSyncContext injects AGENTS only on API payload, not session save', async t => {
	const dir = await makeTempDir('snow-append-agents-');
	await enableContextInject(dir);
	await fs.promises.writeFile(
		path.join(dir, 'AGENTS.md'),
		'Unique AGENTS body for append test',
		'utf-8',
	);

	const {clearContextInjectCache} = await import(
		'../prompt/contextInject/index.js'
	);
	clearContextInjectCache();

	const {appendUserMessageAndSyncContext} = await import(
		'../hooks/conversation/core/conversationSetup.js'
	);

	const conversationMessages: any[] = [];
	const saved: any[] = [];
	const typed = 'hello from user';

	await appendUserMessageAndSyncContext({
		conversationMessages,
		userContent: typed,
		editorContext: undefined,
		imageContents: undefined,
		cwd: dir,
		saveMessage: async msg => {
			saved.push(msg);
		},
	});

	t.is(saved.length, 1);
	t.is(saved[0]?.role, 'user');
	t.is(saved[0]?.content, typed);
	t.false(
		String(saved[0]?.content).includes('Unique AGENTS body for append test'),
		'session save must not include AGENTS inject',
	);

	t.is(conversationMessages.length, 1);
	t.is(conversationMessages[0]?.role, 'user');
	const apiContent = String(conversationMessages[0]?.content ?? '');
	t.true(
		apiContent.includes('Unique AGENTS body for append test'),
		'live API payload should include AGENTS inject',
	);
	t.true(
		apiContent.includes(typed),
		'live API payload should still include user text',
	);
	t.true(
		apiContent.indexOf('Unique AGENTS body for append test') <
			apiContent.indexOf(typed),
		'AGENTS should be prepended before user text',
	);

	clearContextInjectCache();
});

test('appendUserMessageAndSyncContext applies hook context only on API payload', async t => {
	const dir = await makeTempDir('snow-append-hook-');

	const {clearContextInjectCache} = await import(
		'../prompt/contextInject/index.js'
	);
	clearContextInjectCache();

	const {appendUserMessageAndSyncContext} = await import(
		'../hooks/conversation/core/conversationSetup.js'
	);

	const conversationMessages: any[] = [];
	const saved: any[] = [];
	const typed = 'hello from user';

	await appendUserMessageAndSyncContext({
		conversationMessages,
		userContent: typed,
		hookApiOnlyContext: 'HOOK_CTX',
		editorContext: undefined,
		imageContents: undefined,
		cwd: dir,
		saveMessage: async msg => {
			saved.push(msg);
		},
	});

	t.is(saved[0]?.content, typed);
	t.false(String(saved[0]?.content).includes('HOOK_CTX'));

	const apiContent = String(conversationMessages[0]?.content ?? '');
	t.true(apiContent.includes('HOOK_CTX'));
	t.true(apiContent.includes(typed));
	t.true(apiContent.indexOf('HOOK_CTX') < apiContent.indexOf(typed));

	clearContextInjectCache();
});

test('appendUserMessageAndSyncContext is a no-op for AGENTS when inject disabled', async t => {
	const dir = await makeTempDir('snow-append-agents-off-');
	await fs.promises.writeFile(
		path.join(dir, 'AGENTS.md'),
		'Should not appear when disabled',
		'utf-8',
	);

	const {clearContextInjectCache} = await import(
		'../prompt/contextInject/index.js'
	);
	clearContextInjectCache();

	const {appendUserMessageAndSyncContext} = await import(
		'../hooks/conversation/core/conversationSetup.js'
	);

	const conversationMessages: any[] = [];
	const saved: any[] = [];
	const typed = 'plain user text';

	await appendUserMessageAndSyncContext({
		conversationMessages,
		userContent: typed,
		editorContext: undefined,
		imageContents: undefined,
		cwd: dir,
		saveMessage: async msg => {
			saved.push(msg);
		},
	});

	t.is(saved[0]?.content, typed);
	t.is(conversationMessages[0]?.content, typed);
	t.false(
		String(conversationMessages[0]?.content).includes(
			'Should not appear when disabled',
		),
	);

	clearContextInjectCache();
});
