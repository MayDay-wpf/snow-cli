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

		const addedStyle = (text: string) =>
			chalk.bgHex(diffAddedBg).white(text);
		const removedStyle = (text: string) =>
			chalk.bgHex(diffRemovedBg).white(text);
		const dimStyle = (text: string) => chalk.dim(text);
		const cleanContent = (c: string) => c.replace(/[\r\n]/g, '');

		const isNewFile = !diffOldContent || diffOldContent.trim() === '';

		// --- New file ---
		if (isNewFile) {
			const header = filename
				? chalk.cyan.bold(filename) + chalk.green(' (new)')
				: chalk.green.bold('New File');
			const allLines = diffNewContent.split('\n');
			const body = allLines
				.map(line => addedStyle('+ ' + hl(line)))
				.join('\n');
			return header + '\n' + body;
		}

		// --- Modified file ---
		const hunks = computeHunks(diffOldContent, diffNewContent, startLineNumber);

		const header = filename
			? chalk.cyan.bold(filename) +
			  chalk.yellow(' (modified)') +
			  (useSideBySide ? chalk.dim(' (side-by-side)') : '')
			: chalk.yellow.bold('File Modified');

		const hunkStrings = hunks.map(hunk => {
			const hunkHeader = chalk.cyan.dim(
				`@@ Lines ${hunk.startLine}-${hunk.endLine} @@`,
			);

			if (useSideBySide) {
				return formatSideBySide(
					hunk,
					hunkHeader,
					columns,
					hl,
					addedStyle,
					removedStyle,
					dimStyle,
					cleanContent,
				);
			}

			return formatUnified(
				hunk,
				hunkHeader,
				hl,
				addedStyle,
				removedStyle,
				dimStyle,
				cleanContent,
			);
		});

		let output = header + '\n' + hunkStrings.join('\n');

		if (hunks.length > 1) {
			output += '\n' + chalk.gray.dim(`Total: ${hunks.length} change region(s)`);
		}

		return output;
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

function formatUnified(
	hunk: DiffHunk,
	hunkHeader: string,
	hl: (s: string) => string,
	addedStyle: (s: string) => string,
	removedStyle: (s: string) => string,
	dimStyle: (s: string) => string,
	cleanContent: (s: string) => string,
): string {
	const lines: string[] = [hunkHeader];

	for (const change of hunk.changes) {
		const lineNum =
			change.type === 'added' ? change.newLineNum : change.oldLineNum;
		const lineNumStr = lineNum
			? String(lineNum).padStart(4, ' ')
			: '    ';
		const content = hl(cleanContent(change.content));

		if (change.type === 'added') {
			lines.push(addedStyle(`${lineNumStr} + ${content}`));
		} else if (change.type === 'removed') {
			lines.push(removedStyle(`${lineNumStr} - ${content}`));
		} else {
			lines.push(dimStyle(`${lineNumStr}   ${content}`));
		}
	}

	return lines.join('\n');
}

function formatSideBySide(
	hunk: DiffHunk,
	hunkHeader: string,
	columns: number,
	hl: (s: string) => string,
	addedStyle: (s: string) => string,
	removedStyle: (s: string) => string,
	dimStyle: (s: string) => string,
	cleanContent: (s: string) => string,
): string {
	const separatorWidth = 3;
	const lineNumWidth = 4;
	const panelWidth = Math.floor((columns - separatorWidth) / 2);
	const separator = chalk.dim(' | ');

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

		if (
			leftChange?.type === 'unchanged' &&
			rightChange?.type === 'unchanged'
		) {
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

	const headerDash = '-'.repeat(Math.max(Math.floor((panelWidth - 5) / 2), 1));
	const leftHeader = fitToWidth(
		chalk.dim(headerDash) + chalk.red.bold(' OLD ') + chalk.dim(headerDash),
		panelWidth,
	);
	const rightHeader = fitToWidth(
		chalk.dim(headerDash) + chalk.green.bold(' NEW ') + chalk.dim(headerDash),
		panelWidth,
	);

	const lines: string[] = [
		hunkHeader,
		leftHeader + separator + rightHeader,
	];

	const emptyPanel = ' '.repeat(panelWidth);

	for (const pair of pairedLines) {
		const leftLineNum = pair.left.lineNum
			? String(pair.left.lineNum).padStart(lineNumWidth, ' ')
			: ''.padStart(lineNumWidth, ' ');
		const rightLineNum = pair.right.lineNum
			? String(pair.right.lineNum).padStart(lineNumWidth, ' ')
			: ''.padStart(lineNumWidth, ' ');

		const leftSign =
			pair.left.type === 'removed'
				? '-'
				: pair.left.type === 'unchanged'
				? ' '
				: ' ';
		const rightSign =
			pair.right.type === 'added'
				? '+'
				: pair.right.type === 'unchanged'
				? ' '
				: ' ';

		const leftContent = hl(cleanContent(pair.left.content));
		const rightContent = hl(cleanContent(pair.right.content));

		let leftStr = `${leftLineNum} ${leftSign} ${leftContent}`;
		let rightStr = `${rightLineNum} ${rightSign} ${rightContent}`;

		if (pair.left.type === 'removed') {
			leftStr = fitToWidth(removedStyle(leftStr), panelWidth);
		} else if (pair.left.type === 'empty') {
			leftStr = emptyPanel;
		} else {
			leftStr = fitToWidth(dimStyle(leftStr), panelWidth);
		}

		if (pair.right.type === 'added') {
			rightStr = fitToWidth(addedStyle(rightStr), panelWidth);
		} else if (pair.right.type === 'empty') {
			rightStr = emptyPanel;
		} else {
			rightStr = fitToWidth(dimStyle(rightStr), panelWidth);
		}

		lines.push(leftStr + separator + rightStr);
	}

	return lines.join('\n');
}
