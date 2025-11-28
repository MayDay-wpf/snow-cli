/**
 * YOLO 模式权限检查器
 *
 * 核心功能：统一主智能体（Main Agent）和子智能体（Sub-Agent）在 YOLO 模式下的权限判断逻辑。
 *
 * 设计目标：
 * 1. 确保敏感命令（如 rm -rf, dd 等）即使在 YOLO 模式下也强制请求用户确认。
 * 2. 确保普通工具在 YOLO 模式下保持自动批准，提供流畅体验。
 * 3. 避免 subAgentExecutor.ts 和 useConversation.ts 中出现重复的权限判断代码。
 */

import type {ToolCall} from '../../ui/components/ToolConfirmation.js';

/**
 * YOLO 权限检查结果接口
 */
export interface YoloPermissionResult {
	needsConfirmation: boolean;
	isSensitive: boolean;
	matchedCommand?: any; // 匹配到的敏感命令规则（类型为 SensitiveCommand，使用 any 避免循环依赖）
}

/**
 * 核心检查函数：在 YOLO 模式下判断工具调用是否需要用户确认
 *
 * 逻辑说明：
 * 1. 如果未开启 YOLO 模式 -> 始终需要确认。
 * 2. 如果开启 YOLO 模式 -> 默认自动批准，但对 terminal-execute 工具进行额外检查。
 * 3. 如果是 terminal-execute 且包含敏感命令 -> 强制需要确认 (isSensitive=true)。
 *
 * @param toolName - 工具名称 (如 'filesystem-read', 'terminal-execute')
 * @param toolArgs - 工具参数对象
 * @param yoloMode - 当前是否开启了 YOLO 模式
 * @returns 权限检查结果 (needsConfirmation, isSensitive)
 */
export async function checkYoloPermission(
	toolName: string,
	toolArgs: any,
	yoloMode: boolean,
): Promise<YoloPermissionResult> {
	// 场景 1: 非 YOLO 模式，安全优先，所有工具均需确认
	if (!yoloMode) {
		return {needsConfirmation: true, isSensitive: false};
	}

	// 场景 2: YOLO 模式下，默认采取宽松策略（自动批准）
	let needsConfirmation = false;
	let isSensitive = false;
	let matchedCommand: any;

	// 特殊处理: 检查 terminal-execute 是否包含敏感命令
	if (toolName === 'terminal-execute') {
		try {
			// 使用动态导入 sensitiveCommandManager，防止模块循环依赖问题
			const {isSensitiveCommand} = await import('./sensitiveCommandManager.js');

			// 仅当参数中包含 command 字段时才进行检查
			if (toolArgs && toolArgs.command) {
				const sensitiveCheck = isSensitiveCommand(toolArgs.command);
				if (sensitiveCheck.isSensitive) {
					needsConfirmation = true; // 发现敏感命令，覆盖默认行为，强制要求确认
					isSensitive = true; // 标记为敏感操作
					matchedCommand = sensitiveCheck.matchedCommand;
				}
			}
		} catch (error) {
			// 异常处理：如果敏感检查过程出错，出于安全兜底原则，强制要求确认
			console.warn('Failed to check sensitive command:', error);
			needsConfirmation = true;
			isSensitive = true;
		}
	}

	return {
		needsConfirmation,
		isSensitive,
		matchedCommand,
	};
}

/**
 * 工具过滤辅助函数：将工具调用列表分离为"敏感"和"非敏感"两组
 *
 * 用途：
 * 主智能体 (useConversation.ts) 使用此函数将工具分类。
 * - 非敏感工具：直接自动执行。
 * - 敏感工具：即使在 YOLO 模式下，也弹窗请求用户确认。
 *
 * @param toolCalls - 待执行的工具调用列表
 * @param yoloMode - 是否启用 YOLO 模式
 * @returns 分组后的工具列表 { sensitiveTools, nonSensitiveTools }
 */
export async function filterToolsBySensitivity(
	toolCalls: ToolCall[],
	yoloMode: boolean,
): Promise<{
	sensitiveTools: ToolCall[];
	nonSensitiveTools: ToolCall[];
}> {
	const sensitiveTools: ToolCall[] = [];
	const nonSensitiveTools: ToolCall[] = [];

	for (const toolCall of toolCalls) {
		const toolName = toolCall.function.name;
		let args: any;

		try {
			args = JSON.parse(toolCall.function.arguments);
		} catch (e) {
			args = {};
		}

		const permissionResult = await checkYoloPermission(
			toolName,
			args,
			yoloMode,
		);

		if (permissionResult.isSensitive) {
			sensitiveTools.push(toolCall);
		} else {
			nonSensitiveTools.push(toolCall);
		}
	}

	return {sensitiveTools, nonSensitiveTools};
}
