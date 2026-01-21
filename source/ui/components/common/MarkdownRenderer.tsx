import React from 'react';
import {Text, Box} from 'ink';
import MarkdownIt from 'markdown-it';
// @ts-expect-error - markdown-it-terminal has no type definitions
import terminal from 'markdown-it-terminal';
import markdownItMath from 'markdown-it-math';
import {marked} from 'marked';
import {markedTerminal} from 'marked-terminal';
import {highlight} from 'cli-highlight';
import logger from '../../../utils/core/logger.js';
import {
	latexToUnicode,
	simpleLatexToUnicode,
} from '../../../utils/latex/unicodeMath.js';

// Configure markdown-it with terminal renderer for non-table content
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

// Override paragraph rules to reduce excessive blank lines from markdown-it-terminal
// The library adds newline(2) after paragraphs which creates too much whitespace
const HEADING_STYLE = {open: '\x1b[32m\x1b[1m', close: '\x1b[22m\x1b[39m'};
const FIRST_HEADING_STYLE = {
	open: '\x1b[35m\x1b[4m\x1b[1m',
	close: '\x1b[22m\x1b[24m\x1b[39m',
};

md.renderer.rules['paragraph_open'] = (tokens, idx) =>
	tokens[idx]?.hidden ? '' : '';
md.renderer.rules['paragraph_close'] = (tokens, idx) => {
	if (tokens[idx]?.hidden) {
		return tokens[idx + 1]?.type?.endsWith('close') ? '' : '\n';
	}
	return '\n';
};

md.renderer.rules['heading_open'] = (tokens, idx) => {
	if (tokens[idx + 1]?.content === '') return '';
	const style = tokens[idx]?.tag === 'h1' ? FIRST_HEADING_STYLE : HEADING_STYLE;
	return '\n' + style.open;
};

md.renderer.rules['heading_close'] = (tokens, idx) => {
	if (tokens[idx - 1]?.content === '') return '';
	const style = tokens[idx]?.tag === 'h1' ? FIRST_HEADING_STYLE : HEADING_STYLE;
	return style.close + '\n\n';
};

// Keep markdown-it-terminal's internal list state consistent.
// We call the original rule for side effects, but override the returned string
// to reduce excessive blank lines.
const originalBulletListOpen = md.renderer.rules['bullet_list_open'];
const originalBulletListClose = md.renderer.rules['bullet_list_close'];
const originalOrderedListOpen = md.renderer.rules['ordered_list_open'];
const originalOrderedListClose = md.renderer.rules['ordered_list_close'];
const originalListItemClose = md.renderer.rules['list_item_close'];

md.renderer.rules['bullet_list_open'] = (tokens, idx, options, env, self) => {
	originalBulletListOpen?.(tokens, idx, options, env, self);
	return '';
};
md.renderer.rules['bullet_list_close'] = (tokens, idx, options, env, self) => {
	originalBulletListClose?.(tokens, idx, options, env, self);
	return '\n';
};
md.renderer.rules['ordered_list_open'] = (tokens, idx, options, env, self) => {
	originalOrderedListOpen?.(tokens, idx, options, env, self);
	return '';
};
md.renderer.rules['ordered_list_close'] = (tokens, idx, options, env, self) => {
	originalOrderedListClose?.(tokens, idx, options, env, self);
	return '\n';
};
md.renderer.rules['list_item_close'] = (tokens, idx, options, env, self) => {
	originalListItemClose?.(tokens, idx, options, env, self);
	return '\n';
};

// Override hr rule to fix width calculation issue
// markdown-it-terminal uses new Array(n).join('-') which produces n-1 chars
// Subtract 3 to account for ink framework rendering margins
md.renderer.rules['hr'] = () => {
	const width = (process.stdout.columns || 80) - 4;
	return '\n' + '-'.repeat(width) + '\n\n';
};

// Add markdown-it-math plugin for LaTeX math rendering
md.use(markdownItMath, {
	inlineOpen: '$',
	inlineClose: '$',
	blockOpen: '$$',
	blockClose: '$$',
	inlineRenderer: (latex: string) => {
		try {
			// 尝试使用KaTeX转换
			const unicode = latexToUnicode(latex, false);
			return unicode;
		} catch {
			// 失败时使用简单转换
			return simpleLatexToUnicode(latex);
		}
	},
	blockRenderer: (latex: string) => {
		try {
			// 块级公式使用显示模式
			const unicode = latexToUnicode(latex, true);
			return `\n${unicode}\n`;
		} catch {
			// 失败时使用简单转换并添加换行
			return `\n${simpleLatexToUnicode(latex)}\n`;
		}
	},
});

