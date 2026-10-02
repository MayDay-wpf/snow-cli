import anyTest, {type TestFn} from 'ava';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const test = anyTest as unknown as TestFn;

const fixturesDir = dirname(fileURLToPath(import.meta.url));

// 回归测试：配置项「最大回复令牌数」(snowcfg.maxTokens) 必须落到各请求方式的正确字段
//   chat      -> max_tokens
//   responses -> max_output_tokens
//   gemini    -> generationConfig.maxOutputTokens
// 此前只有 anthropic 分支读取了 maxTokens，其余三种请求方式完全忽略该配置，
// 导致「最大回复令牌数」在 chat/responses/gemini 下形同虚设。
//
// 实现说明：必须在设置 SNOW_CONFIG_DIR 之后再加载配置模块，因此把场景放进子进程夹具执行。
test.serial('maxTokens 映射到各请求方式的正确字段', t => {
	const sandboxDir = mkdtempSync(join(tmpdir(), 'snow-max-tokens-'));
	const childPath = join(
		fixturesDir,
		'fixtures',
		'max-tokens-payload',
		'child.mjs',
	);

	const child = spawnSync(
		process.execPath,
		['--loader=ts-node/esm', childPath, sandboxDir],
		{
			cwd: process.cwd(),
			encoding: 'utf8',
			env: {...process.env},
		},
	);

	t.is(
		child.status,
		0,
		`fixture 子进程异常退出:\nstdout: ${child.stdout}\nstderr: ${child.stderr}`,
	);

	const marker = child.stdout
		.split('\n')
		.find(line => line.startsWith('FIXTURE_RESULT '));
	t.truthy(marker, `未找到 FIXTURE_RESULT: ${child.stdout}`);
	const result = JSON.parse(marker!.slice('FIXTURE_RESULT '.length));

	t.is(result.requestCount, 7);

	// chat -> max_tokens
	t.is(result.chat.max_tokens, 12345);
	t.true(result.chat.url.endsWith('/chat/completions'));

	// responses -> max_output_tokens
	t.is(result.responses.max_output_tokens, 12345);
	t.true(result.responses.url.endsWith('/responses'));

	// gemini -> generationConfig.maxOutputTokens
	t.is(result.gemini.generationConfig.maxOutputTokens, 12345);
	t.true(result.gemini.url.includes(':streamGenerateContent'));

	// 未配置 maxTokens 时三个字段都不发送
	t.is(result.unset.chat, undefined);
	t.is(result.unset.responses, undefined);
	t.is(result.unset.gemini, undefined);

	// gemini 思考配置与 maxOutputTokens 共存
	t.is(result.geminiWithThinking.maxOutputTokens, 12345);
	t.is(result.geminiWithThinking.thinkingConfig.thinkingLevel, 'low');
});
