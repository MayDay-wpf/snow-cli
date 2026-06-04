import React, {useMemo} from 'react';
import {Box, Text} from 'ink';
import chalk from 'chalk';
import stringWidth from 'string-width';
import sliceAnsi from 'slice-ansi';
import {highlight, supportsLanguage} from 'cli-highlight';
import * as Diff from 'diff';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';

interface Props {
	oldContent?: string;
	newContent: string;
	filename?: string;
	completeOldContent?: string;
	completeNewContent?: string;
	startLineNumber?: number;
}

interface DiffHunk {
	startLine: number;
	endLine: number;
	changes: Array<{
		type: 'added' | 'removed' | 'unchanged';
		content: string;
		oldLineNum: number | null;
		newLineNum: number | null;
	}>;
}

function expandTabsForDisplay(line: string, tabWidth = 2): string {
	if (!line.includes('\t')) {
		return line;
	}
	let col = 0;
	let out = '';
	for (const ch of line) {
		if (ch === '\t') {
			const spaces = tabWidth - (col % tabWidth);
			out += ' '.repeat(spaces);
			col += spaces;
		} else {
			out += ch;
			col = ch === '\n' || ch === '\r' ? 0 : col + 1;
		}
	}
	return out;
}

function stripLineNumbers(content: string): string {
	const hashlineRe = /^\s*\d+:[0-9a-fA-F]{2}→(.*)$/;
	const lineNumArrowRe = /^\s*\d+→(.*)$/;
	return content
		.split('\n')
		.map(line => {
			let stripped = line.replace(/\r$/, '');
			let match: RegExpMatchArray | null;
			for (;;) {
				if ((match = hashlineRe.exec(stripped))) {
					stripped = match[1]!;
					continue;
				}
				if ((match = lineNumArrowRe.exec(stripped))) {
					stripped = match[1]!;
					continue;
				}
				break;
			}
			return stripped;
		})
		.join('\n');
}

const MIN_SIDE_BY_SIDE_WIDTH = 120;

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	ts: 'typescript',
	tsx: 'typescript',
	json: 'json',
	md: 'markdown',
	yml: 'yaml',
	yaml: 'yaml',
	sh: 'bash',
	zsh: 'bash',
	bash: 'bash',
	py: 'python',
	rb: 'ruby',
	rs: 'rust',
	go: 'go',
	java: 'java',
	kt: 'kotlin',
	swift: 'swift',
	html: 'html',
	xml: 'xml',
	css: 'css',
	scss: 'scss',
	less: 'less',
	sql: 'sql',
	php: 'php',
};

