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
	private tempPastingPlaceholder: string | null = null; // 临时"粘贴中"占位符文本
	private lastTextPlaceholderId: string | null = null; // 合并同一批次粘贴
	private lastTextPlaceholderAt = 0; // 最近一次文本占位符更新时间
	private _expandedView = false; // 是否展开显示粘贴内容
	private _displayText = ''; // 用于视觉渲染的文本（展开/折叠）
	private _expandedSegments: Array<{
		type: 'gap' | 'placeholder';
		text: string;
		originalPlaceholder?: string;
	}> | null = null;

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
		this._expandedView = false;
		this._expandedSegments = null;
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

	get isExpandedView(): boolean {
		return this._expandedView;
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
			this._expandedView = false;
			this._expandedSegments = null;
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

		// 检查是否存在临时"粘贴中"占位符
		const hasPastingIndicator = this.tempPastingPlaceholder !== null;

		// 如果存在临时"粘贴中"占位符，先移除它，并调整光标位置
		if (this.tempPastingPlaceholder) {
			const placeholderIndex = this.content.indexOf(
				this.tempPastingPlaceholder,
			);
			if (placeholderIndex !== -1) {
				// 找到占位符的位置
				const placeholderLength = cpLen(this.tempPastingPlaceholder);

				// 移除占位符
				this.content =
					this.content.slice(0, placeholderIndex) +
					this.content.slice(
						placeholderIndex + this.tempPastingPlaceholder.length,
					);

				// 调整光标位置:如果光标在占位符之后,需要向前移动
				if (this.cursorIndex > placeholderIndex) {
					this.cursorIndex = Math.max(
						placeholderIndex,
						this.cursorIndex - placeholderLength,
					);
				}
			}
			this.tempPastingPlaceholder = null;
		}

		// 展开视图中直接插入纯文本，不创建粘贴占位符
		if (this._expandedView) {
			this.lastTextPlaceholderId = null;
			this.lastTextPlaceholderAt = 0;
			this.insertPlainText(sanitized);
			this.scheduleUpdate();
			return;
		}

		const now = Date.now();
		const shouldMerge =
			this.lastTextPlaceholderId !== null &&
			now - this.lastTextPlaceholderAt < 1200;

		// 优先处理“同一批粘贴的后续分片”：即使本片段 <=300 也应继续合并，
		// 否则会把尾部分片作为普通文本插到占位符后面，出现“标签泄露”。
		if (shouldMerge && this.lastTextPlaceholderId) {
			const existing = this.placeholderStorage.get(this.lastTextPlaceholderId);
			if (existing && existing.type === 'text') {
				existing.content += sanitized;
				existing.charCount += charCount;
				const lineCount = (existing.content.match(/\n/g) || []).length + 1;
				const nextPlaceholder = `[Paste ${lineCount} lines #${existing.index}] `;
				existing.placeholder = nextPlaceholder;
				const placeholderPattern = new RegExp(
					`\\[Paste \\d+ lines #${existing.index}\\] `,
					'g',
				);
				const match = placeholderPattern.exec(this.content);
				if (match) {
					const placeholderIndex = match.index;
					const previousLength = match[0].length;
					const nextLength = nextPlaceholder.length;
					const delta = nextLength - previousLength;
					if (delta !== 0 && this.cursorIndex > placeholderIndex) {
						this.cursorIndex = Math.max(
							placeholderIndex,
							this.cursorIndex + delta,
						);
					}
				}
				this.content = this.content.replace(
					placeholderPattern,
					nextPlaceholder,
				);
				this.lastTextPlaceholderAt = now;
				this.recalculateVisualState();
				this.scheduleUpdate();
				return;
			}
		}

		// 如果之前显示了"粘贴中"占位符，或者是大文本（>300字符），创建占位符
		// 使用 || 确保只要显示过"粘贴中"就一定创建占位符，防止sanitize后长度变化导致不一致
		if (hasPastingIndicator || charCount > 300) {
			this.textPlaceholderCounter++;
			const pasteId = `paste_${Date.now()}_${this.textPlaceholderCounter}`;
			// 计算行数
			const lineCount = (sanitized.match(/\n/g) || []).length + 1;
			const placeholderText = `[Paste ${lineCount} lines #${this.textPlaceholderCounter}] `;

			this.placeholderStorage.set(pasteId, {
				id: pasteId,
				type: 'text',
				content: sanitized,
				charCount: charCount,
				index: this.textPlaceholderCounter,
				placeholder: placeholderText,
			});

			this.lastTextPlaceholderId = pasteId;
			this.lastTextPlaceholderAt = now;

			// 插入占位符而不是原文本
			this.insertPlainText(placeholderText);
		} else {
			this.lastTextPlaceholderId = null;
			this.lastTextPlaceholderAt = 0;

			// 普通输入，直接插入文本
			this.insertPlainText(sanitized);
		}

		this.scheduleUpdate();
	}

	/**
	 * 插入临时"粘贴中"占位符，用于大文本粘贴时的用户反馈
	 */
	insertPastingIndicator(): void {
		// 如果已经有临时占位符，不需要重复插入
		if (this.tempPastingPlaceholder) {
			return;
		}

		// 创建静态的临时占位符（简单明了）
		this.tempPastingPlaceholder = `[Pasting...]`;
		this.insertPlainText(this.tempPastingPlaceholder);
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
		this.lastTextPlaceholderId = null;
		this.lastTextPlaceholderAt = 0;
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

		if (this._expandedView) {
			const phPositions = this.getTextPlaceholderCpPositions();
			for (const ph of phPositions) {
				if (
					this.cursorIndex > ph.cpStart &&
					this.cursorIndex <= ph.cpStart + ph.phCpLen
				) {
					this.cursorIndex = ph.cpStart;
					this.recalculateVisualState();
					this.scheduleUpdate();
					return;
				}
			}
		}

		this.cursorIndex -= 1;
		this.recalculateVisualState();
		this.scheduleUpdate();
	}

	moveRight(): void {
		if (this.cursorIndex >= cpLen(this.content)) {
			return;
		}

		if (this._expandedView) {
			const phPositions = this.getTextPlaceholderCpPositions();
			for (const ph of phPositions) {
				if (
					this.cursorIndex >= ph.cpStart &&
					this.cursorIndex < ph.cpStart + ph.phCpLen
				) {
					this.cursorIndex = ph.cpStart + ph.phCpLen;
					this.recalculateVisualState();
					this.scheduleUpdate();
					return;
				}
			}
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
	 * 切换展开/折叠显示模式（仅文本占位符，图片不受影响）
	 * 展开时将 content 替换为完整文本，允许直接编辑；
	 * 折叠时通过 gap 文本匹配重建占位符。
	 */
	toggleExpandedView(): void {
		if (!this._expandedView) {
			if (!this.hasTextPlaceholders()) {
				this._expandedView = true;
				this.recalculateVisualState();
				this.scheduleUpdate();
				return;
			}

			this._expandedSegments = this.buildExpandedSegments();
			const expandedText = this.getFullText();
			const expandedCursor = this.mapCursorToExpandedIndex(
				this.cursorIndex,
			);

			for (const [id, ph] of this.placeholderStorage.entries()) {
				if (ph.type === 'text') {
					this.placeholderStorage.delete(id);
				}
			}
			this.textPlaceholderCounter = 0;
			this.lastTextPlaceholderId = null;
			this.lastTextPlaceholderAt = 0;

			this.content = expandedText;
			this.cursorIndex = expandedCursor;
			this._expandedView = true;
		} else {
			if (this._expandedSegments) {
				this.refoldContent();
			}
			this._expandedSegments = null;
			this._expandedView = false;
		}

		this.clampCursorIndex();
		this.recalculateVisualState();
		this.scheduleUpdate();
	}

	/**
	 * 检查是否存在文本占位符
	 */
	hasTextPlaceholders(): boolean {
		for (const ph of this.placeholderStorage.values()) {
			if (ph.type === 'text') return true;
		}
		return false;
	}

	/**
	 * 构建展开前的段落列表，交替记录 gap（用户手动输入的文本）
	 * 和 placeholder（粘贴/Skill 占位符的实际内容）。
	 */
	private buildExpandedSegments(): Array<{
		type: 'gap' | 'placeholder';
		text: string;
		originalPlaceholder?: string;
	}> {
		const segments: Array<{
			type: 'gap' | 'placeholder';
			text: string;
			originalPlaceholder?: string;
		}> = [];

		const phEntries: Array<{ph: Placeholder; idx: number}> = [];
		for (const ph of this.placeholderStorage.values()) {
			if (ph.type !== 'text') continue;
			const idx = this.content.indexOf(ph.placeholder);
			if (idx !== -1) {
				phEntries.push({ph, idx});
			}
		}
		phEntries.sort((a, b) => a.idx - b.idx);

		if (phEntries.length === 0) {
			segments.push({type: 'gap', text: this.content});
			return segments;
		}

		let pos = 0;
		for (const entry of phEntries) {
			if (entry.idx > pos) {
				segments.push({
					type: 'gap',
					text: this.content.substring(pos, entry.idx),
				});
			}
			segments.push({
				type: 'placeholder',
				text: entry.ph.content,
				originalPlaceholder: entry.ph.placeholder,
			});
			pos = entry.idx + entry.ph.placeholder.length;
		}

		if (pos < this.content.length) {
			segments.push({
				type: 'gap',
				text: this.content.substring(pos),
			});
		}

		return segments;
	}

	/**
	 * 折叠内容：将展开编辑后的文本重新包装为粘贴占位符。
	 * 优先通过 gap 文本匹配定位原始占位符区域的边界；
	 * 未修改时精确还原，修改后尽力重建。
	 */
	private refoldContent(): void {
		const segments = this._expandedSegments;
		if (!segments) return;

		const currentText = this.content;
		const oldCursor = this.cursorIndex;
		const originalExpanded = segments.map(s => s.text).join('');

		if (currentText === originalExpanded) {
			this.restoreExactFromSegments(segments, oldCursor);
			return;
		}

		// 收集 gap 段落
		const gapSegments: Array<{segIdx: number; text: string}> = [];
		for (let i = 0; i < segments.length; i++) {
			if (segments[i]!.type === 'gap') {
				gapSegments.push({segIdx: i, text: segments[i]!.text});
			}
		}

		if (gapSegments.length === 0) {
			this.refoldEntireContent(currentText);
			return;
		}

		// 在当前文本中按顺序查找每个 gap 文本
		const gapPositions: Array<{
			start: number;
			end: number;
			found: boolean;
		}> = [];
		let searchFrom = 0;
		let allFound = true;

		for (const gap of gapSegments) {
			if (gap.text === '') {
				gapPositions.push({
					start: searchFrom,
					end: searchFrom,
					found: true,
				});
				continue;
			}
			const pos = currentText.indexOf(gap.text, searchFrom);
			if (pos >= searchFrom) {
				gapPositions.push({
					start: pos,
					end: pos + gap.text.length,
					found: true,
				});
				searchFrom = pos + gap.text.length;
			} else {
				allFound = false;
				break;
			}
		}

		if (!allFound) {
			this.refoldEntireContent(currentText);
			return;
		}

		// 根据 gap 位置推断 placeholder 区域
		interface ContentRegion {
			type: 'gap' | 'placeholder';
			start: number;
			end: number;
		}

		const regions: ContentRegion[] = [];
		let currentPos = 0;

		for (const gp of gapPositions) {
			if (gp.start > currentPos) {
				regions.push({
					type: 'placeholder',
					start: currentPos,
					end: gp.start,
				});
			}
			if (gp.end > gp.start) {
				regions.push({type: 'gap', start: gp.start, end: gp.end});
			}
			currentPos = gp.end;
		}

		if (currentPos < currentText.length) {
			regions.push({
				type: 'placeholder',
				start: currentPos,
				end: currentText.length,
			});
		}

		// 用区域信息重建带占位符的 content
		let newContent = '';
		let newCursor = 0;
		let cursorMapped = false;

		for (const region of regions) {
			const regionText = currentText.substring(region.start, region.end);

			if (region.type === 'gap') {
				if (
					!cursorMapped &&
					oldCursor >= region.start &&
					oldCursor <= region.end
				) {
					newCursor =
						cpLen(newContent) + (oldCursor - region.start);
					cursorMapped = true;
				}
				newContent += regionText;
			} else if (regionText.length > 0) {
				const lineCount =
					(regionText.match(/\n/g) || []).length + 1;
				const shouldFold =
					regionText.length >= 400 || lineCount >= 12;

				if (shouldFold) {
					this.textPlaceholderCounter++;
					const pasteId = `paste_refold_${Date.now()}_${this.textPlaceholderCounter}`;
					const placeholderText = `[Paste ${lineCount} lines #${this.textPlaceholderCounter}] `;

					this.placeholderStorage.set(pasteId, {
						id: pasteId,
						type: 'text',
						content: regionText,
						charCount: regionText.length,
						index: this.textPlaceholderCounter,
						placeholder: placeholderText,
					});

					if (
						!cursorMapped &&
						oldCursor >= region.start &&
						oldCursor <= region.end
					) {
						newCursor =
							cpLen(newContent) + cpLen(placeholderText);
						cursorMapped = true;
					}
					newContent += placeholderText;
				} else {
					if (
						!cursorMapped &&
						oldCursor >= region.start &&
						oldCursor <= region.end
					) {
						newCursor =
							cpLen(newContent) +
							(oldCursor - region.start);
						cursorMapped = true;
					}
					newContent += regionText;
				}
			}
		}

		if (!cursorMapped) {
			newCursor = cpLen(newContent);
		}

		this.content = newContent;
		this.cursorIndex = newCursor;
	}

	/**
	 * 内容未修改时精确还原所有占位符（保留原始格式如 [Skill:id]）。
	 */
	private restoreExactFromSegments(
		segments: Array<{
			type: 'gap' | 'placeholder';
			text: string;
			originalPlaceholder?: string;
		}>,
		oldCursor: number,
	): void {
		let newContent = '';
		let newCursor = 0;
		let expandedPos = 0;
		let cursorMapped = false;

		for (const seg of segments) {
			if (seg.type === 'gap') {
				if (
					!cursorMapped &&
					oldCursor >= expandedPos &&
					oldCursor <= expandedPos + seg.text.length
				) {
					newCursor =
						cpLen(newContent) + (oldCursor - expandedPos);
					cursorMapped = true;
				}
				newContent += seg.text;
				expandedPos += seg.text.length;
			} else {
				const lineCount =
					(seg.text.match(/\n/g) || []).length + 1;
				const shouldFold =
					seg.text.length >= 400 || lineCount >= 12;

				if (shouldFold) {
					this.textPlaceholderCounter++;
					const pasteId = `paste_restore_${Date.now()}_${this.textPlaceholderCounter}`;
					const placeholderText =
						seg.originalPlaceholder ||
						`[Paste ${lineCount} lines #${this.textPlaceholderCounter}] `;

					this.placeholderStorage.set(pasteId, {
						id: pasteId,
						type: 'text',
						content: seg.text,
						charCount: seg.text.length,
						index: this.textPlaceholderCounter,
						placeholder: placeholderText,
					});

					if (
						!cursorMapped &&
						oldCursor >= expandedPos &&
						oldCursor <= expandedPos + seg.text.length
					) {
						newCursor =
							cpLen(newContent) + cpLen(placeholderText);
						cursorMapped = true;
					}
					newContent += placeholderText;
				} else {
					if (
						!cursorMapped &&
						oldCursor >= expandedPos &&
						oldCursor <= expandedPos + seg.text.length
					) {
						newCursor =
							cpLen(newContent) +
							(oldCursor - expandedPos);
						cursorMapped = true;
					}
					newContent += seg.text;
				}
				expandedPos += seg.text.length;
			}
		}

		if (!cursorMapped) {
			newCursor = cpLen(newContent);
		}

		this.content = newContent;
		this.cursorIndex = newCursor;
	}

	/**
	 * 回退方案：当 gap 匹配失败时，将整个文本包装为一个占位符。
	 */
	private refoldEntireContent(text: string): void {
		if (text.length === 0) return;

		const lineCount = (text.match(/\n/g) || []).length + 1;
		const shouldFold = text.length >= 400 || lineCount >= 12;

		if (!shouldFold) return;

		this.textPlaceholderCounter++;
		const pasteId = `paste_refold_${Date.now()}_${this.textPlaceholderCounter}`;
		const placeholderText = `[Paste ${lineCount} lines #${this.textPlaceholderCounter}] `;

		this.placeholderStorage.set(pasteId, {
			id: pasteId,
			type: 'text',
			content: text,
			charCount: text.length,
			index: this.textPlaceholderCounter,
			placeholder: placeholderText,
		});

		this.content = placeholderText;
		this.cursorIndex = cpLen(placeholderText);
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

	private getTextPlaceholderCpPositions(): Array<{
		cpStart: number;
		phCpLen: number;
		contentCpLen: number;
	}> {
		const positions: Array<{
			cpStart: number;
			phCpLen: number;
			contentCpLen: number;
		}> = [];
		for (const ph of this.placeholderStorage.values()) {
			if (ph.type !== 'text' || !ph.placeholder) continue;
			const strIdx = this.content.indexOf(ph.placeholder);
			if (strIdx === -1) continue;
			positions.push({
				cpStart: cpLen(this.content.substring(0, strIdx)),
				phCpLen: cpLen(ph.placeholder),
				contentCpLen: cpLen(ph.content),
			});
		}
		positions.sort((a, b) => a.cpStart - b.cpStart);
		return positions;
	}

	private mapCursorToExpandedIndex(contentCursorIdx: number): number {
		const phPositions = this.getTextPlaceholderCpPositions();
		let offset = 0;
		for (const ph of phPositions) {
			if (contentCursorIdx <= ph.cpStart) break;
			if (contentCursorIdx < ph.cpStart + ph.phCpLen) {
				const posInPh = contentCursorIdx - ph.cpStart;
				return ph.cpStart + offset + Math.min(posInPh, ph.contentCpLen);
			}
			offset += ph.contentCpLen - ph.phCpLen;
		}
		return contentCursorIdx + offset;
	}

	private mapExpandedIndexToContent(expandedCursorIdx: number): number {
		const phPositions = this.getTextPlaceholderCpPositions();
		let cumulativeOffset = 0;
		for (const ph of phPositions) {
			const expandedPhStart = ph.cpStart + cumulativeOffset;
			const expandedPhEnd = expandedPhStart + ph.contentCpLen;
			if (expandedCursorIdx < expandedPhStart) {
				return expandedCursorIdx - cumulativeOffset;
			}
			if (expandedCursorIdx < expandedPhEnd) {
				return ph.cpStart + ph.phCpLen;
			}
			cumulativeOffset += ph.contentCpLen - ph.phCpLen;
		}
		return expandedCursorIdx - cumulativeOffset;
	}

	private recalculateVisualState(): void {
		this.clampCursorIndex();

		this._displayText = this._expandedView
			? this.getFullText()
			: this.content;

		const width = this.viewport.width;
		const effectiveWidth =
			Number.isFinite(width) && width > 0 ? width : Number.POSITIVE_INFINITY;
		const rawLines = this._displayText.split('\n');
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
		const displayCursorIdx = this._expandedView
			? this.mapCursorToExpandedIndex(this.cursorIndex)
			: this.cursorIndex;
		this.visualCursorPos =
			this.computeVisualCursorFromIndex(displayCursorIdx);
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
						placeholderText === '[Pasting...]' ||
						placeholderText === '[Pasting...] ' ||
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

		const totalLength = cpLen(this._displayText);
		const clamped = Math.max(0, Math.min(position, totalLength));

		for (let i = this.visualLines.length - 1; i >= 0; i--) {
			const start = this.visualLineStarts[i] ?? 0;
			const nextStart = this.visualLineStarts[i + 1];
			const lineEnd =
				typeof nextStart === 'number' ? nextStart - 1 : totalLength;
			if (clamped >= start && clamped <= lineEnd) {
				const line = this.visualLines[i] ?? '';
				const lineOffset = Math.max(0, clamped - start);
				const withinLine = cpSlice(
					this._displayText,
					start,
					start + lineOffset,
				);
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

		const rawPosition = start + codePointOffset;
		this.cursorIndex = this._expandedView
			? this.mapExpandedIndexToContent(rawPosition)
			: rawPosition;
		this.visualCursorPos = [row, visualColumn];
	}

	private recomputeVisualCursorOnly(): void {
		const displayIdx = this._expandedView
			? this.mapCursorToExpandedIndex(this.cursorIndex)
			: this.cursorIndex;
		this.visualCursorPos = this.computeVisualCursorFromIndex(displayIdx);
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
