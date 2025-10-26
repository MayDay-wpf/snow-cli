import {cpLen, cpSlice, visualWidth, toCodePoints} from './textUtils.js';

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
	private pasteAccumulator: string = ''; // 累积粘贴内容
	private pasteTimer: NodeJS.Timeout | null = null; // 粘贴完成检测定时器
	private pastePlaceholderPosition: number = -1; // 占位符插入位置
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
		if (this.pasteTimer) {
			clearTimeout(this.pasteTimer);
			this.pasteTimer = null;
		}
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
			this.pasteAccumulator = '';
			if (this.pasteTimer) {
				clearTimeout(this.pasteTimer);
				this.pasteTimer = null;
			}
			this.pastePlaceholderPosition = -1;
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

		// 检测是否是大文本输入（可能是粘贴操作的一部分）
		if (charCount > 200) {
			// 清除之前的定时器
			if (this.pasteTimer) {
				clearTimeout(this.pasteTimer);
			}

			// 如果是第一批数据，记录插入位置并清空内容
			const isFirstBatch = !this.pasteAccumulator;
			if (isFirstBatch) {
				this.pastePlaceholderPosition = this.cursorIndex;
				// 保存粘贴位置前后的内容，避免后续计算错误
				this.content = cpSlice(this.content, 0, this.pastePlaceholderPosition) +
					cpSlice(this.content, this.pastePlaceholderPosition);
			}

			// 累积数据
			this.pasteAccumulator += sanitized;

			// 移除所有旧的临时占位符（使用全局替换）
			if (!isFirstBatch) {
				const tempPlaceholderPattern = /\[Pasting\.\.\. \d+ chars\]/g;
				this.content = this.content.replace(tempPlaceholderPattern, '');
			}

			// 显示更新后的临时占位符
			const tempPlaceholder = `[Pasting... ${this.pasteAccumulator.length} chars]`;
			const before = cpSlice(this.content, 0, this.pastePlaceholderPosition);
			const after = cpSlice(this.content, this.pastePlaceholderPosition);
			this.content = before + tempPlaceholder + after;
			this.cursorIndex = this.pastePlaceholderPosition + cpLen(tempPlaceholder);

			// 设置150ms的定时器，如果150ms内没有新数据，则认为粘贴完成
			this.pasteTimer = setTimeout(() => {
				if (!this.isDestroyed) {
					this.finalizePaste();
				}
			}, 150);

			this.recalculateVisualState();
			this.scheduleUpdate();
			return;
		}

		// 普通输入（小于200字符）
		// 如果有累积的粘贴数据，先完成粘贴
		if (this.pasteAccumulator) {
			this.finalizePaste();
		}

		// 正常插入文本
		this.insertPlainText(sanitized);
		this.scheduleUpdate();
	}

	/**
	 * 完成粘贴操作，创建占位符
	 */
	private finalizePaste(): void {
		if (!this.pasteAccumulator) {
			return;
		}

		const totalChars = this.pasteAccumulator.length;

		// 移除所有临时占位符（使用全局替换）
		// 临时占位符格式: [Pasting... XXX chars]
		const tempPlaceholderPattern = /\[Pasting\.\.\. \d+ chars\]/g;
		this.content = this.content.replace(tempPlaceholderPattern, '');

		// 只有当累积的字符数超过300时才创建占位符
		if (totalChars > 300) {
			this.textPlaceholderCounter++;
			const pasteId = `paste_${Date.now()}_${this.textPlaceholderCounter}`;
			const placeholderText = `[Paste ${totalChars} characters #${this.textPlaceholderCounter}]`;

			this.placeholderStorage.set(pasteId, {
				id: pasteId,
				type: 'text',
				content: this.pasteAccumulator,
				charCount: totalChars,
				index: this.textPlaceholderCounter,
				placeholder: placeholderText,
			});

			// 在记录的位置插入占位符
			const before = cpSlice(this.content, 0, this.pastePlaceholderPosition);
			const after = cpSlice(this.content, this.pastePlaceholderPosition);
			this.content = before + placeholderText + after;
			this.cursorIndex = this.pastePlaceholderPosition + cpLen(placeholderText);
		} else {
			// 如果总字符数不够，直接插入原文本
			const before = cpSlice(this.content, 0, this.pastePlaceholderPosition);
			const after = cpSlice(this.content, this.pastePlaceholderPosition);
			this.content = before + this.pasteAccumulator + after;
			this.cursorIndex =
				this.pastePlaceholderPosition + cpLen(this.pasteAccumulator);
		}

		// 清理状态
		this.pasteAccumulator = '';
		this.pastePlaceholderPosition = -1;
		if (this.pasteTimer) {
			clearTimeout(this.pasteTimer);
			this.pasteTimer = null;
		}

		this.recalculateVisualState();
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
		this.recomputeVisualCursorOnly();
	}

	moveRight(): void {
		if (this.cursorIndex >= cpLen(this.content)) {
			return;
		}

		this.cursorIndex += 1;
		this.recomputeVisualCursorOnly();
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
			return;
		}

		const currentRow = this.visualCursorPos[0];
		if (currentRow <= 0) {
			return;
		}

		this.moveCursorToVisualRow(currentRow - 1);
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
			return;
		}

		const currentRow = this.visualCursorPos[0];
		if (currentRow >= this.visualLines.length - 1) {
			return;
		}

		this.moveCursorToVisualRow(currentRow + 1);
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

		while (start < codePoints.length) {
			let currentWidth = 0;
			let end = start;
			let lastBreak = -1;

			while (end < codePoints.length) {
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
			if (clamped >= start) {
				const line = this.visualLines[i] ?? '';
				const col = Math.min(cpLen(line), clamped - start);
				return [i, col];
			}
		}

		return [0, clamped];
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
		const lineLength = cpLen(line);
		const column = Math.min(this.preferredVisualCol, lineLength);

		this.cursorIndex = start + column;
		this.visualCursorPos = [row, column];
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
		const placeholderText = `[image #${this.imagePlaceholderCounter}]`;

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
			.filter((p) => p.type === 'image')
			.map((p) => {
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