function inferLanguageFromFilename(filename?: string): string | undefined {
	if (!filename) {
		return undefined;
	}

	const normalizedFilename = filename.split(/[?#]/)[0] ?? filename;
	const extension = normalizedFilename.split('.').pop()?.toLowerCase();

	if (!extension || extension === normalizedFilename.toLowerCase()) {
		return undefined;
	}

	return LANGUAGE_BY_EXTENSION[extension] ?? extension;
}

function highlightCodeContent(content: string, language?: string): string {
	if (!language || content.trim() === '' || !supportsLanguage(language)) {
		return content;
	}

	try {
		return highlight(content, {
			language,
			ignoreIllegals: true,
		});
	} catch {
		return content;
	}
}

function normalizeHexColor(hex: string): string | null {
	if (!hex.startsWith('#')) {
		return null;
	}

	const value = hex.slice(1);

	if (value.length === 3 || value.length === 4) {
		return value
			.slice(0, 3)
			.split('')
			.map(char => char + char)
			.join('');
	}

	if (value.length === 6 || value.length === 8) {
		return value.slice(0, 6);
	}

	return null;
}

function blendHexColors(
	foreground: string,
	background: string,
	alpha: number,
): string {
	const normalizedForeground = normalizeHexColor(foreground);
	const normalizedBackground = normalizeHexColor(background);

	if (!normalizedForeground || !normalizedBackground) {
		return foreground;
	}

	const blendChannel = (foregroundOffset: number, backgroundOffset: number) => {
		const foregroundValue = Number.parseInt(
			normalizedForeground.slice(foregroundOffset, foregroundOffset + 2),
			16,
		);
		const backgroundValue = Number.parseInt(
			normalizedBackground.slice(backgroundOffset, backgroundOffset + 2),
			16,
		);
		const blendedValue = Math.round(
			foregroundValue * alpha + backgroundValue * (1 - alpha),
		);

		return blendedValue.toString(16).padStart(2, '0');
	};

	return `#${blendChannel(0, 0)}${blendChannel(2, 2)}${blendChannel(4, 4)}`;
}

/**
 * Compute diff hunks from old and new content.
 * Pure function — no React dependencies.
 */
function computeHunks(
	diffOldContent: string,
	diffNewContent: string,
	startLineNumber: number,
): DiffHunk[] {
	const diffResult = Diff.diffLines(diffOldContent, diffNewContent);

	interface Change {
		type: 'added' | 'removed' | 'unchanged';
		content: string;
		oldLineNum: number | null;
		newLineNum: number | null;
	}

	const allChanges: Change[] = [];
	let oldLineNum = startLineNumber;
	let newLineNum = startLineNumber;

	diffResult.forEach(part => {
		const normalizedValue = part.value
			.replace(/\r\n/g, '\n')
			.replace(/\r/g, '\n')
			.replace(/\n$/, '');
		const lines = normalizedValue.split('\n');

		lines.forEach(line => {
			const cleanLine = line.replace(/\r/g, '');
			if (part.added) {
				allChanges.push({
					type: 'added',
					content: cleanLine,
					oldLineNum: null,
					newLineNum: newLineNum++,
				});
			} else if (part.removed) {
				allChanges.push({
					type: 'removed',
					content: cleanLine,
					oldLineNum: oldLineNum++,
					newLineNum: null,
				});
			} else {
				allChanges.push({
					type: 'unchanged',
					content: cleanLine,
					oldLineNum: oldLineNum++,
					newLineNum: newLineNum++,
				});
			}
		});
	});

	const computedHunks: DiffHunk[] = [];
	const contextLines = 3;

	for (let i = 0; i < allChanges.length; i++) {
		const change = allChanges[i];
		if (change?.type !== 'unchanged') {
			const hunkStart = Math.max(0, i - contextLines);
			let hunkEnd = i;

			while (hunkEnd < allChanges.length - 1) {
				const nextChange = allChanges[hunkEnd + 1];
				if (!nextChange) break;

				if (nextChange.type !== 'unchanged') {
					hunkEnd++;
					continue;
				}

				let hasMoreChanges = false;
				for (
					let j = hunkEnd + 1;
					j < Math.min(allChanges.length, hunkEnd + 1 + contextLines * 2);
					j++
				) {
					if (allChanges[j]?.type !== 'unchanged') {
						hasMoreChanges = true;
						break;
					}
				}

				if (hasMoreChanges) {
					hunkEnd++;
				} else {
					break;
				}
			}

			hunkEnd = Math.min(allChanges.length - 1, hunkEnd + contextLines);

			const hunkChanges = allChanges.slice(hunkStart, hunkEnd + 1);
			const firstChange = hunkChanges[0];
			const lastChange = hunkChanges[hunkChanges.length - 1];

			if (firstChange && lastChange) {
				computedHunks.push({
					startLine: firstChange.oldLineNum || firstChange.newLineNum || 1,
					endLine: lastChange.oldLineNum || lastChange.newLineNum || 1,
					changes: hunkChanges,
				});
			}

			i = hunkEnd;
		}
	}

	return computedHunks;
}

/**
 * Pre-render the entire diff as a single ANSI string.
 *
 * This avoids creating hundreds of React elements and Yoga WASM nodes
 * (one per diff line), which is the primary source of memory that never
 * gets reclaimed — WASM ArrayBuffer only grows, never shrinks.
 *
 * With this approach the component produces exactly 1 <Text> element
 * regardless of diff size.
 */
export default function DiffViewer({
	oldContent = '',
	newContent,
	filename,
	completeOldContent,
	completeNewContent,
	startLineNumber = 1,
}: Props) {
	const {theme, diffOpacity} = useTheme();
	const {columns: terminalColumns} = useTerminalSize();
	const codeLanguage = inferLanguageFromFilename(filename);

	// DiffViewer is nested inside:
	//   <Box paddingX={1}>           → -2
	//     <Text>{icon}</Text>        → -2 (icon + space)
	//     <Box marginLeft={1}>       → -1
	//       <Box marginTop={1}>      → (no horizontal effect)
	//         <DiffViewer />
	// Total inset ≈ 5, add 1 safety margin = 6
	const columns = Math.max(terminalColumns - 6, 40);

	const diffAddedBg = useMemo(
		() =>
			blendHexColors(
				theme.colors.diffAdded,
				theme.colors.background,
				diffOpacity,
			),
		[diffOpacity, theme.colors.diffAdded, theme.colors.background],
	);
	const diffRemovedBg = useMemo(
		() =>
			blendHexColors(
				theme.colors.diffRemoved,
				theme.colors.background,
				diffOpacity,
			),
		[diffOpacity, theme.colors.diffRemoved, theme.colors.background],
	);

	const useSideBySide = columns >= MIN_SIDE_BY_SIDE_WIDTH;

	const diffOldContent = stripLineNumbers(
		completeOldContent && completeNewContent ? completeOldContent : oldContent,
	);
	const diffNewContent = stripLineNumbers(
		completeOldContent && completeNewContent ? completeNewContent : newContent,
	);

	const renderedOutput = useMemo(() => {
		const hl = (content: string) =>
			highlightCodeContent(expandTabsForDisplay(content), codeLanguage);
		const cleanContent = (c: string) => c.replace(/[\r\n]/g, '');
		const sideRule = chalk.dim('│');
		const dimStyle = (text: string) => chalk.dim(text);
		const subtleAddedStyle = (text: string) => chalk.bgHex(diffAddedBg)(text);
		const subtleRemovedStyle = (text: string) =>
			chalk.bgHex(diffRemovedBg)(text);
		const addedSignStyle = (text: string) => chalk.green.bold(text);
		const removedSignStyle = (text: string) => chalk.red.bold(text);
		const lineNumStyle = (text: string) => chalk.gray.dim(text);
		const lineNumAddedStyle = (text: string) =>
			chalk
				.bgHex(blendHexColors(diffAddedBg, theme.colors.background, 0.55))
				.gray.dim(text);
		const lineNumRemovedStyle = (text: string) =>
			chalk
				.bgHex(blendHexColors(diffRemovedBg, theme.colors.background, 0.55))
				.gray.dim(text);
		const hunkStyle = (text: string) => chalk.cyan.dim(text);

		const style: DiffRenderStyle = {
			sideRule,
			dimStyle,
			subtleAddedStyle,
			subtleRemovedStyle,
			addedSignStyle,
			removedSignStyle,
			lineNumStyle,
			lineNumAddedStyle,
			lineNumRemovedStyle,
			hunkStyle,
		};

		const isNewFile = !diffOldContent || diffOldContent.trim() === '';

		// --- New file ---
		if (isNewFile) {
			const allLines = diffNewContent.split('\n');
			const lineNumWidth = Math.max(4, String(allLines.length).length);
			const headerTitle = filename ?? 'New File';
			const header = `${chalk.dim('╭─')} ${chalk.cyan.bold(
				headerTitle,
			)} ${chalk.green.bold('new file')} ${chalk.green(`+${allLines.length}`)}`;
			const body = allLines
				.flatMap((line, index) => {
					const lineNum = String(index + 1).padStart(lineNumWidth, ' ');
					const contentRows = wrapAnsiToWidth(
						hl(line),
						getUnifiedContentWidth(columns, lineNumWidth),
					);

					return contentRows.map((contentRow, rowIdx) => {
						const lineNumPart =
							rowIdx === 0 ? lineNum : ''.padStart(lineNumWidth, ' ');
						const signPart = rowIdx === 0 ? addedSignStyle('+') : ' ';

						return `${sideRule} ${lineNumAddedStyle(
							lineNumPart + ' ',
						)}${subtleAddedStyle(`${signPart} ${contentRow}`)}`;
					});
				})
				.join('\n');
			const footer = `${chalk.dim('╰─')} ${chalk.gray.dim(
				`${allLines.length} line${allLines.length === 1 ? '' : 's'}`,
			)}`;

			return `${header}\n${body}\n${footer}`;
		}

		// --- Modified file ---
		const hunks = computeHunks(diffOldContent, diffNewContent, startLineNumber);
		const addedCount = hunks.reduce(
			(count, hunk) =>
				count + hunk.changes.filter(change => change.type === 'added').length,
			0,
		);
		const removedCount = hunks.reduce(
			(count, hunk) =>
				count + hunk.changes.filter(change => change.type === 'removed').length,
			0,
		);
		const headerTitle = filename ?? 'File Modified';
		const modeLabel = useSideBySide
			? chalk.dim('side-by-side')
			: chalk.dim('unified');
		const header = `${chalk.dim('╭─')} ${chalk.cyan.bold(
			headerTitle,
		)} ${chalk.yellow.bold('modified')} ${modeLabel} ${chalk.green(
			`+${addedCount}`,
		)} ${chalk.red(`-${removedCount}`)}`;

		const hunkStrings = hunks.map(hunk => {
			const hunkHeader = `${sideRule} ${hunkStyle(
				`@@ ${hunk.startLine}-${hunk.endLine}`,
			)}`;

			if (useSideBySide) {
				return formatSideBySide(
					hunk,
					hunkHeader,
					columns,
					hl,
					style,
					cleanContent,
				);
			}

			return formatUnified(hunk, hunkHeader, columns, hl, style, cleanContent);
		});

		const footer = `${chalk.dim('╰─')} ${chalk.gray.dim(
			`${hunks.length} region${
				hunks.length === 1 ? '' : 's'
			}, +${addedCount} -${removedCount}`,
		)}`;
		const body = hunkStrings.join(`\n${sideRule}\n`);

		return body
			? `${header}\n${sideRule}\n${body}\n${footer}`
			: `${header}\n${footer}`;
	}, [
		diffOldContent,
		diffNewContent,
		startLineNumber,
		filename,
		codeLanguage,
		diffAddedBg,
		diffRemovedBg,
		useSideBySide,
		columns,
	]);

	return (
		<Box flexDirection="column">
			<Text>{renderedOutput}</Text>
		</Box>
	);
}

interface DiffRenderStyle {
	sideRule: string;
	dimStyle: (s: string) => string;
	subtleAddedStyle: (s: string) => string;
	subtleRemovedStyle: (s: string) => string;
	addedSignStyle: (s: string) => string;
	removedSignStyle: (s: string) => string;
	lineNumStyle: (s: string) => string;
	lineNumAddedStyle: (s: string) => string;
	lineNumRemovedStyle: (s: string) => string;
	hunkStyle: (s: string) => string;
}

function fitAnsiToWidth(str: string, width: number): string {
	const measuredWidth = stringWidth(str);
	if (measuredWidth === width) {
		return str;
	}
	if (measuredWidth > width) {
		return sliceAnsi(str, 0, width);
	}
	return str + ' '.repeat(width - measuredWidth);
}

function stripAnsiEscapes(str: string): string {
	return str.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '');
}

function getWordWrapWidth(piece: string): number | null {
	const visiblePiece = stripAnsiEscapes(piece);
	let lastBreakIndex = -1;

	for (let index = 1; index < visiblePiece.length; index++) {
		if (
			/\s/.test(visiblePiece[index] ?? '') &&
			!/^\s+$/.test(visiblePiece.slice(0, index))
		) {
			lastBreakIndex = index;
		}
	}

	if (lastBreakIndex <= 0) {
		return null;
	}

	const breakWidth = stringWidth(visiblePiece.slice(0, lastBreakIndex));
	return breakWidth > 0 ? breakWidth : null;
}

function getLeadingWhitespaceWidth(str: string): number {
	const visibleStr = stripAnsiEscapes(str);
	const leadingWhitespace = visibleStr.match(/^\s+/)?.[0] ?? '';
	return stringWidth(leadingWhitespace);
}

function wrapAnsiToWidth(str: string, width: number): string[] {
	if (width <= 0) {
		return [''];
	}

	const totalWidth = stringWidth(str);
	if (totalWidth === 0) {
		return [' '.repeat(width)];
	}

	const rows: string[] = [];
	let offset = 0;
	while (offset < totalWidth) {
		const remainingWidth = totalWidth - offset;
		const hardSliceWidth = Math.min(width, remainingWidth);
		const hardPiece = sliceAnsi(str, offset, offset + hardSliceWidth);
		const wrapWidth =
			remainingWidth > width ? getWordWrapWidth(hardPiece) : null;
		const sliceWidth = wrapWidth ?? hardSliceWidth;
		const piece = sliceAnsi(str, offset, offset + sliceWidth);
		const pieceWidth = stringWidth(piece);

		rows.push(fitAnsiToWidth(piece, width));
		if (pieceWidth <= 0) {
			break;
		}

		offset += pieceWidth;
		if (wrapWidth !== null) {
			offset += getLeadingWhitespaceWidth(sliceAnsi(str, offset, totalWidth));
		}
	}

	return rows.length > 0 ? rows : [' '.repeat(width)];
}

function getUnifiedContentWidth(columns: number, lineNumWidth: number): number {
	// "│ " + "NNNN " + "S " leaves the wrapped content in its own column.
	const prefixWidth = 2 + lineNumWidth + 1 + 2;
	return Math.max(columns - prefixWidth, 1);
}

function formatUnified(
	hunk: DiffHunk,
	hunkHeader: string,
	columns: number,
	hl: (s: string) => string,
	style: DiffRenderStyle,
	cleanContent: (s: string) => string,
): string {
	const lineNumWidth = Math.max(
		4,
		...hunk.changes.map(
			change => String(change.oldLineNum ?? change.newLineNum ?? '').length,
		),
	);
	const contentWidth = getUnifiedContentWidth(columns, lineNumWidth);
	const lines: string[] = [hunkHeader];

	for (const change of hunk.changes) {
		const lineNum =
			change.type === 'added' ? change.newLineNum : change.oldLineNum;
		const lineNumStr = lineNum
			? String(lineNum).padStart(lineNumWidth, ' ')
			: ''.padStart(lineNumWidth, ' ');
		const contentRows = wrapAnsiToWidth(
			hl(cleanContent(change.content)),
			contentWidth,
		);

		for (let rowIdx = 0; rowIdx < contentRows.length; rowIdx++) {
			const content = contentRows[rowIdx] ?? ' '.repeat(contentWidth);
			const rowLineNumStr =
				rowIdx === 0 ? lineNumStr : ''.padStart(lineNumWidth, ' ');

			if (change.type === 'added') {
				const sign = rowIdx === 0 ? style.addedSignStyle('+') : ' ';
				lines.push(
					`${style.sideRule} ${style.lineNumAddedStyle(
						rowLineNumStr + ' ',
					)}${style.subtleAddedStyle(`${sign} ${content}`)}`,
				);
			} else if (change.type === 'removed') {
				const sign = rowIdx === 0 ? style.removedSignStyle('-') : ' ';
				lines.push(
					`${style.sideRule} ${style.lineNumRemovedStyle(
						rowLineNumStr + ' ',
					)}${style.subtleRemovedStyle(`${sign} ${content}`)}`,
				);
			} else {
				const basePrefix = `${style.sideRule} ${style.lineNumStyle(
					rowLineNumStr,
				)} `;
				lines.push(`${basePrefix}${style.dimStyle('  ')}${content}`);
			}
		}
	}

	return lines.join('\n');
}

function formatSideBySide(
	hunk: DiffHunk,
	hunkHeader: string,
	columns: number,
	hl: (s: string) => string,
	style: DiffRenderStyle,
	cleanContent: (s: string) => string,
): string {
	const gutterWidth = 2;
	const separatorWidth = 3;
	const lineNumWidth = 4;
	const availableWidth = Math.max(columns - gutterWidth, 40);
	const panelWidth = Math.floor((availableWidth - separatorWidth) / 2);
	const separator = chalk.dim(' │ ');

	interface SideBySideLine {
		left: {
			lineNum: number | null;
			type: 'removed' | 'unchanged' | 'empty';
			content: string;
		};
		right: {
			lineNum: number | null;
			type: 'added' | 'unchanged' | 'empty';
			content: string;
		};
	}

	const pairedLines: SideBySideLine[] = [];
	let leftIdx = 0;
	let rightIdx = 0;

	const leftChanges = hunk.changes.filter(
		c => c.type === 'removed' || c.type === 'unchanged',
	);
	const rightChanges = hunk.changes.filter(
		c => c.type === 'added' || c.type === 'unchanged',
	);

	while (leftIdx < leftChanges.length || rightIdx < rightChanges.length) {
		const leftChange = leftChanges[leftIdx];
		const rightChange = rightChanges[rightIdx];

		if (leftChange?.type === 'unchanged' && rightChange?.type === 'unchanged') {
			pairedLines.push({
				left: {
					lineNum: leftChange.oldLineNum,
					type: 'unchanged',
					content: leftChange.content,
				},
				right: {
					lineNum: rightChange.newLineNum,
					type: 'unchanged',
					content: rightChange.content,
				},
			});
			leftIdx++;
			rightIdx++;
		} else if (
			leftChange?.type === 'removed' &&
			rightChange?.type === 'added'
		) {
			pairedLines.push({
				left: {
					lineNum: leftChange.oldLineNum,
					type: 'removed',
					content: leftChange.content,
				},
				right: {
					lineNum: rightChange.newLineNum,
					type: 'added',
					content: rightChange.content,
				},
			});
			leftIdx++;
			rightIdx++;
		} else if (leftChange?.type === 'removed') {
			pairedLines.push({
				left: {
					lineNum: leftChange.oldLineNum,
					type: 'removed',
					content: leftChange.content,
				},
				right: {lineNum: null, type: 'empty', content: ''},
			});
			leftIdx++;
		} else if (rightChange?.type === 'added') {
			pairedLines.push({
				left: {lineNum: null, type: 'empty', content: ''},
				right: {
					lineNum: rightChange.newLineNum,
					type: 'added',
					content: rightChange.content,
				},
			});
			rightIdx++;
		} else {
			if (leftIdx < leftChanges.length) leftIdx++;
			if (rightIdx < rightChanges.length) rightIdx++;
		}
	}

	/**
	 * Pad or truncate an ANSI string to exactly `width` visible columns.
	 * Uses string-width for accurate measurement and slice-ansi for
	 * truncation that preserves ANSI escape sequences.
	 */
	const fitToWidth = (str: string, width: number): string => {
		const w = stringWidth(str);
		if (w === width) return str;
		if (w > width) return sliceAnsi(str, 0, width);
		return str + ' '.repeat(width - w);
	};

	/**
	 * Wrap an ANSI string into multiple rows, each padded to exactly `width`
	 * visible columns. Preserves ANSI escape sequences across slices.
	 */
	const wrapToWidth = (str: string, width: number): string[] => {
		if (width <= 0) return [''];
		const total = stringWidth(str);
		if (total === 0) return [' '.repeat(width)];
		const rows: string[] = [];
		let offset = 0;
		while (offset < total) {
			const piece = sliceAnsi(str, offset, offset + width);
			const pieceWidth = stringWidth(piece);
			rows.push(
				pieceWidth >= width ? piece : piece + ' '.repeat(width - pieceWidth),
			);
			if (pieceWidth <= 0) break;
			offset += pieceWidth;
		}
		return rows.length > 0 ? rows : [' '.repeat(width)];
	};

	const leftHeader = fitToWidth(chalk.red.bold('OLD'), panelWidth);
	const rightHeader = fitToWidth(chalk.green.bold('NEW'), panelWidth);
	const rule = `${style.sideRule} ${chalk.dim(
		`${'─'.repeat(panelWidth + 1)}┼${'─'.repeat(panelWidth + 1)}`,
	)}`;
	const lines: string[] = [
		hunkHeader,
		`${style.sideRule} ${leftHeader}${separator}${rightHeader}`,
		rule,
	];
	const emptyPanel = ' '.repeat(panelWidth);
	const prefixWidth = lineNumWidth + 3; // "NNNN S " → lineNum + space + sign + space
	const contentWidth = Math.max(panelWidth - prefixWidth, 1);
	const blankPrefix = ' '.repeat(prefixWidth);

	for (const pair of pairedLines) {
		const leftLineNum = pair.left.lineNum
			? String(pair.left.lineNum).padStart(lineNumWidth, ' ')
			: ''.padStart(lineNumWidth, ' ');
		const rightLineNum = pair.right.lineNum
			? String(pair.right.lineNum).padStart(lineNumWidth, ' ')
			: ''.padStart(lineNumWidth, ' ');
		const leftSign = pair.left.type === 'removed' ? '-' : ' ';
		const rightSign = pair.right.type === 'added' ? '+' : ' ';
		const leftContent = hl(cleanContent(pair.left.content));
		const rightContent = hl(cleanContent(pair.right.content));
		const leftRows =
			pair.left.type === 'empty'
				? ['']
				: wrapToWidth(leftContent, contentWidth);
		const rightRows =
			pair.right.type === 'empty'
				? ['']
				: wrapToWidth(rightContent, contentWidth);
		const rowCount = Math.max(leftRows.length, rightRows.length);

		for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
			const leftPrefix =
				rowIdx === 0 ? `${leftLineNum} ${leftSign} ` : blankPrefix;
			const rightPrefix =
				rowIdx === 0 ? `${rightLineNum} ${rightSign} ` : blankPrefix;
			const leftRow = leftRows[rowIdx] ?? ' '.repeat(contentWidth);
			const rightRow = rightRows[rowIdx] ?? ' '.repeat(contentWidth);
			let leftStr: string;

			if (pair.left.type === 'empty') {
				leftStr = emptyPanel;
			} else if (pair.left.type === 'removed') {
				leftStr = fitToWidth(
					`${style.lineNumRemovedStyle(
						leftLineNum + ' ',
					)}${style.subtleRemovedStyle(
						`${style.removedSignStyle(leftSign)} ${leftRow}`,
					)}`,
					panelWidth,
				);
			} else {
				leftStr = fitToWidth(
					`${style.lineNumStyle(
						leftPrefix.slice(0, lineNumWidth),
					)}${leftPrefix.slice(lineNumWidth)}${leftRow}`,
					panelWidth,
				);
			}

			let rightStr: string;
			if (pair.right.type === 'empty') {
				rightStr = emptyPanel;
			} else if (pair.right.type === 'added') {
				rightStr = fitToWidth(
					`${style.lineNumAddedStyle(
						rightLineNum + ' ',
					)}${style.subtleAddedStyle(
						`${style.addedSignStyle(rightSign)} ${rightRow}`,
					)}`,
					panelWidth,
				);
			} else {
				rightStr = fitToWidth(
					`${style.lineNumStyle(
						rightPrefix.slice(0, lineNumWidth),
					)}${rightPrefix.slice(lineNumWidth)}${rightRow}`,
					panelWidth,
				);
			}

			lines.push(`${style.sideRule} ${leftStr}${separator}${rightStr}`);
		}
	}

	return lines.join('\n');
}
