import stringWidth from 'string-width';

export type ThinkingStatus = {
	isActive: boolean;
	content?: string;
};

/**
 * 思考预览不再使用独立的 5 行视窗面板：
 * 面板出现/消失会让动态区高度瞬间变化 6 行，而转录区同时只新增 1-3 行，
 * 净高度突变导致下方 ChatFooter 先上跳、随后又被新内容推回（上下跳动）。
 * 现在只保留「单行预览文本」的构建逻辑，由 LoadingIndicator 在自己的
 * 状态块内渲染（与 tips 行共用同一行位置），保证 footer 高度恒定。
 * 注意：ThinkingStatus 类型被 hooks（streamProcessor/conversationTypes 等）
 * 引用，文件路径保持不变，避免跨层 import 变更。
 */
const PREVIEW_RESERVED_COLUMNS = 8;
const PREVIEW_ELLIPSIS = '…';

function normalizeStreamContent(content: string | undefined): string {
	return (
		content
			?.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			.replace(/[\t\v\f]+/g, ' ') ?? ''
	);
}

/**
 * 按可视宽度从尾部截取：思考流只需要展示最新的一段文字。
 * 使用 Array.from 遍历码点，避免截断代理对产生乱码。
 */
function sliceTailByVisualWidth(text: string, maxWidth: number): string {
	if (!text || maxWidth <= 0) {
		return '';
	}

	const chars = Array.from(text);
	let result = '';
	let width = 0;

	for (let i = chars.length - 1; i >= 0; i--) {
		const char = chars[i] as string;
		const charWidth = stringWidth(char);
		if (width + charWidth > maxWidth) {
			break;
		}

		result = char + result;
		width += charWidth;
	}

	return result;
}

/**
 * 把实时思考内容压成一行、且不超过安全宽度的预览文本（取最新内容的尾部）。
 * 返回空字符串表示当前没有可展示的思考内容。
 */
export function buildThinkingPreviewLine(
	content: string | undefined,
	terminalWidth: number,
): string {
	// 多行折叠成单行，避免预览行折行导致渲染高度变化。
	const flattened = normalizeStreamContent(content)
		.replace(/\s+/g, ' ')
		.trim();
	if (!flattened) {
		return '';
	}

	const maxWidth = Math.max(1, terminalWidth - PREVIEW_RESERVED_COLUMNS);
	const visible = sliceTailByVisualWidth(flattened, maxWidth);
	if (!visible) {
		return '';
	}

	return visible.length < flattened.length
		? `${PREVIEW_ELLIPSIS}${visible}`
		: visible;
}
