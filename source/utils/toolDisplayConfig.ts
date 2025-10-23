/**
 * 工具显示配置
 * 用于判断哪些工具需要显示两步状态(进行中+完成)，哪些工具只需要显示完成状态
 */

/**
 * 需要显示两步状态的工具(进行中 → 完成)
 * 这些通常是耗时较长的工具，用户需要看到执行进度
 */
const TWO_STEP_TOOLS = new Set([
	// 文件编辑工具 - 耗时较长，需要显示进度
	'filesystem-edit',
	'filesystem-edit_search',
	'filesystem-create',

	// 终端执行工具 - 执行时间不确定，需要显示进度
	'terminal-execute',

	// 子代理工具 - 执行复杂任务，需要显示进度
	// 所有以 'subagent-' 开头的工具都需要两步显示
]);

/**
 * 判断工具是否需要显示两步状态
 * @param toolName - 工具名称
 * @returns 是否需要显示进行中和完成两个状态
 */
export function isToolNeedTwoStepDisplay(toolName: string): boolean {
	// 检查是否在固定列表中
	if (TWO_STEP_TOOLS.has(toolName)) {
		return true;
	}

	// 检查是否是子代理工具 (subagent- 开头)
	if (toolName.startsWith('subagent-')) {
		return true;
	}

	return false;
}

/**
 * 判断工具是否只需要在静态区显示完成状态
 * @param toolName - 工具名称
 * @returns 是否只需要显示完成状态
 */
export function isToolOnlyShowCompleted(toolName: string): boolean {
	return !isToolNeedTwoStepDisplay(toolName);
}
