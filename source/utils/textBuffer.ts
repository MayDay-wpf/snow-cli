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
  lineCount: number;
  index: number; // 第几次粘贴
  placeholder: string; // 显示的占位符文本
}

export class TextBuffer {
  private lines: string[] = [''];
  private cursorRow: number = 0;
  private cursorCol: number = 0;
  private viewport: Viewport; // Still needed for width-based text wrapping
  private pendingUpdates: boolean = false;
  private pasteStorage: Map<string, PastePlaceholder> = new Map(); // 存储大粘贴内容
  private pasteCounter: number = 0; // 粘贴计数器

  constructor(viewport: Viewport) {
    this.viewport = viewport;
  }

  get text(): string {
    return this.lines.join('\n');
  }

  /**
   * 获取完整文本，包括替换占位符为原始内容
   */
  getFullText(): string {
    let fullText = this.text;
    
    // 替换所有占位符为原始内容
    for (const [, placeholder] of this.pasteStorage) {
      fullText = fullText.replace(placeholder.placeholder, placeholder.content);
    }
    
    return fullText;
  }

  get visualCursor(): [number, number] {
    return [this.cursorRow, this.cursorCol];
  }

  get viewportVisualLines(): string[] {
    // Return all lines instead of limiting by viewport height
    // Viewport height should only be used for initial sizing, not content limiting
    return this.lines;
  }

  get maxWidth(): number {
    // Viewport width is still useful for text wrapping/formatting
    return this.viewport.width;
  }

  private getCurrentLine(): string {
    return this.lines[this.cursorRow] || '';
  }

  private scheduleUpdate(): void {
    if (this.pendingUpdates) return;
    this.pendingUpdates = true;
    
    // Defer updates to next tick to handle rapid input
    process.nextTick(() => {
      this.pendingUpdates = false;
    });
  }

  setText(text: string): void {
    const sanitized = sanitizeInput(text);
    this.lines = sanitized.split('\n');
    if (this.lines.length === 0) {
      this.lines = [''];
    }
    this.cursorRow = Math.min(this.cursorRow, this.lines.length - 1);
    this.cursorCol = Math.min(this.cursorCol, cpLen(this.getCurrentLine()));
    
    // 清空时重置粘贴存储和计数器
    if (text === '') {
      this.pasteStorage.clear();
      this.pasteCounter = 0;
    }
    
    this.scheduleUpdate();
  }

  insert(input: string): void {
    const sanitized = sanitizeInput(input);
    const lines = sanitized.split('\n');
    
    // 检查是否为大量粘贴（超过10行）
    if (lines.length > 10) {
      this.pasteCounter++;
      const pasteId = `paste_${Date.now()}_${this.pasteCounter}`;
      const placeholder = `[Paste ${lines.length} line #${this.pasteCounter}]`;
      
      // 存储原始内容
      this.pasteStorage.set(pasteId, {
        id: pasteId,
        content: sanitized,
        lineCount: lines.length,
        index: this.pasteCounter,
        placeholder: placeholder
      });
      
      // 插入占位符
      const currentLine = this.getCurrentLine();
      const before = cpSlice(currentLine, 0, this.cursorCol);
      const after = cpSlice(currentLine, this.cursorCol);
      this.lines[this.cursorRow] = before + placeholder + after;
      this.cursorCol += cpLen(placeholder);
      
      this.scheduleUpdate();
      return;
    }
    
    if (lines.length === 1) {
      // Single line input - check for wrapping
      const currentLine = this.getCurrentLine();
      const before = cpSlice(currentLine, 0, this.cursorCol);
      const after = cpSlice(currentLine, this.cursorCol);
      const newLine = before + sanitized + after;
      
      // 简化换行逻辑，只在超过最大宽度时换行
      if (visualWidth(newLine) > this.viewport.width && this.viewport.width > 20) {
        // 尝试在合适位置换行
        const breakPoint = this.findBreakPoint(newLine, this.viewport.width);
        if (breakPoint > 0 && breakPoint < newLine.length) {
          const firstPart = cpSlice(newLine, 0, breakPoint);
          const secondPart = cpSlice(newLine, breakPoint);
          this.lines[this.cursorRow] = firstPart;
          this.lines.splice(this.cursorRow + 1, 0, secondPart);
          this.cursorRow++;
          this.cursorCol = cpLen(secondPart);
        } else {
          // 无法找到合适换行点，直接设置
          this.lines[this.cursorRow] = newLine;
          this.cursorCol += cpLen(sanitized);
        }
      } else {
        this.lines[this.cursorRow] = newLine;
        this.cursorCol += cpLen(sanitized);
      }
    } else {
      // Multi-line input (paste) - 正常处理小于等于10行的粘贴
      const currentLine = this.getCurrentLine();
      const before = cpSlice(currentLine, 0, this.cursorCol);
      const after = cpSlice(currentLine, this.cursorCol);
      
      // First line: current line prefix + first paste line
      this.lines[this.cursorRow] = before + lines[0];
      
      // Middle lines: insert as new lines
      const middleLines = lines.slice(1, -1);
      this.lines.splice(this.cursorRow + 1, 0, ...middleLines);
      
      // Last line: last paste line + current line suffix
      const lastLine = lines[lines.length - 1] + after;
      this.lines.splice(this.cursorRow + lines.length - 1, 0, lastLine);
      
      // Update cursor position
      this.cursorRow += lines.length - 1;
      this.cursorCol = cpLen(lines[lines.length - 1] || '');
    }
    
    this.scheduleUpdate();
  }

