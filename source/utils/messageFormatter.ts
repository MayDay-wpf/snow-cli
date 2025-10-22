import type {ToolCall} from './toolExecutor.js';

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
						// 字符串类型
						valueStr =
							value.length > 60 ? `"${value.slice(0, 60)}..."` : `"${value}"`;
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
