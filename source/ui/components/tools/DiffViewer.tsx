import React, {useMemo} from 'react';
import {Box, Text} from 'ink';
import {highlight, supportsLanguage} from 'cli-highlight';
import * as Diff from 'diff';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';

interface Props {
	oldContent?: string;
	newContent: string;
	filename?: string;
	// New props for complete file diff
	completeOldContent?: string;
	completeNewContent?: string;
	// Starting line number for the content (if it's a fragment of a larger file)
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

// Strip display prefixes from tool results before diffing:
// 1) Hashline from filesystem-read: "lineNum:hash→content"
// 2) Line+arrow from filesystem-replaceedit (and legacy read): "lineNum→content"
//    Applied after (1) so "42:a3→..." is not broken by matching "42→" first.
// Iteratively strips nested prefixes to handle double-wrapping from model leaks.
/** Tabs jump to tab stops in terminals and widen Ink layouts; expand for stable diff display. */
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

// Minimum terminal width for side-by-side view (each side needs ~60 chars minimum)
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

export default function DiffViewer({
	oldContent = '',
	newContent,
	filename,
	completeOldContent,
	completeNewContent,
	startLineNumber = 1,
}: Props) {
	const {theme, diffOpacity} = useTheme();
	const {columns} = useTerminalSize();
	const codeLanguage = inferLanguageFromFilename(filename);
	const diffAddedBackground = useMemo(
		() =>
			blendHexColors(
				theme.colors.diffAdded,
				theme.colors.background,
				diffOpacity,
			),
		[diffOpacity, theme.colors.diffAdded, theme.colors.background],
	);
	const diffRemovedBackground = useMemo(
		() =>
			blendHexColors(
				theme.colors.diffRemoved,
				theme.colors.background,
				diffOpacity,
			),
		[diffOpacity, theme.colors.diffRemoved, theme.colors.background],
	);

	// Use side-by-side view when terminal is wide enough
	const useSideBySide = columns >= MIN_SIDE_BY_SIDE_WIDTH;

	// Always strip hashline / lineNum→ prefixes — even from completeOldContent/completeNewContent
	const diffOldContent = stripLineNumbers(
		(completeOldContent && completeNewContent ? completeOldContent : oldContent),
	);
	const diffNewContent = stripLineNumbers(
		(completeOldContent && completeNewContent ? completeNewContent : newContent),
	);

	function renderHighlightedLine({
		key,
		prefix,
		content,
		backgroundColor,
		color,
		dimColor = false,
	}: {
		key: React.Key;
		prefix: string;
		content: string;
		backgroundColor?: string;
		color?: string;
		dimColor?: boolean;
	}): React.ReactElement {
		const highlightedContent = highlightCodeContent(
			expandTabsForDisplay(content),
			codeLanguage,
		);

		return (
			<Text
				key={key}
				color={color}
				backgroundColor={backgroundColor}
				dimColor={dimColor}
			>
				{prefix}
				{highlightedContent}
			</Text>
		);
	}

	// If no old content, show as new file creation
	const isNewFile = !diffOldContent || diffOldContent.trim() === '';

	// Memoize new file rendering to avoid re-splitting lines on every render
	const newFileContent = useMemo(() => {
		if (!isNewFile) return null;
		const allLines = diffNewContent.split('\n');

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					{filename ? (
						<>
							<Text bold color="cyan">
								{filename}
							</Text>
							<Text color="green"> (new)</Text>
						</>
					) : (
						<Text bold color="green">
							New File
						</Text>
					)}
				</Box>
				<Box flexDirection="column">
					{allLines.map((line, index) =>
						renderHighlightedLine({
							key: index,
							prefix: '+ ',
							content: line,
							backgroundColor: diffAddedBackground,
							color: 'white',
						}),
					)}
				</Box>
			</Box>
		);
	}, [isNewFile, diffNewContent, filename, codeLanguage, diffAddedBackground]);

	if (isNewFile) {
		return newFileContent;
	}