  private findBreakPoint(line: string, maxWidth: number): number {
    const codePoints = toCodePoints(line);
    let currentWidth = 0;
    let lastSpaceIndex = -1;
    
    for (let i = 0; i < codePoints.length; i++) {
      const char = codePoints[i] || '';
      const charWidth = visualWidth(char);
      
      if (char === ' ') {
        lastSpaceIndex = i;
      }
      
      if (currentWidth + charWidth > maxWidth) {
        return lastSpaceIndex > 0 ? lastSpaceIndex : Math.max(1, i);
      }
      
      currentWidth += charWidth;
    }
    
    return codePoints.length;
  }

  backspace(): void {
    if (this.cursorCol > 0) {
      const currentLine = this.getCurrentLine();
      const before = cpSlice(currentLine, 0, this.cursorCol - 1);
      const after = cpSlice(currentLine, this.cursorCol);
      this.lines[this.cursorRow] = before + after;
      this.cursorCol--;
    } else if (this.cursorRow > 0) {
      const currentLine = this.getCurrentLine();
      const prevLine = this.lines[this.cursorRow - 1] || '';
      this.cursorCol = cpLen(prevLine);
      this.lines[this.cursorRow - 1] = prevLine + currentLine;
      this.lines.splice(this.cursorRow, 1);
      this.cursorRow--;
    }
    this.scheduleUpdate();
  }

  delete(): void {
    const currentLine = this.getCurrentLine();
    if (this.cursorCol < cpLen(currentLine)) {
      const before = cpSlice(currentLine, 0, this.cursorCol);
      const after = cpSlice(currentLine, this.cursorCol + 1);
      this.lines[this.cursorRow] = before + after;
    } else if (this.cursorRow < this.lines.length - 1) {
      const nextLine = this.lines[this.cursorRow + 1] || '';
      this.lines[this.cursorRow] = currentLine + nextLine;
      this.lines.splice(this.cursorRow + 1, 1);
    }
    this.scheduleUpdate();
  }

  moveLeft(): void {
    if (this.cursorCol > 0) {
      this.cursorCol--;
    } else if (this.cursorRow > 0) {
      this.cursorRow--;
      this.cursorCol = cpLen(this.getCurrentLine());
    }
  }

  moveRight(): void {
    const currentLine = this.getCurrentLine();
    if (this.cursorCol < cpLen(currentLine)) {
      this.cursorCol++;
    } else if (this.cursorRow < this.lines.length - 1) {
      this.cursorRow++;
      this.cursorCol = 0;
    }
  }

  moveUp(): void {
    if (this.cursorRow > 0) {
      this.cursorRow--;
      const newLineLength = cpLen(this.getCurrentLine());
      this.cursorCol = Math.min(this.cursorCol, newLineLength);
    }
  }

  moveDown(): void {
    if (this.cursorRow < this.lines.length - 1) {
      this.cursorRow++;
      const newLineLength = cpLen(this.getCurrentLine());
      this.cursorCol = Math.min(this.cursorCol, newLineLength);
    }
  }

  /**
   * Get the character and its visual info at cursor position for proper rendering.
   */
  getCharAtCursor(): { char: string; isWideChar: boolean } {
    const currentLine = this.getCurrentLine();
    const codePoints = toCodePoints(currentLine);
    
    if (this.cursorCol >= codePoints.length) {
      return { char: ' ', isWideChar: false };
    }
    
    const char = codePoints[this.cursorCol] || ' ';
    const isWideChar = visualWidth(char) > 1;
    
    return { char, isWideChar };
  }
}