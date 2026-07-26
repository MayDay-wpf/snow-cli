import path from 'node:path';
import type {ToolCall} from '../execution/toolExecutor.js';
import {getCurrentLanguage} from '../config/languageConfig.js';

/** Localized compact summary for multi-line edit-tool content. */
function formatLinesSummary(count: number): string {
	const lang = getCurrentLanguage();
	if (lang === 'zh' || lang === 'zh-TW') {
		return `<${count} 行>`;
	}
	return `<${count} lines>`;
}

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
 * 仅用于 UI 展示层，不改变真实 tool args。
 */
export function isFilePath(value: string): boolean {
	if (!value || typeof value !== 'string') return false;
	const trimmed = value.trim();
	if (!trimmed) return false;

	// 排除网络 / 协议 URL
	if (trimmed.includes('://')) return false;

	// Unix 绝对路径
	if (trimmed.startsWith('/')) return true;

	// Windows 绝对路径: C:\ 或 C:/
	if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;

	// 明确的相对路径前缀
	if (trimmed.startsWith('./') || trimmed.startsWith('.\\')) return true;
	if (trimmed.startsWith('../') || trimmed.startsWith('..\\')) return true;

	// 含分隔符且像路径：无空格、无换行，至少两段，末段像文件名或目录
	// 谨慎：普通句子（含空格）不识别为路径
	if (/\s/.test(trimmed) || trimmed.includes('\n')) return false;
	if (!/[\\/]/.test(trimmed)) return false;

	const parts = trimmed.split(/[\\/]/).filter(Boolean);
	if (parts.length < 2) return false;

	// 避免把 "a/b c" 之类已排除；再过滤明显非路径 token
	// 允许 source/foo.ts、node_modules/pkg、foo/bar 等
	const looksLikeSegment = (segment: string): boolean =>
		/^[A-Za-z0-9._@+-]+$/.test(segment);

	if (!parts.every(looksLikeSegment)) return false;

	// 至少一段含扩展名，或任一段是常见目录/文件形态
	const last = parts[parts.length - 1] ?? '';
	if (last.includes('.')) return true;
	// 纯目录风格相对路径：source/utils、src/components
	return parts.every(p => p.length > 0 && p !== '.' && p !== '..');
}

/**
 * 纯路径截断，从后往前保留完整的目录名
 */
export function truncatePath(pathStr: string, maxLen: number): string {
	const safeMaxLen = Math.max(maxLen, 4);
	if (pathStr.length <= safeMaxLen) return pathStr;

	const sep = pathStr.includes('\\') ? '\\' : '/';
	const parts = pathStr.split(sep);
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
 * 将路径转为 UI 友好显示：
 * - cwd 内相对化（优先 ./source/...，统一 /）
 * - cwd 外保留绝对路径并截断
 * - OSC 8 target 始终使用原始绝对路径
 */
export function toDisplayPath(raw: string, includeLink = true): string {
	if (!raw) return raw;

	const cwd = process.cwd();
	const absoluteForLink = path.isAbsolute(raw)
		? path.normalize(raw)
		: path.resolve(cwd, raw);

	let display = raw;

	try {
		const normalizedAbs = path.normalize(absoluteForLink);
		const normalizedCwd = path.normalize(cwd);

		// 不同盘符（Windows）无法相对化
		const sameRoot =
			path.parse(normalizedAbs).root.toLowerCase() ===
			path.parse(normalizedCwd).root.toLowerCase();

		if (sameRoot) {
			const rel = path.relative(normalizedCwd, normalizedAbs);
			// 以 .. 跳出 root 时回退绝对路径
			if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
				const withDot = rel.startsWith('.') ? rel : `./${rel}`;
				display = withDot.replace(/\\/g, '/');
			} else {
				// 保留绝对路径显示，统一 /
				display = normalizedAbs.replace(/\\/g, '/');
			}
		} else {
			display = normalizedAbs.replace(/\\/g, '/');
		}
	} catch {
		display = raw.replace(/\\/g, '/');
	}

	const effectiveMaxLength = Math.max(
		getTerminalWidth() - PATH_DISPLAY_PADDING,
		MIN_DISPLAY_LENGTH,
	);
	const truncated = truncatePath(display, effectiveMaxLength);

	if (!includeLink) {
		return truncated;
	}
	return wrapWithFileLink(absoluteForLink, truncated);
}

/**
 * 格式化单个数组元素用于工具参数展示
 */
function formatArrayItemForDisplay(item: unknown): string {
	if (typeof item === 'string') {
		if (isFilePath(item)) {
			return `"${toDisplayPath(item)}"`;
		}
		return item.length > 20 ? `"${item.slice(0, 20)}..."` : `"${item}"`;
	}
	if (typeof item === 'object' && item !== null) {
		return '{...}';
	}
	return String(item);
}

/**
 * 路径友好的数组展示：
 * - 0: []
 * - 1 路径: "./rel/path"（不要 JSON.stringify 整个数组）
 * - 2-3: [path1, path2]
 * - >3: 前 2 个 + +N
 * 混合对象时保持简化逻辑，字符串仍走路径友好显示。
 */
function formatArrayValue(value: unknown[]): string {
	if (value.length === 0) {
		return '[]';
	}

	const allPaths =
		value.length > 0 &&
		value.every(item => typeof item === 'string' && isFilePath(item));

	if (allPaths) {
		const paths = value as string[];
		if (paths.length === 1) {
			return `"${toDisplayPath(paths[0]!)}"`;
		}
		if (paths.length <= 3) {
			return `[${paths.map(p => `"${toDisplayPath(p)}"`).join(', ')}]`;
		}
		const head = paths
			.slice(0, 2)
			.map(p => `"${toDisplayPath(p)}"`)
			.join(', ');
		return `[${head}, +${paths.length - 2}]`;
	}

	// 混合 / 非路径数组
	if (value.length === 1) {
		const item = value[0];
		if (typeof item === 'object' && item !== null) {
			const keys = Object.keys(item);
			return `[{${keys.slice(0, 2).join(', ')}${
				keys.length > 2 ? ', ...' : ''
			}}]`;
		}
		if (typeof item === 'string' && isFilePath(item)) {
			return `"${toDisplayPath(item)}"`;
		}
		if (typeof item === 'string') {
			return item.length > 60 ? `["${item.slice(0, 60)}..."]` : `["${item}"]`;
		}
		// 禁止对路径数组 JSON.stringify；非路径单元素仍可用安全 stringify
		try {
			return JSON.stringify(value);
		} catch {
			return '[...]';
		}
	}

	if (value.length <= 3) {
		const items = value.map(formatArrayItemForDisplay).join(', ');
		return `[${items}]`;
	}

	const head = value.slice(0, 2).map(formatArrayItemForDisplay).join(', ');
	return `[${head}, +${value.length - 2}]`;
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
			'filesystem-replaceedit',
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
							valueStr = formatLinesSummary(lineCount);
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
							// 路径参数：相对化 + 智能截断
							valueStr = `"${toDisplayPath(value)}"`;
						} else if (value.startsWith('[') || value.startsWith('{')) {
							// 尝试解析 JSON 字符串（可能是被序列化的数组或对象）
							try {
								const parsed = JSON.parse(value);
								if (Array.isArray(parsed)) {
									valueStr = formatArrayValue(parsed);
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
						valueStr = formatArrayValue(value);
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
	} catch {
		return {
			toolName: toolCall.function.name,
			args: [],
		};
	}
}
