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
 * 纯路径截断，从后往前保留完整的目录名
 */
export function truncatePath(path: string, maxLen: number): string {
	const safeMaxLen = Math.max(maxLen, 4);
	if (path.length <= safeMaxLen) return path;

	const sep = path.includes('\\') ? '\\' : '/';
	const parts = path.split(sep);
	const filename = parts.pop() || '';

	// 文件名本身就超长，从末尾截断
	if (filename.length + 4 > safeMaxLen) {
		return '...' + filename.slice(-(safeMaxLen - 3));
	}

	// 从后往前保留完整的目录层级
	const prefix = '...' + sep;
	const available = safeMaxLen - prefix.length - filename.length - 1; // -1 for sep before filename

	if (available <= 0) {
		return prefix + filename;
	}

	// 从后往前遍历，收集能容纳的完整目录
	const includedParts: string[] = [];
	let used = filename.length;

	for (let i = parts.length - 1; i >= 0; i--) {
		const part = parts[i];
		if (!part) continue;
		const needed = part.length + 1; // +1 for separator

		if (used + needed > available) {
			break;
		}

		includedParts.unshift(part);
		used += needed;
	}

	if (includedParts.length === 0) {
		return prefix + filename;
	}

	return prefix + includedParts.join(sep) + sep + filename;
}

/**
 * 用 OSC 8 超链接包装文本
 */
export function wrapWithFileLink(
	filePath: string,
	displayText: string,
): string {
	const fileUrl = `file://${filePath}`;
	return `\x1b]8;;${fileUrl}\x07${displayText}\x1b]8;;\x07`;
}

/**
 * 智能截断路径并添加可点击链接
 * @param filePath - 文件路径
 * @param maxLength - 最大显示长度
 * @param includeLink - 是否包含 OSC 8 超链接，默认为 true。在 Ink 等 React 终端渲染环境中应设为 false
 */
export function smartTruncatePath(
	filePath: string,
	maxLength?: number,
	includeLink: boolean = true,
): string {
	const effectiveMaxLength = Math.max(
		maxLength ?? getTerminalWidth() - PATH_DISPLAY_PADDING,
		MIN_DISPLAY_LENGTH,
	);
	const displayText = truncatePath(filePath, effectiveMaxLength);
	if (!includeLink) {
		return displayText;
	}
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
						} else if (value.startsWith('[') || value.startsWith('{')) {
							// 尝试解析 JSON 字符串（可能是被序列化的数组或对象）
							try {
								const parsed = JSON.parse(value);
								if (Array.isArray(parsed)) {
									// 解析成功，按数组格式化
									if (parsed.length === 0) {
										valueStr = '[]';
									} else if (parsed.length <= 3) {
										// 少量元素：显示简化内容
										const items = parsed
											.map(item =>
												typeof item === 'string'
													? item.length > 20
														? `"${item.slice(0, 20)}..."`
														: `"${item}"`
													: typeof item === 'object'
													? '{...}'
													: String(item),
											)
											.join(', ');
										valueStr = `[${items}]`;
									} else {
										// 多个元素：显示数量
										valueStr = `<array with ${parsed.length} items>`;
									}
								} else if (typeof parsed === 'object' && parsed !== null) {
									// 解析为对象
									const keys = Object.keys(parsed);
									if (keys.length === 0) {
										valueStr = '{}';
									} else if (keys.length <= 3) {
										valueStr = `{${keys.join(', ')}}`;
									} else {
										valueStr = `{${keys.slice(0, 3).join(', ')}, ...}`;
									}
								} else {
									// 其他解析结果（数字、布尔等）
									valueStr = String(parsed);
								}
							} catch {
								// 解析失败，当作普通字符串处理
								valueStr =
									value.length > 60
										? `"${value.slice(0, 60)}..."`
										: `"${value}"`;
							}
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
