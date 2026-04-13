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
	'filesystem-replaceedit',
	'filesystem-create',

	// 终端执行工具 - 执行时间不确定，需要显示进度
	'terminal-execute',

	// 代码库搜索工具 - 需要生成 embedding 和搜索，耗时较长
	'codebase-search',

	// 联网搜索工具 - 需要启动浏览器、网络请求、内容处理，耗时较长
	'websearch-search',
	'websearch-fetch',

	// 用户交互工具 - 需要等待用户输入，耗时不确定
	'askuser-ask_question',

	// 子代理工具 - 执行复杂任务，需要显示进度
	// 所有以 'subagent-' 开头的工具都需要两步显示
]);

/**
 * 固定列表内的两步显示工具名（不含 `subagent-` 前缀规则）
 * 供持久化 / teammate 等路径对照检查，避免漏发 `tool_result` 导致会话缺结果
 */
export const TWO_STEP_DISPLAY_TOOL_NAMES: readonly string[] =
	Array.from(TWO_STEP_TOOLS);

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

/**
 * 从已写入会话的 tool 消息 content（JSON 字符串）中提取 filesystem-edit 的 diff 元数据，
 * 便于截断或仅文本 content 时仍能恢复 DiffViewer（与主流程 ToolResult.editDiffData 对齐）
 */
export function extractFilesystemEditDiffDataForPersistence(
	toolName: string,
	content: string,
): Record<string, any> | undefined {
	if (
		(toolName !== 'filesystem-edit' && toolName !== 'filesystem-replaceedit') ||
		content.startsWith('Error:')
	) {
		return undefined;
	}
	try {
		const resultData = JSON.parse(content);
		if (resultData.oldContent && resultData.newContent) {
			return {
				oldContent: resultData.oldContent,
				newContent: resultData.newContent,
				filename:
					resultData.filePath ||
					resultData.path ||
					resultData.filename,
				completeOldContent: resultData.completeOldContent,
				completeNewContent: resultData.completeNewContent,
				contextStartLine: resultData.contextStartLine,
			};
		}
		if (resultData.results && Array.isArray(resultData.results)) {
			return {
				batchResults: resultData.results,
				isBatch: true,
			};
		}
		if (
			resultData.batchResults &&
			Array.isArray(resultData.batchResults)
		) {
			return {
				batchResults: resultData.batchResults,
				isBatch: true,
			};
		}
	} catch {
		// ignore
	}
	return undefined;
}
