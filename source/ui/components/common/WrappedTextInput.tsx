import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {toCodePoints, visualWidth} from '../../../utils/core/textUtils.js';
import {
	isFocusEventInput,
	stripFocusArtifacts,
} from '../../pages/configScreen/types.js';

type WrappedLine = {
	/** 本行第一个字符在整个文本中的码点偏移 */
	start: number;
	chars: string[];
};

/**
 * 按显示宽度对文本做字符级折行（不按单词折行），保证光标偏移与显示位置一一对应。
 * 末行恰好占满时追加一个空行，用于承载行尾光标。
 */
export function wrapTextForInput(value: string, width: number): WrappedLine[] {
	const chars = toCodePoints(value);
	const lines: WrappedLine[] = [];
	let current: string[] = [];
	let currentWidth = 0;
	let start = 0;

	chars.forEach((char, index) => {
		const charWidth = Math.max(1, visualWidth(char));
		if (currentWidth + charWidth > width && current.length > 0) {
			lines.push({start, chars: current});
			current = [];
			currentWidth = 0;
			start = index;
		}
		current.push(char);
		currentWidth += charWidth;
	});
	lines.push({start, chars: current});

	// 光标需要一个位置显示在行尾：末行已占满时另起一行
	const last = lines[lines.length - 1]!;
	const lastWidth = last.chars.reduce(
		(sum, char) => sum + Math.max(1, visualWidth(char)),
		0,
	);
	if (last.chars.length > 0 && lastWidth >= width) {
		lines.push({start: chars.length, chars: []});
	}

	return lines;
}

/** 编辑框实际渲染的行数（含上下边框），供父组件计算布局高度 */
export function getWrappedInputHeight(
	value: string,
	width: number,
	maxVisibleLines: number,
): number {
	const innerWidth = Math.max(4, width - 4);
	return Math.min(wrapTextForInput(value, innerWidth).length, maxVisibleLines) + 2;
}

function findCursorLine(lines: WrappedLine[], cursor: number): number {
	for (let index = lines.length - 1; index >= 0; index--) {
		if (lines[index]!.start <= cursor) {
			return index;
		}
	}
	return 0;
}

/** 行内显示列（宽字符按显示宽度计）转回码点偏移 */
function columnToOffset(line: WrappedLine, column: number): number {
	let width = 0;
	for (let index = 0; index < line.chars.length; index++) {
		const charWidth = Math.max(1, visualWidth(line.chars[index]!));
		if (width + charWidth > column) {
			return line.start + index;
		}
		width += charWidth;
	}
	return line.start + line.chars.length;
}

function offsetToColumn(line: WrappedLine, cursor: number): number {
	let width = 0;
	for (let index = 0; index < cursor - line.start; index++) {
		width += Math.max(1, visualWidth(line.chars[index] ?? ''));
	}
	return width;
}

type Props = {
	value: string;
	onChange: (value: string) => void;
	onSubmit: () => void;
	onCancel: () => void;
	/** 编辑框总宽度（含边框与内边距） */
	width: number;
	/** 最多显示的文本行数，超出时随光标滚动 */
	maxVisibleLines?: number;
	placeholder?: string;
	borderColor?: string;
	placeholderColor?: string;
};

/**
 * 带边框的多行文本输入框：长文本自动折行，支持光标自由移动。
 *
 * 按键：←→ 移动 · ↑↓ 跨行移动 · Home/End 或 Ctrl+A/Ctrl+E 行首行尾 ·
 * Backspace 删除光标前字符 · Delete/Ctrl+D 删除光标后字符 · Ctrl+U 清空 ·
 * Enter 提交 · Esc 取消。粘贴内容中的换行会被替换为逗号。
 */
