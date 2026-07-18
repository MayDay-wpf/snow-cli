import React from 'react';
import {Text, Box} from 'ink';
import {marked, type Tokens} from 'marked';
import {markedTerminal} from 'marked-terminal';
import {supportsLanguage} from 'cli-highlight';
import logger from '../../../utils/core/logger.js';
import {visualWidth} from '../../../utils/core/textUtils.js';
import {
	getAvailableTerminalColumns,
	getTerminalColumns,
} from '../../../utils/execution/terminal.js';
import {
	latexToUnicode,
	simpleLatexToUnicode,
} from '../../../utils/latex/unicodeMath.js';

// Configure marked with marked-terminal renderer (unified pipeline)
// markedTerminal already provides: cli-highlight for all languages,
// OSC 8 hyperlinks, chalk-based bold/italic/etc, pretty tables
marked.use(
	markedTerminal(
		{
			width: getTerminalColumns(),
			reflowText: true,
			unescape: true,
			showSectionPrefix: false,
			tab: 2,
		},
		{ignoreIllegals: true} as any,
	) as any,
);

// Fix markedTerminal bug: its `text` renderer ignores inline tokens (strong, em, etc.)
// by only reading token.text (raw string). We override it to parse inline tokens properly.
marked.use({
	renderer: {
		text(token: any) {
			if (typeof token === 'object') {
				if (token.tokens) {
					return (this as any).parser.parseInline(token.tokens);
				}

				return token.text;
			}

			return token;
		},
	},
});

const VERTICAL_TABLE_SEPARATOR_CHAR = '─';
// MarkdownRenderer 在不同场景下的实际可用宽度不同：
// - streaming 消息(MessageRenderer): Box paddingX(1)*2 + 图标列(1) + marginLeft(1) = 4 列，
//   可用宽度 = terminalWidth - 4
// - 非流式消息(MessageList): 图标列(1) + marginLeft(1) = 2 列，
//   可用宽度 = terminalWidth - 2
// 取最大预留值 4，确保纵向表格分隔线在所有场景下都不会超出可用宽度而溢出换行。
const VERTICAL_TABLE_RESERVED_COLUMNS = 4;

function renderInlineTokens(parser: any, cell: Tokens.TableCell): string {
	return cell.tokens ? parser.parseInline(cell.tokens) : cell.text;
}

function calculateHorizontalTableWidth(
	headers: string[],
	rows: string[][],
): number {
	const widths = headers.map(header => visualWidth(header));

	for (const row of rows) {
		row.forEach((cell, index) => {
			widths[index] = Math.max(widths[index] ?? 0, visualWidth(cell));
		});
	}

	// cli-table3 renders tables with left/right padding around every cell,
	// plus one border per column boundary.
	return (
		widths.reduce((total, width) => total + width + 2, 0) + widths.length + 1
	);
}

function formatVerticalTableSeparator(width: number): string {
	return VERTICAL_TABLE_SEPARATOR_CHAR.repeat(Math.max(1, width));
}

function renderVerticalTable(token: Tokens.Table, parser: any): string {
	const headers = token.header.map(cell => renderInlineTokens(parser, cell));
	const rows = token.rows.map(row =>
		row.map(cell => renderInlineTokens(parser, cell)),
	);
	const terminalWidth = getAvailableTerminalColumns(
		VERTICAL_TABLE_RESERVED_COLUMNS,
	);
	const horizontalTableWidth = calculateHorizontalTableWidth(headers, rows);

	if (horizontalTableWidth <= terminalWidth) {
		return false as any;
	}

	const separator = formatVerticalTableSeparator(terminalWidth);
	const blocks = rows.map(row => {
		return headers
			.map((header, index) => `${header}: ${row[index] ?? ''}`)
			.join('\n');
	});

	return `\n${blocks.join(`\n${separator}\n`)}\n`;
}

marked.use({
	renderer: {
		table(token: Tokens.Table) {
			return renderVerticalTable(token, (this as any).parser);
		},
	},
});

