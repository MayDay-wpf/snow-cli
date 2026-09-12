import anyTest, {type TestFn} from 'ava';
import {mkdtempSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const test = anyTest as unknown as TestFn;

const fixturesDir = dirname(fileURLToPath(import.meta.url));

// 回归测试：/models 等入口调用 updateSnowConfig 时，只能把"变更字段"合并进
// 磁盘上当前 active profile，不允许用本进程的旧配置（config.json 缓存）整份覆盖。
//
// 复现路径：P1 启动时读到 A 的配置；P2/别处 Alt+P 切到 B；P1 再执行 /models 改模型。
// 若 updateSnowConfig 以本进程缓存作为基线，就会把 A 的 baseUrl/apiKey 覆盖到 B。
//
// 实现说明：必须在设置 SNOW_CONFIG_DIR 之后再加载配置模块，而模块级
// `process.env[...] = ...` 会让 ts-node/esm loader 在当前宿主中崩溃，
// 因此把场景放进子进程夹具（fixtures/profile-config-isolation/child.mjs）执行。
test.serial('updateSnowConfig 不会整体覆盖已切换到的 profile', t => {
	// 每个用例一个独立沙箱：<tmp>/snow-profile-xxx/.snow
	const sandboxDir = join(
		mkdtempSync(join(tmpdir(), 'snow-profile-')),
		'.snow',
	);
	const childPath = join(
		fixturesDir,
		'fixtures',
		'profile-config-isolation',
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
	t.true(child.stdout.includes('FIXTURE_OK'));

	const result = JSON.parse(
		readFileSync(join(sandboxDir, 'test-result.json'), 'utf8'),
	);

	// 前置校验：SNOW_CONFIG_DIR 必须生效，配置读写都落在沙箱内
	t.is(result.resolvedDir, sandboxDir);
	// P1 启动时读到的是 A
	t.is(result.startupBaseUrl, 'https://api.a.example.com/v1');
	// 切换到 B 后磁盘 active=B
	t.is(result.activeAfterSwitch, 'B');

	// B 的 API 连接信息必须原样保留，不能被 A 覆盖
	t.is(result.b.baseUrl, 'https://api.b.example.com/v1');
	t.is(result.b.apiKey, 'KEY-B');
	t.is(result.b.requestMethod, 'responses');
	// 仅 advancedModel 被更新
	t.is(result.b.advancedModel, 'model-b-new');
	t.is(result.b.basicModel, 'model-b-basic');

	// A 完全不受影响
	t.is(result.a.baseUrl, 'https://api.a.example.com/v1');
	t.is(result.a.apiKey, 'KEY-A');
	t.is(result.a.advancedModel, 'model-a-advanced');

	// config.json 也已同步为 B（+ 本次变更）
	t.is(result.globalSnowcfg.baseUrl, 'https://api.b.example.com/v1');
	t.is(result.globalSnowcfg.advancedModel, 'model-b-new');
});
