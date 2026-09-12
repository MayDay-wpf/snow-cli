// 回归测试夹具：在独立子进程中运行，避免污染 AVA 主进程环境。
//
// 场景：/models 等入口调用 updateSnowConfig 时，只能把"变更字段"合并进
// 磁盘上当前 active profile，不允许用本进程的旧配置（config.json 缓存）整份覆盖。
// 复现路径：P1 启动时读到 A 的配置；P2/别处 Alt+P 切到 B；P1 再执行 /models 改模型。
//
// 运行方式（由 profile-config-isolation.test.ts 拉起）：
//   node --loader=ts-node/esm source/test/fixtures/profile-config-isolation/child.mjs <sandboxDir>
//
// 说明：配置目录通过 SNOW_CONFIG_DIR 指向沙箱，绝不触碰真实 ~/.snow。
// 必须在设置环境变量之后再加载配置模块 —— 模块级
// CONFIG_DIR = resolveSnowConfigDir() 才会解析到沙箱。
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const sandboxDir = process.argv[2];
if (!sandboxDir) {
	throw new Error('sandbox dir argument is required');
}

process.env['SNOW_CONFIG_DIR'] = sandboxDir;

const profilesDir = join(sandboxDir, 'profiles');
mkdirSync(profilesDir, {recursive: true});

const profileAConfig = {
	snowcfg: {
		baseUrl: 'https://api.a.example.com/v1',
		apiKey: 'KEY-A',
		requestMethod: 'chat',
		advancedModel: 'model-a-advanced',
		basicModel: 'model-a-basic',
	},
};
const profileBConfig = {
	snowcfg: {
		baseUrl: 'https://api.b.example.com/v1',
		apiKey: 'KEY-B',
		requestMethod: 'responses',
		advancedModel: 'model-b-advanced',
		basicModel: 'model-b-basic',
	},
};
writeFileSync(
	join(profilesDir, 'A.json'),
	JSON.stringify(profileAConfig, null, 2),
);
writeFileSync(
	join(profilesDir, 'B.json'),
	JSON.stringify(profileBConfig, null, 2),
);

// 初始状态：active = A，config.json = A 的快照（模拟 P1 启动时读到的内容）
writeFileSync(
	join(sandboxDir, 'active-profile.json'),
	JSON.stringify({activeProfile: 'A'}),
);
writeFileSync(
	join(sandboxDir, 'config.json'),
	JSON.stringify(profileAConfig, null, 2),
);

const apiConfig = await import('../../../../source/utils/config/apiConfig.js');
const configManager = await import(
	'../../../../source/utils/config/configManager.js'
);

const result = {
	resolvedDir: apiConfig.resolveSnowConfigDir(),
	startupBaseUrl: apiConfig.getSnowConfig().baseUrl,
	activeAfterSwitch: '',
	b: {},
	a: {},
	globalSnowcfg: {},
};

// 前置校验：SNOW_CONFIG_DIR 必须生效
if (result.resolvedDir !== sandboxDir) {
	throw new Error(
		`SNOW_CONFIG_DIR not applied: ${result.resolvedDir} !== ${sandboxDir}`,
	);
}

// P2（或用户在别处 Alt+P）：切换到 B，磁盘 active=B、config.json=B
configManager.switchProfile('B');
result.activeAfterSwitch = configManager.getActiveProfileName();

// P1 执行 /models 改模型（此时 P1 内存缓存里仍是 A）
await apiConfig.updateSnowConfig({advancedModel: 'model-b-new'});

result.b = JSON.parse(
	readFileSync(join(profilesDir, 'B.json'), 'utf8'),
).snowcfg;
result.a = JSON.parse(
	readFileSync(join(profilesDir, 'A.json'), 'utf8'),
).snowcfg;
result.globalSnowcfg = JSON.parse(
	readFileSync(join(sandboxDir, 'config.json'), 'utf8'),
).snowcfg;

writeFileSync(
	join(sandboxDir, 'test-result.json'),
	JSON.stringify(result, null, 2),
);
console.log('FIXTURE_OK');