	// Memoize expensive diff calculation - only recompute when content changes
	const hunks = useMemo(() => {
		// Generate line-by-line diff
		const diffResult = Diff.diffLines(diffOldContent, diffNewContent);

		// Build all changes with line numbers
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
			// Normalize line endings and remove trailing newline
			const normalizedValue = part.value
				.replace(/\r\n/g, '\n')
				.replace(/\r/g, '\n')
				.replace(/\n$/, '');
			const lines = normalizedValue.split('\n');

			lines.forEach(line => {
				// Remove any remaining \r characters from the line
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

		// Find diff hunks (groups of changes with context)
		const computedHunks: DiffHunk[] = [];
		const contextLines = 3; // Number of context lines before and after changes

		for (let i = 0; i < allChanges.length; i++) {
			const change = allChanges[i];
			if (change?.type !== 'unchanged') {
				// Found a change, create a hunk
				const hunkStart = Math.max(0, i - contextLines);
				let hunkEnd = i;

				// Extend the hunk to include all consecutive changes
				while (hunkEnd < allChanges.length - 1) {
					const nextChange = allChanges[hunkEnd + 1];
					if (!nextChange) break;

					// If next line is a change, extend the hunk
					if (nextChange.type !== 'unchanged') {
						hunkEnd++;
						continue;
					}

					// If there are more changes within context distance, extend the hunk
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

				// Add context lines after the hunk
				hunkEnd = Math.min(allChanges.length - 1, hunkEnd + contextLines);

				// Extract the hunk
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

				// Skip to the end of this hunk
				i = hunkEnd;
			}
		}

		return computedHunks;
	}, [diffOldContent, diffNewContent, startLineNumber]);

	// Helper function to clean content (remove newlines that cause extra line breaks)
	const cleanContent = (content: string): string => {
		return content.replace(/[\r\n]/g, '');
	};

	// Render side-by-side diff view
	const renderSideBySide = (hunk: DiffHunk, hunkIndex: number) => {
		// Calculate panel width: (total - separator) / 2
		// Format: [lineNum 4] [space 1] [sign 1] [space 1] [content] | [lineNum 4] [space 1] [sign 1] [space 1] [content]
		const separatorWidth = 3; // " | "
		const lineNumWidth = 4;
		const panelWidth = Math.floor((columns - separatorWidth) / 2);

		// Build paired lines for side-by-side view
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

		// Separate changes into removed/unchanged (left) and added/unchanged (right)
		const leftChanges = hunk.changes.filter(
			c => c.type === 'removed' || c.type === 'unchanged',
		);
		const rightChanges = hunk.changes.filter(
			c => c.type === 'added' || c.type === 'unchanged',
		);

		// Match unchanged lines and pair removed/added
		while (leftIdx < leftChanges.length || rightIdx < rightChanges.length) {
			const leftChange = leftChanges[leftIdx];
			const rightChange = rightChanges[rightIdx];

			if (
				leftChange?.type === 'unchanged' &&
				rightChange?.type === 'unchanged'
			) {
				// Both are unchanged - pair them
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
				// Removed on left, added on right - pair them
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
				// Only removed on left
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
				// Only added on right
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
				// Skip any remaining
				if (leftIdx < leftChanges.length) leftIdx++;
				if (rightIdx < rightChanges.length) rightIdx++;
			}
		}

		// Build all lines data for rendering
		const lines = pairedLines.map((pair, idx) => {
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

			const leftContent = cleanContent(pair.left.content);
			const rightContent = cleanContent(pair.right.content);

			return {
				idx,
				leftLineNum,
				leftSign,
				leftContent,
				rightLineNum,
				rightSign,
				rightContent,
				leftType: pair.left.type,
				rightType: pair.right.type,
			};
		});

		// Build header decorations
		const headerDash = '-'.repeat(Math.floor((panelWidth - 5) / 2));

		return (
			<Box key={hunkIndex} flexDirection="column">
				{/* Hunk header */}
				<Text color="cyan" dimColor>
					@@ Lines {hunk.startLine}-{hunk.endLine} @@
				</Text>
				{/* Separator line with headers - Box left/center/right structure */}
				<Box flexDirection="row">
					{/* Left panel header */}
					<Box width={panelWidth}>
						<Text dimColor>{headerDash}</Text>
						<Text color="red" bold>
							{' OLD '}
						</Text>
						<Text dimColor>{headerDash}</Text>
					</Box>
					{/* Center separator */}
					<Box width={separatorWidth}>
						<Text dimColor>{' | '}</Text>
					</Box>
					{/* Right panel header */}
					<Box width={panelWidth}>
						<Text dimColor>{headerDash}</Text>
						<Text color="green" bold>
							{' NEW '}
						</Text>
						<Text dimColor>{headerDash}</Text>
					</Box>
				</Box>
				{/* Paired lines - Box left/center/right structure */}
				{lines.map(line => (
					<Box key={line.idx} flexDirection="row">
						{/* Left panel (OLD) */}
						<Box width={panelWidth}>
							{renderHighlightedLine({
								key: `left-${line.idx}`,
								prefix: `${line.leftLineNum} ${line.leftSign} `,
								content: line.leftContent,
								backgroundColor:
									line.leftType === 'removed'
										? diffRemovedBackground
										: undefined,
								color: line.leftType === 'removed' ? 'white' : undefined,
							})}
						</Box>
						{/* Center separator */}
						<Box width={separatorWidth}>
							<Text dimColor>{' | '}</Text>
						</Box>
						{/* Right panel (NEW) */}
						<Box width={panelWidth}>
							{renderHighlightedLine({
								key: `right-${line.idx}`,
								prefix: `${line.rightLineNum} ${line.rightSign} `,
								content: line.rightContent,
								backgroundColor:
									line.rightType === 'added' ? diffAddedBackground : undefined,
								color: line.rightType === 'added' ? 'white' : undefined,
							})}
						</Box>
					</Box>
				))}
			</Box>
		);
	};

	// Render unified diff view (original implementation)
	const renderUnified = (hunk: DiffHunk, hunkIndex: number) => {
		return (
			<Box key={hunkIndex} flexDirection="column" marginBottom={1}>
				{/* Hunk header showing line range */}
				<Text color="cyan" dimColor>
					@@ Lines {hunk.startLine}-{hunk.endLine} @@
				</Text>
				{/* Hunk changes */}
				{hunk.changes.map((change, changeIndex) => {
					// Calculate line number to display
					const lineNum =
						change.type === 'added' ? change.newLineNum : change.oldLineNum;
					const lineNumStr = lineNum
						? String(lineNum).padStart(4, ' ')
						: '    ';

					if (change.type === 'added') {
						return renderHighlightedLine({
							key: changeIndex,
							prefix: `${lineNumStr} + `,
							content: change.content,
							backgroundColor: diffAddedBackground,
							color: 'white',
						});
					}

					if (change.type === 'removed') {
						return renderHighlightedLine({
							key: changeIndex,
							prefix: `${lineNumStr} - `,
							content: change.content,
							backgroundColor: diffRemovedBackground,
							color: 'white',
						});
					}

					// Unchanged lines (context)
					return renderHighlightedLine({
						key: changeIndex,
						prefix: `${lineNumStr} `,
						content: change.content,
						dimColor: true,
					});
				})}
			</Box>
		);
	};

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				{filename ? (
					<>
						<Text bold color="cyan">
							{filename}
						</Text>
						<Text color="yellow"> (modified)</Text>
					</>
				) : (
					<Text bold color="yellow">
						File Modified
					</Text>
				)}
				{useSideBySide && <Text dimColor> (side-by-side)</Text>}
			</Box>
			<Box flexDirection="column">
				{hunks.map((hunk, hunkIndex) =>
					useSideBySide
						? renderSideBySide(hunk, hunkIndex)
						: renderUnified(hunk, hunkIndex),
				)}

				{/* Show total changes summary if there are multiple hunks */}
				{hunks.length > 1 && (
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							Total: {hunks.length} change region(s)
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
