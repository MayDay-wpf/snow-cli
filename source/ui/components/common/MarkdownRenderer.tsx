import React from 'react';
import {Text, Box} from 'ink';
import {marked} from 'marked';
import {markedTerminal} from 'marked-terminal';
import logger from '../../../utils/core/logger.js';
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
			width: process.stdout.columns || 80,
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

export default function MarkdownRenderer({content}: Props) {
	try {
		const sanitizedContent = sanitizeMarkdownContent(content);
		const rendered = marked.parse(sanitizedContent) as string;

		if (!rendered || typeof rendered !== 'string') {
			logger.warn('[MarkdownRenderer] Invalid rendered output, falling back', {
				renderedType: typeof rendered,
				renderedValue: rendered,
			});
			return renderFallback(content);
		}

		let lines = rendered.split('\n');
		lines = trimLines(lines);

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