export default function WrappedTextInput({
	value,
	onChange,
	onSubmit,
	onCancel,
	width,
	maxVisibleLines = 8,
	placeholder = '',
	borderColor,
	placeholderColor,
}: Props) {
	// 进入编辑时光标默认停在末尾，便于直接追加
	const [cursor, setCursor] = useState(() => toCodePoints(value).length);

	const innerWidth = Math.max(4, width - 4);
	const chars = toCodePoints(value);
	const safeCursor = Math.min(cursor, chars.length);
	const lines = wrapTextForInput(value, innerWidth);
	const cursorLine = findCursorLine(lines, safeCursor);

	const replaceRange = (from: number, to: number, insert: string) => {
		const nextChars = [
			...chars.slice(0, from),
			...toCodePoints(insert),
			...chars.slice(to),
		];
		onChange(nextChars.join(''));
		setCursor(from + toCodePoints(insert).length);
	};

	useInput((rawInput, key) => {
		if (key.escape) {
			onCancel();
			return;
		}
		if (key.return) {
			onSubmit();
			return;
		}
		if (key.leftArrow) {
			setCursor(Math.max(0, safeCursor - 1));
			return;
		}
		if (key.rightArrow) {
			setCursor(Math.min(chars.length, safeCursor + 1));
			return;
		}
		if (key.upArrow || key.downArrow) {
			const targetLine = cursorLine + (key.upArrow ? -1 : 1);
			if (targetLine < 0) {
				setCursor(0);
			} else if (targetLine >= lines.length) {
				setCursor(chars.length);
			} else {
				const column = offsetToColumn(lines[cursorLine]!, safeCursor);
				const target = lines[targetLine]!;
				// 非末行的行尾偏移等于下一行行首，会被判定到下一行，这里回退一个字符
				const lineEnd =
					targetLine < lines.length - 1
						? target.start + Math.max(0, target.chars.length - 1)
						: target.start + target.chars.length;
				setCursor(Math.min(columnToOffset(target, column), lineEnd));
			}
			return;
		}
		if (key.home || (key.ctrl && rawInput === 'a')) {
			setCursor(lines[cursorLine]!.start);
			return;
		}
		if (key.end || (key.ctrl && rawInput === 'e')) {
			const line = lines[cursorLine]!;
			const end = line.start + line.chars.length;
			setCursor(
				cursorLine < lines.length - 1 && line.chars.length > 0 ? end - 1 : end,
			);
			return;
		}
		if (key.ctrl && rawInput === 'u') {
			onChange('');
			setCursor(0);
			return;
		}
		if (key.backspace) {
			if (safeCursor > 0) {
				replaceRange(safeCursor - 1, safeCursor, '');
			}
			return;
		}
		if (key.delete || (key.ctrl && rawInput === 'd')) {
			if (safeCursor < chars.length) {
				replaceRange(safeCursor, safeCursor + 1, '');
			}
			return;
		}
		if (key.ctrl || key.meta || key.tab) {
			return;
		}
		if (isFocusEventInput(rawInput)) {
			return;
		}

		const input = stripFocusArtifacts(rawInput)
			.replace(/\r\n|\r|\n/g, ',')
			.replace(/[\u0000-\u001f\u007f]/g, '');
		if (input) {
			replaceRange(safeCursor, safeCursor, input);
		}
	});

	// 行数超出上限时，以光标所在行为中心开窗
	let windowStart = 0;
	if (lines.length > maxVisibleLines) {
		windowStart = Math.min(
			Math.max(0, cursorLine - Math.floor(maxVisibleLines / 2)),
			lines.length - maxVisibleLines,
		);
	}
	const visibleLines = lines.slice(windowStart, windowStart + maxVisibleLines);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={borderColor}
			paddingX={1}
			width={width}
		>
			{value.length === 0 ? (
				<Text>
					<Text inverse> </Text>
					<Text color={placeholderColor} dimColor>
						{toCodePoints(placeholder)
							.slice(0, Math.max(0, innerWidth - 1))
							.join('')}
					</Text>
				</Text>
			) : (
				visibleLines.map((line, index) => {
					const lineIndex = windowStart + index;
					if (lineIndex !== cursorLine) {
						return <Text key={lineIndex}>{line.chars.join('') || ' '}</Text>;
					}
					const position = safeCursor - line.start;
					const before = line.chars.slice(0, position).join('');
					const atCursor = line.chars[position] ?? ' ';
					const after = line.chars.slice(position + 1).join('');
					return (
						<Text key={lineIndex}>
							{before}
							<Text inverse>{atCursor}</Text>
							{after}
						</Text>
					);
				})
			)}
		</Box>
	);
}
