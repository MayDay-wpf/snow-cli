import type {ToolCall} from '../execution/toolExecutor.js';

// 路径显示相关常量
const PATH_DISPLAY_PADDING = 30;
const MIN_DISPLAY_LENGTH = 10;

/**
 * 获取终端宽度
 */
function getTerminalWidth(): number {
	return process.stdout.columns || 80;
}

/**
 * 检测值是否为文件系统路径（排除 URL）
 */
function isFilePath(value: string): boolean {
	// 排除网络 URL
	if (value.includes('://')) return false;
	// Unix 绝对路径或 Windows 绝对路径
	return /^(\/|[A-Za-z]:\\)/.test(value);
}

/**
 * 纯路径截断，保留文件名
 */
export function truncatePath(path: string, maxLen: number): string {
	const safeMaxLen = Math.max(maxLen, 4); // 至少能显示 "...x"
	if (path.length <= safeMaxLen) return path;

	const sep = path.includes('\\') ? '\\' : '/';
	const lastSep = path.lastIndexOf(sep);
	const filename = lastSep >= 0 ? path.slice(lastSep + 1) : path;

	// 文件名本身就超长，从末尾截断
	if (filename.length + 4 > safeMaxLen) {
		return '...' + filename.slice(-(safeMaxLen - 3));
	}

	// 保留文件名，从目录部分的末尾保留尽可能多的内容
	const prefix = '...' + sep;
	const availableForDir = safeMaxLen - prefix.length - filename.length - 1; // -1 for sep before filename

	if (availableForDir <= 0) {
		return prefix + filename;
	}

	const dirPart = path.slice(0, lastSep);
	return prefix + dirPart.slice(-availableForDir) + sep + filename;
}

/**
 * 用 OSC 8 超链接包装文本
 */
export function wrapWithFileLink(filePath: string, displayText: string): string {
	const fileUrl = `file://${filePath}`;
	return `\x1b]8;;${fileUrl}\x07${displayText}\x1b]8;;\x07`;
}

/**
 * 智能截断路径并添加可点击链接
 */
export function smartTruncatePath(filePath: string, maxLength?: number): string {
	const effectiveMaxLength = Math.max(
		maxLength ?? getTerminalWidth() - PATH_DISPLAY_PADDING,
		MIN_DISPLAY_LENGTH,
	);
	const displayText = truncatePath(filePath, effectiveMaxLength);
	return wrapWithFileLink(filePath, displayText);
}

/**
 * Format tool call display information for UI rendering
 */
export function formatToolCallMessage(toolCall: ToolCall): {
	toolName: string;
	args: Array<{key: string; value: string; isLast: boolean}>;
} {
	try {
		const args = JSON.parse(toolCall.function.arguments);
		const argEntries = Object.entries(args);
		const formattedArgs: Array<{key: string; value: string; isLast: boolean}> =
			[];

		// Edit 工具的长内容参数列表
		const editToolLongContentParams = [
			'searchContent',
			'replaceContent',
			'newContent',
			'oldContent',
			'content',
			'completeOldContent',
			'completeNewContent',
		];

		// Edit 工具名称列表
		const editTools = [
			'filesystem-edit',
			'filesystem-edit_search',
			'filesystem-create',
		];

		const isEditTool = editTools.includes(toolCall.function.name);
		const isTerminalExecute = toolCall.function.name === 'terminal-execute';

		if (argEntries.length > 0) {
			argEntries.forEach(([key, value], idx, arr) => {
				let valueStr: string;

				// 对 edit 工具的长内容参数进行特殊处理
				if (isEditTool && editToolLongContentParams.includes(key)) {
					if (typeof value === 'string') {
						const lines = value.split('\n');
						const lineCount = lines.length;

						if (lineCount > 3) {
							// 多行内容：显示行数统计
							valueStr = `<${lineCount} lines>`;
						} else if (value.length > 60) {
							// 单行但很长：截断显示
							valueStr = `"${value.slice(0, 60)}..."`;
						} else {
							// 短内容：正常显示
							valueStr = `"${value}"`;
						}
					} else {
						valueStr = JSON.stringify(value);
					}
				} else {
					// 其他参数：智能处理不同类型
					if (typeof value === 'string') {
						// terminal-execute 的 command 参数完整显示，不截断
						if (isTerminalExecute && key === 'command') {
							valueStr = `"${value}"`;
						} else if (isFilePath(value)) {
							// 路径参数：智能截断，保留文件名
							valueStr = `"${smartTruncatePath(value)}"`;
						} else {
							// 其他字符串类型参数
							valueStr =
								value.length > 60 ? `"${value.slice(0, 60)}..."` : `"${value}"`;
						}
					} else if (Array.isArray(value)) {
						// 数组类型：显示元素数量
						if (value.length === 0) {
							valueStr = '[]';
						} else if (value.length === 1) {
							// 单个元素：尝试简化显示
							const item = value[0];
							if (typeof item === 'object' && item !== null) {
								const keys = Object.keys(item);
								valueStr = `[{${keys.slice(0, 2).join(', ')}${
									keys.length > 2 ? ', ...' : ''
								}}]`;
							} else {
								valueStr = JSON.stringify(value);
							}
						} else {
							// 多个元素：显示数量
							valueStr = `<array with ${value.length} items>`;
						}
					} else if (typeof value === 'object' && value !== null) {
						// 对象类型：显示键名
						const keys = Object.keys(value);
						if (keys.length === 0) {
							valueStr = '{}';
						} else if (keys.length <= 3) {
							valueStr = `{${keys.join(', ')}}`;
						} else {
							valueStr = `{${keys.slice(0, 3).join(', ')}, ...}`;
						}
					} else {
						// 其他类型（数字、布尔等）
						valueStr = JSON.stringify(value);
					}
				}

				formattedArgs.push({
					key,
					value: valueStr,
					isLast: idx === arr.length - 1,
				});
			});
		}

		return {
			toolName: toolCall.function.name,
			args: formattedArgs,
		};
	} catch (e) {
		return {
			toolName: toolCall.function.name,
			args: [],
		};
	}
}
