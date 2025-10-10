import { cpLen, cpSlice, visualWidth, toCodePoints } from './textUtils.js';

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Strip characters that can break terminal rendering.
 */
function sanitizeInput(str: string): string {
  // Replace problematic characters but preserve basic formatting
  return str
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\r/g, '\n') // Convert remaining \r to \n
    .replace(/\t/g, '  ') // Convert tabs to spaces
    // Remove control characters except newlines
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

export interface PastePlaceholder {
  id: string;
  content: string; // 原始粘贴内容
  charCount: number; // 字符数
  index: number; // 第几次粘贴
  placeholder: string; // 显示的占位符文本
}

export interface ImageData {
  id: string;
  data: string; // Base64 编码的图片数据
  mimeType: string; // 图片 MIME 类型 (e.g., image/png, image/jpeg)
  index: number; // 第几张图片
  placeholder: string; // 显示的占位符文本 [image #xxx]
}

export class TextBuffer {
  private content = '';
  private cursorIndex = 0;
  private viewport: Viewport;
  private pasteStorage: Map<string, PastePlaceholder> = new Map();
  private pasteCounter = 0;
  private imageStorage: Map<string, ImageData> = new Map();
  private imageCounter = 0;
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
    this.pasteStorage.clear();
    this.imageStorage.clear();
    this.onUpdateCallback = undefined;
  }

  get text(): string {
    return this.content;
  }

  /**
   * 获取完整文本，包括替换占位符为原始内容
   */
  getFullText(): string {
    let fullText = this.content;

    for (const placeholder of this.pasteStorage.values()) {
      if (placeholder.placeholder) {
        fullText = fullText.split(placeholder.placeholder).join(placeholder.content);
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
      this.pasteStorage.clear();
      this.pasteCounter = 0;
      this.imageStorage.clear();
      this.imageCounter = 0;
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

      // 如果是第一批数据，记录插入位置
      const isFirstBatch = !this.pasteAccumulator;
      if (isFirstBatch) {
        this.pastePlaceholderPosition = this.cursorIndex;
      }

      // 累积数据
      this.pasteAccumulator += sanitized;

      // 移除旧的临时占位符（如果存在）
      if (!isFirstBatch) {
        const tempPlaceholderPattern = /\[Pasting\.\.\. \d+ chars\]/;
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

    // 移除临时占位符（如果存在）
    // 临时占位符格式: [Pasting... XXX chars]
    const tempPlaceholderPattern = /\[Pasting\.\.\. \d+ chars\]/;
    this.content = this.content.replace(tempPlaceholderPattern, '');

    // 只有当累积的字符数超过300时才创建占位符
    if (totalChars > 300) {
      this.pasteCounter++;
      const pasteId = `paste_${Date.now()}_${this.pasteCounter}`;
      const placeholderText = `[Paste ${totalChars} characters #${this.pasteCounter}]`;

      this.pasteStorage.set(pasteId, {
        id: pasteId,
        content: this.pasteAccumulator,
        charCount: totalChars,
        index: this.pasteCounter,
        placeholder: placeholderText
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
      this.cursorIndex = this.pastePlaceholderPosition + cpLen(this.pasteAccumulator);
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
    this.viewport = viewport;
    this.recalculateVisualState();
    this.scheduleUpdate();
  }

  /**
   * Get the character and its visual info at cursor position for proper rendering.
   */
  getCharAtCursor(): { char: string; isWideChar: boolean } {
    const codePoints = toCodePoints(this.content);

    if (this.cursorIndex >= codePoints.length) {
      return { char: ' ', isWideChar: false };
    }

    const char = codePoints[this.cursorIndex] || ' ';
    return { char, isWideChar: visualWidth(char) > 1 };
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
    const effectiveWidth = Number.isFinite(width) && width > 0 ? width : Number.POSITIVE_INFINITY;
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
   * 插入图片数据
   */
  insertImage(base64Data: string, mimeType: string): void {
    this.imageCounter++;
    const imageId = `image_${Date.now()}_${this.imageCounter}`;
    const placeholderText = `[image #${this.imageCounter}]`;

    this.imageStorage.set(imageId, {
      id: imageId,
      data: base64Data,
      mimeType: mimeType,
      index: this.imageCounter,
      placeholder: placeholderText
    });

    this.insertPlainText(placeholderText);
    this.scheduleUpdate();
  }

  /**
   * 获取所有图片数据
   */
  getImages(): ImageData[] {
    return Array.from(this.imageStorage.values()).sort((a, b) => a.index - b.index);
  }

  /**
   * 清除所有图片
   */
  clearImages(): void {
    this.imageStorage.clear();
    this.imageCounter = 0;
  }
}
