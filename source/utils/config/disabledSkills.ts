import {readSettings, updateSettings} from './unifiedSettings.js';

/**
 * 管理技能的禁用状态
 * 现已统一持久化到 `<cwd>/.snow/settings.json` 的 `disabledSkills` 字段
 * （历史上单独存放于 `disabled-skills.json`，已自动迁移）。
 */

/**
 * 读取被禁用的技能列表
 */
export function getDisabledSkills(): string[] {
	try {
		const settings = readSettings('project');
		if (Array.isArray(settings.disabledSkills)) {
			return settings.disabledSkills;
		}
		return [];
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

	updateSettings('project', settings => {
		settings.disabledSkills = disabled;
	});

	return newEnabled;
}
