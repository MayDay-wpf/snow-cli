import fs from 'node:fs';
import path from 'node:path';

/**
 * 管理技能的禁用状态
 * 持久化到项目根目录 .snow/disabled-skills.json
 */

const CONFIG_FILE = 'disabled-skills.json';

function getConfigPath(): string {
	return path.join(process.cwd(), '.snow', CONFIG_FILE);
}

/**
 * 读取被禁用的技能列表
 */
export function getDisabledSkills(): string[] {
	try {
		const configPath = getConfigPath();
		if (!fs.existsSync(configPath)) {
			return [];
		}
		const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		return Array.isArray(data.disabledSkills) ? data.disabledSkills : [];
	} catch {
		return [];
	}
}

/**
 * 检查某个技能是否启用
 */
export function isSkillEnabled(skillId: string): boolean {
	return !getDisabledSkills().includes(skillId);
}

/**
 * 切换技能的启用/禁用状态
 */
export function toggleSkill(skillId: string): boolean {
	const disabled = getDisabledSkills();
	const index = disabled.indexOf(skillId);
	let newEnabled: boolean;

	if (index >= 0) {
		disabled.splice(index, 1);
		newEnabled = true;
	} else {
		disabled.push(skillId);
		newEnabled = false;
	}

	const configPath = getConfigPath();
	const dir = path.dirname(configPath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, {recursive: true});
	}
	fs.writeFileSync(
		configPath,
		JSON.stringify({disabledSkills: disabled}, null, 2),
		'utf-8',
	);

	return newEnabled;
}
