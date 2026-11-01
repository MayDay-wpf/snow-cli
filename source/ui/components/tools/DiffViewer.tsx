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
	showFilenameInHeader?: boolean;
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

const HASHLINE_PREFIX_PROBE = /^\s*\d+:[0-9a-fA-F]{2}→/m;
const LINE_NUMBER_PREFIX_PROBE = /^\s*\d+→/m;

function stripLineNumbers(content: string): string {
	if (typeof content !== 'string') {
		return '';
	}

	// Fast path: ordinary file content never carries hashline anchors, so the
	// per-line regex scan below (expensive on huge files) is skipped entirely.
	if (
		!HASHLINE_PREFIX_PROBE.test(content) &&
		!LINE_NUMBER_PREFIX_PROBE.test(content)
	) {
		return content;
	}

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

/**
 * Performance constants. Nothing here hides diff content — they only choose
 * between equivalent algorithms so large files do not block the render loop:
 *
 * - DIFF_CONTEXT_LINES_TO_KEEP: unchanged lines kept around the changed region
 *   before handing content to jsdiff. Hunks only ever display 3 context lines,
 *   so this produces exactly the same output while avoiding materialising a
 *   Change object for every line of a huge file.
 * - SIMPLE_DIFF_TOTAL_LINE_LIMIT / SIMPLE_DIFF_MIN_OVERLAP: when a changed
 *   region is enormous *and* almost completely rewritten, Myers diff becomes
 *   O(N*D) and stalls the UI. Such a region is diffed as "all removed lines
 *   followed by all added lines" — every line is still displayed, only the
 *   alignment of a full rewrite is skipped.
 */
const DIFF_CONTEXT_LINES_TO_KEEP = 6;
const SIMPLE_DIFF_TOTAL_LINE_LIMIT = 6000;
const SIMPLE_DIFF_MIN_OVERLAP = 0.5;

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

function hexToRgb(hex: string): {r: number; g: number; b: number} | null {
	const normalized = normalizeHexColor(hex.trim());
	if (!normalized) return null;
	const num = parseInt(normalized, 16);
	return {
		r: (num >> 16) & 255,
		g: (num >> 8) & 255,
		b: num & 255,
	};
}

function hexToTrueColorFg(hex: string): (text: string) => string {
	const rgb = hexToRgb(hex);
	if (!rgb) {
		return text => chalk.white(text);
	}
	return (text: string) =>
		`\u001b[38;2;${rgb.r};${rgb.g};${rgb.b}m${text}\u001b[39m`;
}

function hexToTrueColorBg(hex: string): (text: string) => string {
	const rgb = hexToRgb(hex);
	if (!rgb) {
		return text => text;
	}
	return (text: string) =>
		`\u001b[48;2;${rgb.r};${rgb.g};${rgb.b}m${text}\u001b[49m`;
}

function sRgbToRelativeLuminance(hex: string): number {
	const rgb = hexToRgb(hex);
	if (!rgb) return 0;
	const toLinear = (c: number) =>
		c / 255 <= 0.04045
			? c / 255 / 12.92
			: Math.pow((c / 255 + 0.055) / 1.055, 2.4);
	return (
		0.2126729 * toLinear(rgb.r) +
		0.7151522 * toLinear(rgb.g) +
		0.072175 * toLinear(rgb.b)
	);
}

function boostContrastToTarget(hexColor: string, isLightBg: boolean): string {
	const rgb = hexToRgb(hexColor);
	if (!rgb) return hexColor;
	const lum = sRgbToRelativeLuminance(hexColor);
	if (isLightBg) {
		// 浅底：如果字不够暗，向纯黑拉暗
		if (lum > 0.25) {
			const r = Math.floor(rgb.r * 0.5);
			const g = Math.floor(rgb.g * 0.5);
			const b = Math.floor(rgb.b * 0.5);
			return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
		}
	} else {
		// 暗底：如果字不够亮（相对明度 < 0.35），向高光方向线性提升，避免低对比度死角
		if (lum < 0.35) {
			const r = Math.min(255, Math.floor(rgb.r + (255 - rgb.r) * 0.45));
			const g = Math.min(255, Math.floor(rgb.g + (255 - rgb.g) * 0.45));
			const b = Math.min(255, Math.floor(rgb.b + (255 - rgb.b) * 0.45));
			return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
		}
	}
	return hexColor;
}

function highlightCodeContent(
	content: string,
	language?: string,
	themeColors?: {
		background: string;
		cyan: string;
		diffModified: string;
		diffAddedForeground: string;
		diffRemovedForeground: string;
		lineNumber: string;
		text: string;
	},
): string {
	if (!language || content.trim() === '' || !supportsLanguage(language)) {
		return content;
	}

	try {
		// [Perceptual Syntax Polarizer]
		// 严禁依赖终端默认颜色（防止 cli-highlight 回退到 \x1b[34m 深蓝）
		// 根据当前主题背景的明度自动选择极性，100% 保护现有浅色主题 (Light, Tiffany, Macaron)
		const isLightTheme = themeColors
			? sRgbToRelativeLuminance(themeColors.background) > 0.45
			: false;

		const rawKeyword = isLightTheme
			? '#0969da'
			: themeColors?.cyan ?? '#38bdf8';
		const rawType = isLightTheme
			? '#953800'
			: themeColors?.diffModified ?? '#f59e0b';
		const rawLiteral = isLightTheme
			? '#0550ae'
			: themeColors?.diffModified ?? '#fbbf24';
		const rawNumber = isLightTheme
			? '#116329'
			: themeColors?.diffAddedForeground ?? '#4ade80';
		const rawString = isLightTheme
			? '#0a3069'
			: themeColors?.diffAddedForeground ?? '#34d399';
		const rawComment = isLightTheme
			? '#6e7781'
			: themeColors?.lineNumber ?? '#94a3b8';
		const rawTitle = isLightTheme ? '#24292f' : themeColors?.text ?? '#f8fafc';
		const rawParams = isLightTheme ? '#57606a' : themeColors?.text ?? '#e2e8f0';

		const keywordHex = boostContrastToTarget(rawKeyword, isLightTheme);
		const typeHex = boostContrastToTarget(rawType, isLightTheme);
		const literalHex = boostContrastToTarget(rawLiteral, isLightTheme);
		const numberHex = boostContrastToTarget(rawNumber, isLightTheme);
		const stringHex = boostContrastToTarget(rawString, isLightTheme);
		const commentHex = boostContrastToTarget(rawComment, isLightTheme);
		const titleHex = boostContrastToTarget(rawTitle, isLightTheme);
		const paramsHex = boostContrastToTarget(rawParams, isLightTheme);

		const keywordFg = hexToTrueColorFg(keywordHex);
		const typeFg = hexToTrueColorFg(typeHex);
		const literalFg = hexToTrueColorFg(literalHex);
		const numberFg = hexToTrueColorFg(numberHex);
		const stringFg = hexToTrueColorFg(stringHex);
		const commentFg = hexToTrueColorFg(commentHex);
		const titleFg = hexToTrueColorFg(titleHex);
		const paramsFg = hexToTrueColorFg(paramsHex);

		// 全量覆盖 cli-highlight 的所有已知 token，杜绝任何 token 漏到默认深蓝
		const syntaxTheme = {
			keyword: keywordFg,
			built_in: keywordFg,
			type: typeFg,
			literal: literalFg,
			number: numberFg,
			regexp: literalFg,
			string: stringFg,
			subst: titleFg,
			symbol: literalFg,
			class: keywordFg,
			function: keywordFg,
			title: titleFg,
			params: paramsFg,
			comment: commentFg,
			doctag: commentFg,
			meta: keywordFg,
			'meta-keyword': keywordFg,
			'meta-string': stringFg,
			section: titleFg,
			tag: keywordFg,
			name: keywordFg,
			'builtin-name': keywordFg,
			attr: keywordFg,
			attribute: typeFg,
			variable: titleFg,
			bullet: literalFg,
			code: stringFg,
			emphasis: titleFg,
			strong: titleFg,
			formula: typeFg,
			link: keywordFg,
			quote: commentFg,
			'selector-tag': keywordFg,
			'selector-id': typeFg,
			'selector-class': typeFg,
			'selector-attr': keywordFg,
			'selector-pseudo': literalFg,
			'template-tag': keywordFg,
			'template-variable': literalFg,
			addition: numberFg,
			deletion: literalFg,
			default: (s: string) => s,
		};

		return highlight(content, {
			language,
			ignoreIllegals: true,
			theme: syntaxTheme,
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

const INK_BACKGROUND_STYLES: Record<string, (text: string) => string> = {
	black: text => chalk.bgBlack(text),
	red: text => chalk.bgRed(text),
	green: text => chalk.bgGreen(text),
	yellow: text => chalk.bgYellow(text),
	blue: text => chalk.bgBlue(text),
	magenta: text => chalk.bgMagenta(text),
	cyan: text => chalk.bgCyan(text),
	white: text => chalk.bgWhite(text),
	gray: text => chalk.bgGray(text),
	grey: text => chalk.bgGray(text),
};

const INK_FOREGROUND_STYLES: Record<string, (text: string) => string> = {
	black: text => chalk.black(text),
	red: text => chalk.red(text),
	green: text => chalk.green(text),
	yellow: text => chalk.yellow(text),
	blue: text => chalk.blue(text),
	magenta: text => chalk.magenta(text),
	cyan: text => chalk.cyan(text),
	white: text => chalk.white(text),
	gray: text => chalk.gray(text),
	grey: text => chalk.gray(text),
};

function applyThemeBackground(text: string, color: string): string {
	const normalizedHex = normalizeHexColor(color.trim());
	if (normalizedHex) {
		return hexToTrueColorBg(`#${normalizedHex}`)(text);
	}

	return INK_BACKGROUND_STYLES[color.trim().toLowerCase()]?.(text) ?? text;
}

function applyThemeForeground(text: string, color: string): string {
	const normalizedHex = normalizeHexColor(color.trim());
	if (normalizedHex) {
		return hexToTrueColorFg(`#${normalizedHex}`)(text);
	}

	return INK_FOREGROUND_STYLES[color.trim().toLowerCase()]?.(text) ?? text;
}

interface BoundedDiff {
	oldText: string;
	newText: string;
	lineOffset: number;
	/**
	 * True when the changed region is huge and almost fully rewritten. The
	 * caller then renders it as "all removed lines, then all added lines"
	 * instead of running the O(N*D) Myers diff. No line is dropped.
	 */
	simpleReplacement: boolean;
}

function countCommonPrefix(oldLines: string[], newLines: string[]): number {
	const maxPrefix = Math.min(oldLines.length, newLines.length);
	let prefix = 0;
	while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) {
		prefix++;
	}

	return prefix;
}

function countCommonSuffix(
	oldLines: string[],
	newLines: string[],
	prefix: number,
): number {
	const maxSuffix = Math.min(
		oldLines.length - prefix,
		newLines.length - prefix,
	);
	let suffix = 0;
	while (
		suffix < maxSuffix &&
		oldLines[oldLines.length - 1 - suffix] ===
			newLines[newLines.length - 1 - suffix]
	) {
		suffix++;
	}

	return suffix;
}

/**
 * Shrink the two sides of a diff down to the changed region plus a little
 * context. This does not change what is displayed: hunks only ever render
 * changed lines with 3 context lines, so trimming the identical head/tail
 * produces the exact same output while keeping the work proportional to the
 * size of the change instead of the size of the file.
 */
function boundDiffContent(oldText: string, newText: string): BoundedDiff {
	const oldLines = oldText.split('\n');
	const newLines = newText.split('\n');

	const prefix = countCommonPrefix(oldLines, newLines);
	const suffix = countCommonSuffix(oldLines, newLines, prefix);

	const prefixKeep = Math.min(prefix, DIFF_CONTEXT_LINES_TO_KEEP);
	const suffixKeep = Math.min(suffix, DIFF_CONTEXT_LINES_TO_KEEP);
	const sliceStart = prefix - prefixKeep;
	const oldSliceEnd = oldLines.length - suffix + suffixKeep;
	const newSliceEnd = newLines.length - suffix + suffixKeep;

	const oldMiddle = oldLines.slice(sliceStart, oldSliceEnd);
	const newMiddle = newLines.slice(sliceStart, newSliceEnd);

	let simpleReplacement = false;
	const totalMiddleLines = oldMiddle.length + newMiddle.length;
	if (totalMiddleLines > SIMPLE_DIFF_TOTAL_LINE_LIMIT) {
		const smallerSide = Math.min(oldMiddle.length, newMiddle.length);
		if (smallerSide > 0) {
			const newLineSet = new Set(newMiddle);
			let sharedLines = 0;
			for (const line of oldMiddle) {
				if (newLineSet.has(line)) {
					sharedLines++;
				}
			}

			simpleReplacement = sharedLines / smallerSide < SIMPLE_DIFF_MIN_OVERLAP;
		}
	}

	return {
		oldText: oldMiddle.join('\n'),
		newText: newMiddle.join('\n'),
		lineOffset: prefix - prefixKeep,
		simpleReplacement,
	};
}

interface DiffPart {
	value: string;
	added?: boolean;
	removed?: boolean;
}

/**
 * Complete "removed block, then added block" view for a changed region that is
 * too large and too different for Myers diff. Every line is still rendered;
 * only the alignment inside the rewritten block is skipped.
 */
function buildSimpleReplacementHunks(
	bounded: BoundedDiff,
	startLineNumber: number,
): DiffHunk[] {
	const parts: DiffPart[] = [];
	if (bounded.oldText.length > 0) {
		parts.push({value: `${bounded.oldText}\n`, removed: true});
	}

	if (bounded.newText.length > 0) {
		parts.push({value: `${bounded.newText}\n`, added: true});
	}

	return buildHunks(parts, startLineNumber + bounded.lineOffset);
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
	return buildHunks(
		Diff.diffLines(diffOldContent, diffNewContent),
		startLineNumber,
	);
}

function buildHunks(
	diffResult: DiffPart[],
	startLineNumber: number,
): DiffHunk[] {
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
	showFilenameInHeader = true,
}: Props) {
	const {theme} = useTheme();
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

	const useSideBySide = columns >= MIN_SIDE_BY_SIDE_WIDTH;

	// Strip hashline anchors once per content change: doing it on every render
	// is expensive for large files (it splits and regex-scans the whole text).
	const {diffOldContent, diffNewContent} = useMemo(() => {
		const useCompleteContent = Boolean(
			completeOldContent && completeNewContent,
		);
		return {
			diffOldContent: stripLineNumbers(
				useCompleteContent ? completeOldContent! : oldContent,
			),
			diffNewContent: stripLineNumbers(
				useCompleteContent ? completeNewContent! : newContent,
			),
		};
	}, [oldContent, newContent, completeOldContent, completeNewContent]);

	const renderedOutput = useMemo(() => {
		// A no-change edit (identical old/new content) must not render as an
		// empty diff box. The edit tools reject such calls now; this guard also
		// covers results restored from older sessions or logs.
		if (diffOldContent === diffNewContent) {
			return '';
		}

		const hl = (content: string) =>
			highlightCodeContent(
				expandTabsForDisplay(content),
				codeLanguage,
				theme.colors,
			);
		const cleanContent = (c: string) => c.replace(/[\r\n]/g, '');
		const formatHeaderTitle = (fallback: string) => {
			const title = showFilenameInHeader ? filename ?? fallback : undefined;
			return title ? `${chalk.cyan.bold(title)} ` : '';
		};
		const sideRule = chalk.dim('│');
		const dimStyle = (text: string) => chalk.dim(text);
		const subtleAddedStyle = (text: string) =>
			applyThemeBackground(text, theme.colors.diffAdded);
		const subtleRemovedStyle = (text: string) =>
			applyThemeBackground(text, theme.colors.diffRemoved);
		const addedTextStyle = (text: string) =>
			applyThemeForeground(text, theme.colors.diffAddedForeground);
		const removedTextStyle = (text: string) =>
			applyThemeForeground(text, theme.colors.diffRemovedForeground);
		const addedSignStyle = (text: string) => addedTextStyle(chalk.bold(text));
		const removedSignStyle = (text: string) =>
			removedTextStyle(chalk.bold(text));
		const lineNumberTextStyle = normalizeHexColor(theme.colors.lineNumber)
			? chalk.hex(theme.colors.lineNumber)
			: chalk.gray;
		const lineNumStyle = (text: string) => lineNumberTextStyle(text);
		const lineNumAddedStyle = (text: string) =>
			subtleAddedStyle(lineNumberTextStyle(text));
		const lineNumRemovedStyle = (text: string) =>
			subtleRemovedStyle(lineNumberTextStyle(text));
		const hunkStyle = (text: string) =>
			applyThemeForeground(chalk.dim(text), theme.colors.diffModified);

		const style: DiffRenderStyle = {
			sideRule,
			dimStyle,
			subtleAddedStyle,
			subtleRemovedStyle,
			addedTextStyle,
			removedTextStyle,
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
			const header = `${chalk.dim('╭─')} ${formatHeaderTitle(
				'New File',
			)}${addedSignStyle('new file')} ${addedTextStyle(`+${allLines.length}`)}`;
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
		// Diff only the region between the common prefix and suffix. This keeps
		// edits inside huge files fast while still producing accurate hunks.
		const bounded = boundDiffContent(diffOldContent, diffNewContent);
		const hunks = bounded.simpleReplacement
			? buildSimpleReplacementHunks(bounded, startLineNumber)
			: computeHunks(
					bounded.oldText,
					bounded.newText,
					startLineNumber + bounded.lineOffset,
			  );
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
		const modeLabel = useSideBySide
			? chalk.dim('side-by-side')
			: chalk.dim('unified');
		const modifiedBadge = applyThemeForeground(
			chalk.bold('modified'),
			theme.colors.diffModified,
		);
		const header = `${chalk.dim('╭─')} ${formatHeaderTitle(
			'File Modified',
		)}${modifiedBadge} ${modeLabel} ${addedTextStyle(
			`+${addedCount}`,
		)} ${removedTextStyle(`-${removedCount}`)}`;

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
		showFilenameInHeader,
		codeLanguage,
		useSideBySide,
		columns,
		theme.colors.diffAdded,
		theme.colors.diffRemoved,
		theme.colors.diffModified,
		theme.colors.diffAddedForeground,
		theme.colors.diffRemovedForeground,
		theme.colors.lineNumber,
		theme.colors.cyan,
		theme.colors.text,
		theme.colors.background,
	]);

	if (!renderedOutput) {
		return null;
	}

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
	addedTextStyle: (s: string) => string;
	removedTextStyle: (s: string) => string;
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

/**
 * Return the end index (exclusive) of the ANSI escape sequence starting at
 * `index`. Escape sequences occupy zero terminal columns and are copied into
 * the current row verbatim.
 */
function readAnsiSequenceEnd(str: string, index: number): number {
	if (str.charCodeAt(index) !== 0x1b) {
		return index + 1;
	}

	let cursor = index + 1;
	if (cursor >= str.length) {
		return cursor;
	}

	const introducer = str.charCodeAt(cursor);

	// CSI: ESC [ ... final-byte
	if (introducer === 0x5b) {
		cursor++;
		while (cursor < str.length) {
			const code = str.charCodeAt(cursor);
			cursor++;
			if (code >= 0x40 && code <= 0x7e) {
				break;
			}
		}

		return cursor;
	}

	// OSC: ESC ] ... BEL or ESC \
	if (introducer === 0x5d) {
		cursor++;
		while (cursor < str.length) {
			const code = str.charCodeAt(cursor);
			if (code === 0x07) {
				cursor++;
				break;
			}

			if (code === 0x1b && str.charCodeAt(cursor + 1) === 0x5c) {
				cursor += 2;
				break;
			}

			cursor++;
		}

		return cursor;
	}

	// Two-byte escape sequence.
	return Math.min(str.length, cursor + 1);
}

function chunkVisibleWidth(chunk: string): number {
	if (chunk.length === 1) {
		const code = chunk.charCodeAt(0);
		if (code >= 0x20 && code < 0x7f) {
			return 1;
		}

		if (code < 0x20) {
			return 0;
		}
	}

	return stringWidth(chunk);
}

/**
 * Wrap an ANSI-coloured line into rows of exactly `width` visible columns.
 *
 * Implemented as a single forward pass: every escape sequence is copied
 * verbatim (zero width), every visible code point is measured once and the row
 * is broken at the last whitespace when possible. The previous implementation
 * re-sliced the remaining string for every row, which is O(n^2) per line and
 * made very long lines (minified bundles, one-line JSON) freeze the UI.
 */
function wrapAnsiToWidth(str: string, width: number): string[] {
	if (width <= 0) {
		return [''];
	}

	const rows: string[] = [];
	let row = '';
	let rowWidth = 0;
	let lastSpaceIndex = -1;

	const flushRow = () => {
		rows.push(fitAnsiToWidth(row, width));
		row = '';
		rowWidth = 0;
		lastSpaceIndex = -1;
	};

	let index = 0;
	while (index < str.length) {
		const code = str.charCodeAt(index);

		if (code === 0x1b) {
			const end = readAnsiSequenceEnd(str, index);
			row += str.slice(index, end);
			index = end;
			continue;
		}

		// Keep surrogate pairs together so emoji are measured correctly.
		const chunkSize =
			code >= 0xd800 && code <= 0xdbff && index + 1 < str.length ? 2 : 1;
		const chunk = str.slice(index, index + chunkSize);
		index += chunkSize;
		const chunkWidth = chunkVisibleWidth(chunk);

		while (rowWidth + chunkWidth > width && rowWidth > 0) {
			if (lastSpaceIndex > 0) {
				const head = row.slice(0, lastSpaceIndex);
				const tail = row.slice(lastSpaceIndex).replace(/^\s+/, '');
				rows.push(fitAnsiToWidth(head, width));
				row = tail;
				rowWidth = stringWidth(tail);
				const nextSpaceIndex = tail.lastIndexOf(' ');
				lastSpaceIndex = nextSpaceIndex >= 0 ? nextSpaceIndex + 1 : -1;
			} else {
				flushRow();
			}
		}

		row += chunk;
		rowWidth += chunkWidth;
		if (code === 0x20) {
			lastSpaceIndex = row.length;
		}
	}

	if (row.length > 0) {
		rows.push(fitAnsiToWidth(row, width));
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

	const leftHeader = fitToWidth(style.removedSignStyle('OLD'), panelWidth);
	const rightHeader = fitToWidth(style.addedSignStyle('NEW'), panelWidth);
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
				: wrapAnsiToWidth(leftContent, contentWidth);
		const rightRows =
			pair.right.type === 'empty'
				? ['']
				: wrapAnsiToWidth(rightContent, contentWidth);
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
