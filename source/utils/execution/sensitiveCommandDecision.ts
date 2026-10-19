import {isSensitiveCommand} from './sensitiveCommandManager.js';
import {logger} from '../core/logger.js';

const log = logger.child('execution:sensitiveCommandDecision');
import {getSensitiveCommandAssistSettings} from '../config/sensitiveCommandAssistConfig.js';
import {getDecisionModelsConfig} from '../config/decisionModelsConfig.js';
import {
	evaluateSensitiveCommand,
	resolveDecisionModelReviewConfig,
	type SensitiveCommandDecision,
} from '../../api/decisionModel.js';

/**
 * 敏感命令决策模型辅助的判定结果。
 *
 * - `none`：辅助未启用、未选中模型、命令未命中规则，或请求失败——调用方保持
 *   原有的普通确认流程。
 * - `decision`：得到了一次判定。`delegate` 为 true 时判定直接生效（允许则放行、
 *   拒绝则拒绝），否则只作为建议随确认提示展示。
 */
export type SensitiveCommandGateResult =
	| {kind: 'none'}
	| {
			kind: 'decision';
			decision: SensitiveCommandDecision;
			modelName: string;
			delegate: boolean;
	  };

/** 参与判定所需的上下文（全部可选，缺失时模型仅依据命令文本判断）。 */
export interface SensitiveCommandGateContext {
	description?: string;
	workingDirectory?: string;
	abortSignal?: AbortSignal;
}

/**
 * 用配置好的决策模型判定一条命令。命令未命中敏感规则、辅助未启用、选中的模型
 * 不可用，或请求失败时返回 `none`，由调用方保留普通确认提示——判定绝不降级为
 * 猜测放行。
 */
export async function evaluateSensitiveCommandGate(
	command: string,
	context: SensitiveCommandGateContext = {},
): Promise<SensitiveCommandGateResult> {
	const trimmedCommand = command.trim();
	if (!trimmedCommand) {
		return {kind: 'none'};
	}

	// 只有命中敏感规则的命令才需要判定；未命中时无需请求决策模型。
	const match = isSensitiveCommand(trimmedCommand);
	if (!match.isSensitive) {
		return {kind: 'none'};
	}

	const assist = getSensitiveCommandAssistSettings();
	if (!assist.enabled || !assist.modelId) {
		return {kind: 'none'};
	}

	const modelsConfig = getDecisionModelsConfig();
	const item = modelsConfig?.models.find(model => model.id === assist.modelId);
	const config = resolveDecisionModelReviewConfig(item);
	if (!config || !item) {
		return {kind: 'none'};
	}

	const matchedRules = match.matchedCommand
		? [
				{
					pattern: match.matchedCommand.pattern,
					description: match.matchedCommand.description,
				},
		  ]
		: [];

	let decision: SensitiveCommandDecision;
	try {
		decision = await evaluateSensitiveCommand(
			config,
			{
				command: trimmedCommand,
				description: context.description,
				workingDirectory: context.workingDirectory ?? process.cwd(),
				matchedRules,
			},
			context.abortSignal,
		);
	} catch (error) {
		log.debug(
			'Failed to evaluate sensitive command via decision model, falling back to manual confirmation',
			{command: trimmedCommand, error},
		);
		// 传输 / 协议失败：回退到普通确认提示，绝不放行。
		return {kind: 'none'};
	}

	const modelName = item.name.trim() || item.model.trim();

	return {
		kind: 'decision',
		decision,
		modelName,
		delegate: assist.delegate,
	};
}
