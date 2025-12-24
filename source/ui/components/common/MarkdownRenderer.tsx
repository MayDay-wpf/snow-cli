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
		// Fix: markdown-it-terminal bug - removes "undefined" prefix before ANSI codes
		let lines = rendered
			.split('\n')
			.map(line => line.replace(/^undefined(\x1b\[)/g, '$1'));

		// Remove leading empty lines
		while (lines.length > 0 && lines[0]?.trim() === '') {
			lines.shift();
		}

		// Remove trailing empty lines
		while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
			lines.pop();
		}

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
