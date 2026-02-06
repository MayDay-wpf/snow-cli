import {
	codePointToVisualPos,
	cpLen,
	cpSlice,
	visualPosToCodePoint,
	visualWidth,
	toCodePoints,
} from '../core/textUtils.js';

export interface Viewport {
	width: number;
	height: number;
}

/**
 * Strip characters that can break terminal rendering.
 */
function sanitizeInput(str: string): string {
	// Replace problematic characters but preserve basic formatting
	return (
		str
			.replace(/\r\n/g, '\n') // Normalize line endings
			.replace(/\r/g, '\n') // Convert remaining \r to \n
			.replace(/\t/g, '  ') // Convert tabs to spaces
			// Remove focus events emitted during terminal focus changes
			.replace(/\x1b\[[IO]/g, '')
			// Remove stray [I/[O] tokens that precede drag-and-drop payloads
			.replace(/(^|\s+)\[(?:I|O)(?=(?:\s|$|["'~\\\/]|[A-Za-z]:))/g, '$1')
			// Remove control characters except newlines
			.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
	);
}

/**
 * 统一的占位符类型，用于大文本粘贴和图片
 */
export interface Placeholder {
	id: string;
	content: string; // 原始内容（文本或 base64）
	type: 'text' | 'image'; // 类型
	charCount: number; // 字符数
	index: number; // 序号（第几个）
	placeholder: string; // 显示的占位符文本
	mimeType?: string; // 图片 MIME 类型（仅图片类型有值）
}

/**
 * 图片数据类型（向后兼容）
 */
export interface ImageData {
	id: string;
	data: string;
	mimeType: string;
	index: number;
	placeholder: string;
}

export class TextBuffer {
	private content = '';
	private cursorIndex = 0;
	private viewport: Viewport;
	private placeholderStorage: Map<string, Placeholder> = new Map(); // 统一的占位符存储
	private textPlaceholderCounter = 0; // 文本占位符计数器
	private imagePlaceholderCounter = 0; // 图片占位符计数器
	private onUpdateCallback?: () => void; // 更新回调函数
	private isDestroyed: boolean = false; // 标记是否已销毁

	private visualLines: string[] = [''];
	private visualLineStarts: number[] = [0];
	private visualCursorPos: [number, number] = [0, 0];
	private preferredVisualCol = 0;

	constructor(viewport: Viewport, onUpdate?: () => void) {
		this.viewport = viewport;
		this.onUpdateCallback = onUpdate;
		this.recalculateVisualState();
	}

	/**
	 * Cleanup method to be called when the buffer is no longer needed
	 */
	destroy(): void {
		this.isDestroyed = true;
		this.placeholderStorage.clear();
		this.onUpdateCallback = undefined;
	}

	get text(): string {
		return this.content;
	}

	/**
	 * 获取完整文本，包括替换占位符为原始内容（仅文本类型）
	 */
	getFullText(): string {
		let fullText = this.content;

		for (const placeholder of this.placeholderStorage.values()) {
			// 只替换文本类型的占位符
			if (placeholder.type === 'text' && placeholder.placeholder) {
				fullText = fullText
					.split(placeholder.placeholder)
					.join(placeholder.content);
			}
		}

		return fullText;
	}

	get visualCursor(): [number, number] {
		return this.visualCursorPos;
	}

	getCursorPosition(): number {
		return this.cursorIndex;
	}

	setCursorPosition(position: number): void {
		this.cursorIndex = position;
		this.clampCursorIndex();
		this.recomputeVisualCursorOnly();
	}

	get viewportVisualLines(): string[] {
		return this.visualLines;
	}

	get maxWidth(): number {
		return this.viewport.width;
	}

	private scheduleUpdate(): void {
		// Notify external components of updates
		if (!this.isDestroyed && this.onUpdateCallback) {
			this.onUpdateCallback();
		}
	}

	setText(text: string): void {
		const sanitized = sanitizeInput(text);
		this.content = sanitized;
		this.clampCursorIndex();

		if (sanitized === '') {
			this.placeholderStorage.clear();
			this.textPlaceholderCounter = 0;
			this.imagePlaceholderCounter = 0;
		}

		this.recalculateVisualState();
		this.scheduleUpdate();
	}

	insert(input: string): void {
		const sanitized = sanitizeInput(input);
		if (!sanitized) {
			return;
		}

		const charCount = sanitized.length;
		if (charCount > 300) {
			this.textPlaceholderCounter++;
			const pasteId = `paste_${Date.now()}_${this.textPlaceholderCounter}`;
			const lineCount = (sanitized.match(/\n/g) || []).length + 1;
			const placeholderText = `[Paste ${lineCount} lines #${this.textPlaceholderCounter}] `;

			this.placeholderStorage.set(pasteId, {
				id: pasteId,
				type: 'text',
				content: sanitized,
				charCount,
				index: this.textPlaceholderCounter,
				placeholder: placeholderText,
			});

			this.insertPlainText(placeholderText);
		} else {
			this.insertPlainText(sanitized);
		}

		this.scheduleUpdate();
	}

	/**
	 * 插入文本占位符：显示 placeholderText，但 getFullText() 会还原为原始 content。
	 * 用于 skills 注入等“只做视觉隐藏”的场景。
	 */
	insertTextPlaceholder(content: string, placeholderText: string): void {
		const sanitizedContent = sanitizeInput(content);
		const sanitizedPlaceholder = sanitizeInput(placeholderText);
		if (!sanitizedPlaceholder) return;

		this.textPlaceholderCounter++;
		const id = `text_${Date.now()}_${this.textPlaceholderCounter}`;

		this.placeholderStorage.set(id, {
			id,
			type: 'text',
			content: sanitizedContent,
			charCount: sanitizedContent.length,
			index: this.textPlaceholderCounter,
			placeholder: sanitizedPlaceholder,
		});

		// 直接插入占位符文本，不触发“大文本粘贴占位符”逻辑。
		this.insertPlainText(sanitizedPlaceholder);
		this.scheduleUpdate();
	}

	/**
	 * 用于“回滚恢复”场景的插入：不触发大文本粘贴占位符逻辑。
	 * 这样可以把历史消息原样恢复到输入框，而不是显示为 [Paste ...]。
	 */
	insertRestoredText(input: string): void {
		const sanitized = sanitizeInput(input);
		if (!sanitized) return;
		this.insertPlainText(sanitized);
		this.scheduleUpdate();
	}

	private insertPlainText(text: string): void {
		if (!text) {
			return;
		}

		this.clampCursorIndex();
		const before = cpSlice(this.content, 0, this.cursorIndex);
		const after = cpSlice(this.content, this.cursorIndex);
		this.content = before + text + after;
		this.cursorIndex += cpLen(text);
		this.recalculateVisualState();
	}

	backspace(): void {
		if (this.cursorIndex === 0) {
			return;
		}

		const before = cpSlice(this.content, 0, this.cursorIndex - 1);
		const after = cpSlice(this.content, this.cursorIndex);
		this.content = before + after;
		this.cursorIndex -= 1;
		this.recalculateVisualState();
		this.scheduleUpdate();
	}

	delete(): void {
		if (this.cursorIndex >= cpLen(this.content)) {
			return;
		}

		const before = cpSlice(this.content, 0, this.cursorIndex);
		const after = cpSlice(this.content, this.cursorIndex + 1);
		this.content = before + after;
		this.recalculateVisualState();
		this.scheduleUpdate();
	}

	moveLeft(): void {
		if (this.cursorIndex === 0) {
			return;
		}

		this.cursorIndex -= 1;
		this.recalculateVisualState();
		this.scheduleUpdate();
	}

	moveRight(): void {
		if (this.cursorIndex >= cpLen(this.content)) {
			return;
		}

		this.cursorIndex += 1;
		this.recalculateVisualState();
		this.scheduleUpdate();
	}

	moveUp(): void {
		if (this.visualLines.length === 0) {
			return;
		}

		// 检查是否只有单行（没有换行符）
		const hasNewline = this.content.includes('\n');
		if (!hasNewline && this.visualLines.length === 1) {
			// 单行模式：移动到行首
			this.cursorIndex = 0;
			this.recomputeVisualCursorOnly();
			this.scheduleUpdate();
			return;
		}

		const currentRow = this.visualCursorPos[0];
		if (currentRow <= 0) {
			return;
		}

		this.moveCursorToVisualRow(currentRow - 1);
		this.scheduleUpdate();
	}

	moveDown(): void {
		if (this.visualLines.length === 0) {
			return;
		}

		// 检查是否只有单行（没有换行符）
		const hasNewline = this.content.includes('\n');
		if (!hasNewline && this.visualLines.length === 1) {
			// 单行模式：移动到行尾
			this.cursorIndex = cpLen(this.content);
			this.recomputeVisualCursorOnly();
			this.scheduleUpdate();
			return;
		}

		const currentRow = this.visualCursorPos[0];
		if (currentRow >= this.visualLines.length - 1) {
			return;
		}

		this.moveCursorToVisualRow(currentRow + 1);
		this.scheduleUpdate();
	}

	/**
	 * Update the viewport dimensions, useful for terminal resize handling.
	 */
	updateViewport(viewport: Viewport): void {
		const needsRecalculation =
			this.viewport.width !== viewport.width ||
			this.viewport.height !== viewport.height;

		this.viewport = viewport;

		if (needsRecalculation) {
			this.recalculateVisualState();
			this.scheduleUpdate();
		}
	}

	/**
	 * Get the character and its visual info at cursor position for proper rendering.
	 */
	getCharAtCursor(): {char: string; isWideChar: boolean} {
		const codePoints = toCodePoints(this.content);

		if (this.cursorIndex >= codePoints.length) {
			return {char: ' ', isWideChar: false};
		}

		const char = codePoints[this.cursorIndex] || ' ';
		return {char, isWideChar: visualWidth(char) > 1};
	}

	private clampCursorIndex(): void {
		const length = cpLen(this.content);
		if (this.cursorIndex < 0) {
			this.cursorIndex = 0;
		} else if (this.cursorIndex > length) {
			this.cursorIndex = length;
		}
	}

	private recalculateVisualState(): void {
		this.clampCursorIndex();

		const width = this.viewport.width;
		const effectiveWidth =
			Number.isFinite(width) && width > 0 ? width : Number.POSITIVE_INFINITY;
		const rawLines = this.content.split('\n');
		const nextVisualLines: string[] = [];
		const nextStarts: number[] = [];

		let cpOffset = 0;
		const linesToProcess = rawLines.length > 0 ? rawLines : [''];

		for (let i = 0; i < linesToProcess.length; i++) {
			const rawLine = linesToProcess[i] ?? '';
			const segments = this.wrapLineToWidth(rawLine, effectiveWidth);

			if (segments.length === 0) {
				nextVisualLines.push('');
				nextStarts.push(cpOffset);
			} else {
				for (const segment of segments) {
					nextVisualLines.push(segment);
					nextStarts.push(cpOffset);
					cpOffset += cpLen(segment);
				}
			}

			if (i < linesToProcess.length - 1) {
				// Account for the newline character that separates raw lines
				cpOffset += 1;
			}
		}

		if (nextVisualLines.length === 0) {
			nextVisualLines.push('');
			nextStarts.push(0);
		}

		this.visualLines = nextVisualLines;
		this.visualLineStarts = nextStarts;
		this.visualCursorPos = this.computeVisualCursorFromIndex(this.cursorIndex);
		this.preferredVisualCol = this.visualCursorPos[1];
	}

	private wrapLineToWidth(line: string, width: number): string[] {
		if (line === '') {
			return [''];
		}

		if (!Number.isFinite(width) || width <= 0) {
			return [line];
		}

		const codePoints = toCodePoints(line);
		const segments: string[] = [];
		let start = 0;

		// Helper function to find placeholder at given position
		const findPlaceholderAt = (
			pos: number,
		): {start: number; end: number} | null => {
			// Look backwards to find the opening bracket
			let openPos = pos;
			while (openPos >= 0 && codePoints[openPos] !== '[') {
				openPos--;
			}

			if (openPos >= 0 && codePoints[openPos] === '[') {
				// Look forward to find the closing bracket
				let closePos = openPos + 1;
				while (closePos < codePoints.length && codePoints[closePos] !== ']') {
					closePos++;
				}

				if (closePos < codePoints.length && codePoints[closePos] === ']') {
					const baseText = codePoints.slice(openPos, closePos + 1).join('');
					const hasTrailingSpace = codePoints[closePos + 1] === ' ';
					const placeholderText = hasTrailingSpace ? `${baseText} ` : baseText;
					const end = hasTrailingSpace ? closePos + 2 : closePos + 1;

					// Check if it's a valid placeholder
					if (
						placeholderText.match(/^\[Paste \d+ lines #\d+\] ?$/) ||
						placeholderText.match(/^\[image #\d+\] ?$/) ||
						placeholderText.match(/^\[Skill:[^\]]+\] ?$/)
					) {
						return {start: openPos, end};
					}
				}
			}

			return null;
		};

		while (start < codePoints.length) {
			let currentWidth = 0;
			let end = start;
			let lastBreak = -1;

			while (end < codePoints.length) {
				// Check if current position is start of a placeholder
				if (codePoints[end] === '[') {
					const placeholder = findPlaceholderAt(end);
					if (placeholder && placeholder.start === end) {
						const placeholderText = codePoints
							.slice(placeholder.start, placeholder.end)
							.join('');
						const placeholderWidth = Array.from(placeholderText).reduce(
							(sum, c) => sum + visualWidth(c),
							0,
						);

						// If placeholder fits on current line, include it
						if (currentWidth + placeholderWidth <= width) {
							currentWidth += placeholderWidth;
							end = placeholder.end;
							continue;
						} else if (currentWidth === 0) {
							// Placeholder doesn't fit but we're at line start, force it on this line
							end = placeholder.end;
							break;
						} else {
							// Placeholder doesn't fit, break before it
							break;
						}
					}
				}

				const char = codePoints[end] || '';
				const charWidth = visualWidth(char);

				if (char === ' ') {
					lastBreak = end + 1;
				}

				if (currentWidth + charWidth > width) {
					if (lastBreak > start) {
						end = lastBreak;
					}
					break;
				}

				currentWidth += charWidth;
				end++;
			}

			if (end === start) {
				end = Math.min(start + 1, codePoints.length);
			}

			segments.push(codePoints.slice(start, end).join(''));
			start = end;
		}

		return segments;
	}

	private computeVisualCursorFromIndex(position: number): [number, number] {
		if (this.visualLines.length === 0) {
			return [0, 0];
		}

		const totalLength = cpLen(this.content);
		const clamped = Math.max(0, Math.min(position, totalLength));

		for (let i = this.visualLines.length - 1; i >= 0; i--) {
			const start = this.visualLineStarts[i] ?? 0;
			const nextStart = this.visualLineStarts[i + 1];
			const lineEnd =
				typeof nextStart === 'number' ? nextStart - 1 : totalLength;
			if (clamped >= start && clamped <= lineEnd) {
				const line = this.visualLines[i] ?? '';
				const lineOffset = Math.max(0, clamped - start);
				const withinLine = cpSlice(this.content, start, start + lineOffset);
				const col = Math.min(
					visualWidth(line),
					codePointToVisualPos(withinLine, cpLen(withinLine)),
				);
				return [i, col];
			}
		}

		return [0, 0];
	}

	private moveCursorToVisualRow(targetRow: number): void {
		if (this.visualLines.length === 0) {
			this.cursorIndex = 0;
			this.visualCursorPos = [0, 0];
			return;
		}

		const row = Math.max(0, Math.min(targetRow, this.visualLines.length - 1));
		const start = this.visualLineStarts[row] ?? 0;
		const line = this.visualLines[row] ?? '';
		const lineVisualWidth = visualWidth(line);
		const visualColumn = Math.min(this.preferredVisualCol, lineVisualWidth);
		const codePointOffset = visualPosToCodePoint(line, visualColumn);

		this.cursorIndex = start + codePointOffset;
		this.visualCursorPos = [row, visualColumn];
	}

	private recomputeVisualCursorOnly(): void {
		this.visualCursorPos = this.computeVisualCursorFromIndex(this.cursorIndex);
		this.preferredVisualCol = this.visualCursorPos[1];
	}

	/**
	 * 插入图片数据（使用统一的占位符系统）
	 */
	insertImage(base64Data: string, mimeType: string): void {
		// 清理 base64 数据：移除所有空白字符（包括换行符）
		// PowerShell/macOS 的 base64 编码可能包含换行符
		const cleanedBase64 = base64Data.replace(/\s+/g, '');

		this.imagePlaceholderCounter++;
		const imageId = `image_${Date.now()}_${this.imagePlaceholderCounter}`;
		const placeholderText = `[image #${this.imagePlaceholderCounter}] `;

		this.placeholderStorage.set(imageId, {
			id: imageId,
			type: 'image',
			content: cleanedBase64,
			charCount: cleanedBase64.length,
			index: this.imagePlaceholderCounter,
			placeholder: placeholderText,
			mimeType: mimeType,
		});

		this.insertPlainText(placeholderText);
		this.scheduleUpdate();
	}

	/**
	 * 获取所有图片数据（还原为 data URL 格式）
	 */
	getImages(): ImageData[] {
		return Array.from(this.placeholderStorage.values())
			.filter(p => p.type === 'image')
			.map(p => {
				const mimeType = p.mimeType || 'image/png';
				// 还原为 data URL 格式
				const dataUrl = `data:${mimeType};base64,${p.content}`;
				return {
					id: p.id,
					data: dataUrl,
					mimeType: mimeType,
					index: p.index,
					placeholder: p.placeholder,
				};
			})
			.sort((a, b) => a.index - b.index);
	}

	/**
	 * 清除所有图片
	 */
	clearImages(): void {
		// 只清除图片类型的占位符
		for (const [id, placeholder] of this.placeholderStorage.entries()) {
			if (placeholder.type === 'image') {
				this.placeholderStorage.delete(id);
			}
		}
		this.imagePlaceholderCounter = 0;
	}
}
