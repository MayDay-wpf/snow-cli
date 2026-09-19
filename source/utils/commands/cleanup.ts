import {registerCommand, type CommandResult} from '../execution/commandExecutor.js';

/**
 * /cleanup - 清理 ~/.snow 目录数据（Issue #208）。
 *
 * 打开交互式清理面板，提供两种清理方式：
 * 1. 按项目清理：勾选项目后删除其会话、快照、历史、TODO、目标、团队快照等数据。
 * 2. 按时间清理：删除早于 7/15/30/90 天的日志、用量统计、任务、导出等数据。
 */
registerCommand('cleanup', {
	execute: async (): Promise<CommandResult> => {
		return {
			success: true,
			action: 'showCleanupPanel',
		};
	},
});

export default {};