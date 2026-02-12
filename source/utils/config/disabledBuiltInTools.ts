import fs from 'node:fs';
import path from 'node:path';

/**
 * 管理系统内置 MCP 工具的禁用状态
 * 持久化到项目根目录 .snow/disabled-builtin-tools.json
 */

const CONFIG_FILE = 'disabled-builtin-tools.json';

function getConfigPath(): string {
	return path.join(process.cwd(), '.snow', CONFIG_FILE);
}

/**
 * 读取被禁用的内置服务列表
 */
export function getDisabledBuiltInServices(): string[] {
	try {
		const configPath = getConfigPath();
		if (!fs.existsSync(configPath)) {
			return [];
		}
		const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		return Array.isArray(data.disabledServices) ? data.disabledServices : [];
	} catch {
		return [];
	}
}

/**
 * 检查某个内置服务是否启用
 */
export function isBuiltInServiceEnabled(serviceName: string): boolean {
	return !getDisabledBuiltInServices().includes(serviceName);
}

/**
 * 切换内置服务的启用/禁用状态
 */
export function toggleBuiltInService(serviceName: string): boolean {
	const disabled = getDisabledBuiltInServices();
	const index = disabled.indexOf(serviceName);
	let newEnabled: boolean;

	if (index >= 0) {
		disabled.splice(index, 1);
		newEnabled = true;
	} else {
		disabled.push(serviceName);
		newEnabled = false;
	}

	const configPath = getConfigPath();
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
	fs.writeFileSync(
		configPath,
		JSON.stringify({disabledServices: disabled}, null, 2),
		'utf-8',
	);

	return newEnabled;
}
