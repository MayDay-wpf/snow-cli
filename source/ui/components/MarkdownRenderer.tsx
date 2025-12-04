import React from 'react';
import {Text, Box} from 'ink';
import MarkdownIt from 'markdown-it';
// @ts-expect-error - markdown-it-terminal has no type definitions
import terminal from 'markdown-it-terminal';
import Table from 'cli-table3';
import {highlight} from 'cli-highlight';
import logger from '../../utils/core/logger.js';

// Configure markdown-it with terminal renderer
const md = new MarkdownIt({
	html: true,
	breaks: true,
	linkify: true,
});

md.use(terminal, {
	styleOptions: {
		// Style options are handled by markdown-it-terminal automatically
	},
	unescape: true,
});

// Override fence rule to enable syntax highlighting for all languages
// markdown-it-terminal only highlights js/javascript by default
const originalFenceRule = md.renderer.rules.fence!;
md.renderer.rules.fence = function (tokens, idx, options, env, self) {
	const token = tokens[idx];
	if (!token) {
		return originalFenceRule(tokens, idx, options, env, self);
	}

	const langName = token.info ? token.info.trim().split(/\s+/g)[0] : '';

	if (langName) {
		try {
			const highlighted = highlight(token.content, {
				language: langName,
				ignoreIllegals: true,
			});
			// Return with code block styling
			const styleOptions = (options as any).styleOptions || {};
			const codeStyle = styleOptions.code || {open: '', close: ''};
			return (
				'\n' + codeStyle.open + highlighted.trimEnd() + codeStyle.close + '\n\n'
			);
		} catch (error) {
			// Language not supported, fall through to original rule
		}
	}

	// Fallback to original rule
	return originalFenceRule(tokens, idx, options, env, self);
};

// Custom table renderer to fix markdown-it-terminal's broken table rendering
// Override table-related rules to use cli-table3
md.renderer.rules['table_open'] = function () {
	return '\x1b[TABLE_START]\x1b';
};
md.renderer.rules['table_close'] = function () {
	return '\x1b[TABLE_END]\x1b';
};
md.renderer.rules['thead_open'] = function () {
	return '\x1b[THEAD_START]\x1b';
};
md.renderer.rules['thead_close'] = function () {
	return '\x1b[THEAD_END]\x1b';
};
md.renderer.rules['tbody_open'] = function () {
	return '\x1b[TBODY_START]\x1b';
};
md.renderer.rules['tbody_close'] = function () {
	return '\x1b[TBODY_END]\x1b';
};
md.renderer.rules['tr_open'] = function () {
	return '\x1b[TR_START]\x1b';
};
md.renderer.rules['tr_close'] = function () {
	return '\x1b[TR_END]\x1b';
};
md.renderer.rules['th_open'] = function () {
	return '\x1b[TH_START]\x1b';
};
md.renderer.rules['th_close'] = function () {
	return '\x1b[TH_END]\x1b';
};
md.renderer.rules['td_open'] = function () {
	return '\x1b[TD_START]\x1b';
};
md.renderer.rules['td_close'] = function () {
	return '\x1b[TD_END]\x1b';
};

interface Props {
	content: string;
}

/**
 * Sanitize markdown content to prevent rendering issues
 * Fixes invalid HTML attributes in rendered output
 */
