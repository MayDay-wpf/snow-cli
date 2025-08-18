import stringWidth from 'string-width';

/**
 * Convert a string to an array of code points (Unicode characters).
 * Handles surrogate pairs correctly.
 */
export function toCodePoints(str: string): string[] {
  return Array.from(str);
}

/**
 * Get the length of a string in code points (not bytes).
 */
export function cpLen(str: string): number {
  return toCodePoints(str).length;
}

/**
 * Slice a string by code point indices (not byte indices).
 */
export function cpSlice(str: string, start: number, end?: number): string {
  const codePoints = toCodePoints(str);
  return codePoints.slice(start, end).join('');
}

/**
 * Get the visual width of a string (how many columns it occupies in terminal).
 * Handles wide characters like Chinese, emojis, etc.
 */
export function visualWidth(str: string): number {
  return stringWidth(str);
}

/**
 * Get character at visual position (accounting for wide characters).
 */
export function getCharAtVisualPos(str: string, visualPos: number): { char: string; codePointIndex: number } | null {
  const codePoints = toCodePoints(str);
  let currentVisualPos = 0;
  
  for (let i = 0; i < codePoints.length; i++) {
    const char = codePoints[i] || '';
    const charWidth = visualWidth(char);
    
    if (currentVisualPos === visualPos) {
      return { char, codePointIndex: i };
    }
    
    if (currentVisualPos + charWidth > visualPos) {
      // We're in the middle of a wide character
      return { char, codePointIndex: i };
    }
    
    currentVisualPos += charWidth;
  }
  
  // Position is at the end of the string
  if (currentVisualPos === visualPos) {
    return { char: '', codePointIndex: codePoints.length };
  }
  
  return null;
}

/**
 * Convert code point index to visual position.
 */
export function codePointToVisualPos(str: string, codePointIndex: number): number {
  const codePoints = toCodePoints(str);
  let visualPos = 0;
  
  for (let i = 0; i < Math.min(codePointIndex, codePoints.length); i++) {
    const char = codePoints[i] || '';
    visualPos += visualWidth(char);
  }
  
  return visualPos;
}

/**
 * Convert visual position to code point index.
 */
export function visualPosToCodePoint(str: string, visualPos: number): number {
  const codePoints = toCodePoints(str);
  let currentVisualPos = 0;
  
  for (let i = 0; i < codePoints.length; i++) {
    const char = codePoints[i] || '';
    const charWidth = visualWidth(char);
    
    if (currentVisualPos + charWidth > visualPos) {
      return i;
    }
    
    currentVisualPos += charWidth;
    
    if (currentVisualPos >= visualPos) {
      return i + 1;
    }
  }
  
  return codePoints.length;
}