// Add LaTeX math support via custom marked extensions
marked.use({
	extensions: [
		{
			name: 'mathBlock',
			level: 'block' as const,
			start(src: string) {
				return src.indexOf('$$');
			},
			tokenizer(src: string) {
				const match = src.match(/^\$\$([\s\S]+?)\$\$/);
				if (match) {
					return {
						type: 'mathBlock',
						raw: match[0],
						text: match[1]!.trim(),
					};
				}

				return undefined;
			},
			renderer(token: any) {
				try {
					return `\n${latexToUnicode(token.text, true)}\n`;
				} catch {
					return `\n${simpleLatexToUnicode(token.text)}\n`;
				}
			},
		},
		{
			name: 'mathInline',
			level: 'inline' as const,
			start(src: string) {
				return src.indexOf('$');
			},
			tokenizer(src: string) {
				const match = src.match(/^\$([^\n$]+?)\$/);
				if (match) {
					return {
						type: 'mathInline',
						raw: match[0],
						text: match[1]!.trim(),
					};
				}

				return undefined;
			},
			renderer(token: any) {
				try {
					return latexToUnicode(token.text, false);
				} catch {
					return simpleLatexToUnicode(token.text);
				}
			},
		},
	],
});

// Sanitize unsupported language tags before they reach the highlighter,
// preventing highlight.js from emitting console warnings for unknown languages.
marked.use({
	walkTokens(token: any) {
		if (token.type === 'code' && token.lang && !supportsLanguage(token.lang)) {
			token.lang = '';
		}
	},
});

interface Props {
	content: string;
}

/**
 * Sanitize markdown content to prevent rendering issues
 * Fixes invalid HTML attributes in rendered output
 */
function sanitizeMarkdownContent(content: string): string {
	return content.replace(/<ol\s+start=["']?(0|-\d+)["']?>/gi, '<ol start="1">');
}

/**
 * Fallback renderer for when marked fails
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

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function isEmptyLine(line: string): boolean {
	return line.replace(ANSI_PATTERN, '').trim() === '';
}

/** Trim leading/trailing empty lines and collapse consecutive empty lines */
function trimLines(lines: string[]): string[] {
	const result: string[] = [];
	let lastWasEmpty = true;

	for (const line of lines) {
		const isEmpty = isEmptyLine(line);
		if (isEmpty && lastWasEmpty) continue;
		result.push(line);
		lastWasEmpty = isEmpty;
	}

	while (result.length > 0 && isEmptyLine(result[result.length - 1]!)) {
		result.pop();
	}

	return result;
}

export function renderMarkdownToLines(content: string): string[] {
	try {
		const sanitized = sanitizeMarkdownContent(content);
		const rendered = marked.parse(sanitized) as string;
		if (!rendered || typeof rendered !== 'string') return content.split('\n');
		return trimLines(rendered.split('\n'));
	} catch {
		return content.split('\n');
	}
}

export default function MarkdownRenderer({content}: Props) {
	try {
		const sanitizedContent = sanitizeMarkdownContent(content);
		const rendered = marked.parse(sanitizedContent) as string;

		if (!rendered || typeof rendered !== 'string') {
			// logger.warn('[MarkdownRenderer] Invalid rendered output, falling back', {
			// 	renderedType: typeof rendered,
			// 	renderedValue: rendered,
			// });
			return renderFallback(content);
		}

		let lines = rendered.split('\n');
		lines = trimLines(lines);

		return (
			<Box flexDirection="column">
				{lines.map((line: string, index: number) => (
					<Text key={index}>{line || ' '}</Text>
				))}
			</Box>
		);
	} catch (error: any) {
		if (error?.message?.includes('Number must be >')) {
			logger.warn(
				'[MarkdownRenderer] Invalid list numbering detected, falling back to plain text',
				{
					error: error.message,
				},
			);
			return renderFallback(content);
		}

		logger.error(
			'[MarkdownRenderer] Unexpected error during markdown rendering',
			{
				error: error.message,
				stack: error.stack,
			},
		);

		return renderFallback(content);
	}
}