function sanitizeMarkdownContent(content: string): string {
	// Replace <ol start="0">, <ol start="-1">, etc. with <ol start="1">
	return content.replace(/<ol\s+start=["']?(0|-\d+)["']?>/gi, '<ol start="1">');
}

/**
 * Parse and render table from special markers
 * Extracts table data between TABLE_START/TABLE_END markers
 */
function parseAndRenderTable(content: string): string {
	const tableRegex = /\x1b\[TABLE_START\]\x1b([\s\S]*?)\x1b\[TABLE_END\]\x1b/g;

	return content.replace(tableRegex, (match, tableContent) => {
		try {
			// Extract headers and rows from table content
			const headers: string[] = [];
			const rows: string[][] = [];
			let currentRow: string[] = [];
			let isInHead = false;
			let isInBody = false;
			let cellContent = '';

			// Parse table structure using markers
			const parts = tableContent.split(
				/(\x1b\[(?:THEAD_START|THEAD_END|TBODY_START|TBODY_END|TR_START|TR_END|TH_START|TH_END|TD_START|TD_END)\]\x1b)/g,
			);

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];

				if (part === '\x1b[THEAD_START]\x1b') {
					isInHead = true;
				} else if (part === '\x1b[THEAD_END]\x1b') {
					isInHead = false;
				} else if (part === '\x1b[TBODY_START]\x1b') {
					isInBody = true;
				} else if (part === '\x1b[TBODY_END]\x1b') {
					isInBody = false;
				} else if (part === '\x1b[TR_START]\x1b') {
					currentRow = [];
				} else if (part === '\x1b[TR_END]\x1b') {
					if (isInHead && currentRow.length > 0) {
						headers.push(...currentRow);
					} else if (isInBody && currentRow.length > 0) {
						rows.push(currentRow);
					}
				} else if (
					part === '\x1b[TH_START]\x1b' ||
					part === '\x1b[TD_START]\x1b'
				) {
					cellContent = '';
				} else if (part === '\x1b[TH_END]\x1b' || part === '\x1b[TD_END]\x1b') {
					// Strip ANSI codes and clean up content
					const cleanContent = cellContent
						.replace(/\x1b\[[0-9;]*m/g, '')
						.trim();
					currentRow.push(cleanContent);
				} else if (!part.match(/\x1b\[/)) {
					// This is cell content
					cellContent += part;
				}
			}

			// Get terminal width, default to 80 if not available
			const terminalWidth = process.stdout.columns || 80;

			// Calculate available width for content
			// Table structure: | col1 | col2 | col3 |
			// Borders: (numColumns + 1) * 1
			// Padding: numColumns * 2 (1 space on each side)
			const numColumns = headers.length;
			const bordersWidth = numColumns + 1;
			const paddingWidth = numColumns * 2;
			const availableWidth = terminalWidth - bordersWidth - paddingWidth;

			// Distribute width across columns proportionally based on content
			const columnWidths: number[] = [];

			if (availableWidth > 0 && numColumns > 0) {
				// Calculate content length for each column (max of header and all rows)
				const contentLengths = headers.map((header, colIndex) => {
					// Count Chinese characters as 2, English as 1
					const getDisplayWidth = (str: string) => {
						let width = 0;
						for (const char of str) {
							// Chinese characters range
							width += char.charCodeAt(0) > 255 ? 2 : 1;
						}
						return width;
					};

					let maxLen = getDisplayWidth(header);
					rows.forEach(row => {
						const cellContent = row[colIndex] || '';
						maxLen = Math.max(maxLen, getDisplayWidth(cellContent));
					});
					return maxLen;
				});

				const totalContentWidth = contentLengths.reduce(
					(sum, len) => sum + len,
					0,
				);

				// Distribute available width proportionally
				if (totalContentWidth > 0) {
					contentLengths.forEach((len, index) => {
						const proportion = len / totalContentWidth;
						let colWidth = Math.floor(availableWidth * proportion);

						// Set minimum column width to 8 for readability
						colWidth = Math.max(8, colWidth);

						columnWidths[index] = colWidth;
					});
				} else {
					// Equal distribution if no content
					const equalWidth = Math.floor(availableWidth / numColumns);
					headers.forEach(() => columnWidths.push(Math.max(8, equalWidth)));
				}
			}

			// Create table using cli-table3 with calculated widths
			const table = new Table({
				head: headers,
				colWidths: columnWidths.length > 0 ? columnWidths : undefined,
				style: {
					head: ['cyan'],
					border: ['gray'],
				},
				wordWrap: true,
				wrapOnWordBoundary: false,
			});

			rows.forEach(row => table.push(row));

			return '\n' + table.toString() + '\n';
		} catch (error: any) {
			logger.warn('[MarkdownRenderer] Failed to render table', {
				error: error.message,
			});
			// Return original content on error
			return match;
		}
	});
}

/**
 * Fallback renderer for when cli-markdown fails
 * Renders content as plain text to ensure visibility
 */
function renderFallback(content: string): React.ReactElement {
	const lines = content.split('\n');
	return (
		<Box flexDirection="column">
			{lines.map((line: string, index: number) => (
				<Text key={index}>{line || ' '}</Text>
			))}
		</Box>
	);
}

export default function MarkdownRenderer({content}: Props) {
	// Use markdown-it + markdown-it-terminal for complete markdown rendering
	// markdown-it-terminal properly handles inline formatting in list items

	try {
		// Stage 1: Sanitize content to prevent invalid HTML attributes
		const sanitizedContent = sanitizeMarkdownContent(content);

		// Stage 2: Render with markdown-it
		const rendered = md.render(sanitizedContent);

		// Safety check: ensure rendered content is valid
		if (!rendered || typeof rendered !== 'string') {
			logger.warn('[MarkdownRenderer] Invalid rendered output, falling back', {
				renderedType: typeof rendered,
				renderedValue: rendered,
			});
			return renderFallback(content);
		}

		// Stage 3: Parse and render tables using cli-table3
		const renderedWithTables = parseAndRenderTable(rendered);

		// Split into lines and render each separately
		// This prevents Ink's Text component from creating mysterious whitespace
		// when handling multi-line content with \n characters
		// Fix: markdown-it-terminal bug - removes "undefined" prefix before ANSI codes in indented lists
		const lines = renderedWithTables
			.split('\n')
			.map(line => line.replace(/^undefined(\x1b\[)/g, '$1'));

		// Safety check: prevent rendering issues with excessively long output
		if (lines.length > 500) {
			logger.warn('[MarkdownRenderer] Rendered output has too many lines', {
				totalLines: lines.length,
				truncatedTo: 500,
			});
			return (
				<Box flexDirection="column">
					{lines.slice(0, 500).map((line: string, index: number) => (
						<Text key={index}>{line || ' '}</Text>
					))}
				</Box>
			);
		}

		return (
			<Box flexDirection="column">
				{lines.map((line: string, index: number) => (
					<Text key={index}>{line || ' '}</Text>
				))}
			</Box>
		);
	} catch (error: any) {
		// Stage 3: Error handling - catch number-to-alphabet errors
		if (error?.message?.includes('Number must be >')) {
			logger.warn(
				'[MarkdownRenderer] Invalid list numbering detected, falling back to plain text',
				{
					error: error.message,
				},
			);
			return renderFallback(content);
		}

		// Re-throw other errors for debugging
		logger.error(
			'[MarkdownRenderer] Unexpected error during markdown rendering',
			{
				error: error.message,
				stack: error.stack,
			},
		);

		// Still provide fallback to prevent crash
		return renderFallback(content);
	}
}