// Configure marked with marked-terminal renderer for table rendering only
marked.use(
	markedTerminal({
		width: process.stdout.columns || 80,
		reflowText: true,
	}) as any,
);

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

// Override link rendering to use OSC 8 hyperlinks for clickable terminal links
// Format: \x1b]8;;URL\x07TEXT\x1b]8;;\x07
// This allows links to be clickable in supported terminals (iTerm2, Windows Terminal, etc.)
md.renderer.rules['link_open'] = function (tokens, idx) {
	const token = tokens[idx];
	const hrefAttr = token?.attrs?.find(
		(attr: [string, string]) => attr[0] === 'href',
	);
	const href = hrefAttr ? hrefAttr[1] : '';
	// OSC 8 hyperlink start + cyan color for link text
	return `\x1b]8;;${href}\x07\x1b[36m`;
};

md.renderer.rules['link_close'] = function () {
	// Reset color + OSC 8 hyperlink end
	return `\x1b[39m\x1b]8;;\x07`;
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
 * Extract and render tables using marked library
 * Detects markdown tables and renders them with marked-terminal
 */
function renderTablesWithMarked(content: string): string {
	// Match markdown tables (at least 2 lines with | separators)
	const tableRegex = /^\s*\|.+\|.*$/gm;

	// Find all table blocks
	const lines = content.split('\n');
	const result: string[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i];

		// Check if this line starts a table
		if (line && tableRegex.test(line)) {
			// Collect all consecutive table lines
			const tableLines: string[] = [];
			while (i < lines.length) {
				const currentLine = lines[i];
				if (currentLine && /^\s*\|.+\|.*$/.test(currentLine)) {
					tableLines.push(currentLine);
					i++;
				} else {
					break;
				}
			}

			// Render table with marked
			const tableMarkdown = tableLines.join('\n');
			try {
				const renderedTable = marked(tableMarkdown) as string;
				result.push(renderedTable.trim());
			} catch (error: any) {
				logger.warn('[MarkdownRenderer] Failed to render table with marked', {
					error: error.message,
				});
				// Fallback to original table markdown
				result.push(tableMarkdown);
			}
		} else {
			// Not a table line, keep as-is
			if (line !== undefined) {
				result.push(line);
			}
			i++;
		}
	}

	return result.join('\n');
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

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

function isEmptyLine(line: string): boolean {
	return line.replace(ANSI_PATTERN, '').trim() === '';
}

/** Trim leading/trailing empty lines and collapse consecutive empty lines */
function trimLines(lines: string[]): string[] {
	const result: string[] = [];
	let lastWasEmpty = true; // Start true to skip leading empty lines

	for (const line of lines) {
		const isEmpty = isEmptyLine(line);
		if (isEmpty && lastWasEmpty) continue;
		result.push(line);
		lastWasEmpty = isEmpty;
	}

	// Trim trailing empty lines
	while (result.length > 0 && isEmptyLine(result[result.length - 1]!)) {
		result.pop();
	}
	return result;
}

export default function MarkdownRenderer({content}: Props) {
	// Use hybrid rendering: marked for tables, markdown-it for everything else

	try {
		// Stage 1: Sanitize content to prevent invalid HTML attributes
		const sanitizedContent = sanitizeMarkdownContent(content);

		// Stage 2: Extract tables and render them with marked
		const processedContent = renderTablesWithMarked(sanitizedContent);

		// Stage 3: Render remaining content with markdown-it
		const rendered = md.render(processedContent);

		// Safety check: ensure rendered content is valid
		if (!rendered || typeof rendered !== 'string') {
			logger.warn('[MarkdownRenderer] Invalid rendered output, falling back', {
				renderedType: typeof rendered,
				renderedValue: rendered,
			});
			return renderFallback(content);
		}

		// Stage 4: Clean up and split lines
		// Fix: markdown-it-terminal/renderer concat bug - occasionally prefixes literal "undefined".
		// We strip it only when more non-whitespace content follows, so a line that is exactly
		// "undefined" (user content) is preserved.
		let lines = rendered.split('\n').map(line =>
			line
				.replace(/^undefined\s*(?=\S)/, '')
				// markdown-it-terminal uses "*" for bullet lists; keep UI output aligned with user input.
				.replace(/^(\s*(?:\x1b\[[0-9;]*m)*)\*\s+(?=\S)/, '$1- '),
		);

		lines = trimLines(lines);

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
		// Error handling - catch rendering errors
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
