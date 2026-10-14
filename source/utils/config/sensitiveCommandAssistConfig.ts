import {readSettings, updateSettings} from './unifiedSettings.js';

/**
 * 敏感命令的决策模型辅助配置（全局，落盘于 ~/.snow/settings.json 的
 * `sensitiveCommandAssist` 字段）。
 *
 * 语义（对齐 snow-app 的 `sensitive_command_assist`）：
 * - enabled：总开关，默认关闭。关闭时不请求决策模型，敏感命令照常弹确认提示。
 * - modelId：参与判定的决策模型 id（来自 ~/.snow/decision-models.json 中已配置的条目）。
 * - delegate：托管，默认关闭。开启后判定直接生效（允许则放行、拒绝则拒绝）；
 *   关闭时判定只在敏感命令拦截提示中作为建议展示，是否执行仍由用户决定。
 *
 * 字段名与 decisionModelsConfig 保持一致，便于两处共用同一份决策模型配置。
 */
export interface SensitiveCommandAssistSettings {
	enabled: boolean;
	modelId: string;
	delegate: boolean;
}

export const DEFAULT_SENSITIVE_COMMAND_ASSIST: SensitiveCommandAssistSettings = {
	enabled: false,
	modelId: '',
	delegate: false,
};

/**
 * 读取辅助配置。未配置 / 解析失败一律回落到默认值（全部关闭）。
 */
export function getSensitiveCommandAssistSettings(): SensitiveCommandAssistSettings {
	const stored = readSettings('global').sensitiveCommandAssist;

	if (!stored || typeof stored !== 'object') {
		return {...DEFAULT_SENSITIVE_COMMAND_ASSIST};
	}

	return {
		// 缺省一律视为关闭：手写配置时无需显式写 false。
		enabled: stored.enabled === true,
		modelId: typeof stored.modelId === 'string' ? stored.modelId.trim() : '',
		delegate: stored.delegate === true,
	};
}

/**
 * 持久化辅助配置。只写这三个字段，不影响 settings.json 中的其它内容。
 * 关闭总开关时一并关闭托管，避免留下悬空状态。
 */
export function saveSensitiveCommandAssistSettings(
	settings: SensitiveCommandAssistSettings,
): void {
	const enabled = settings.enabled === true;

	updateSettings('global', current => {
		current.sensitiveCommandAssist = {
			enabled,
			modelId: settings.modelId.trim(),
			delegate: enabled ? settings.delegate === true : false,
		};
	});
}
