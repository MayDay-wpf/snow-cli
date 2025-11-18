import React from 'react';
import {Text, Box} from 'ink';
import {marked} from 'marked';
import TerminalRenderer from 'marked-terminal';
import logger from '../../utils/logger.js';

// Configure marked to use terminal renderer
marked.setOptions({
	// @ts-expect-error - marked-terminal types mismatch with marked v15
	renderer: new TerminalRenderer({
		reflowText: true,
		width: 80,
		emoji: false,
		tab: 2,
	}),
});

interface Props {
	content: string;
}

/**
 * Sanitize markdown content to prevent number-to-alphabet errors
 * Fixes invalid ordered list start attributes (0 or negative values)
 */
function sanitizeMarkdownContent(content: string): string {
	// Replace <ol start="0">, <ol start="-1">, etc. with <ol start="1">
	return content.replace(
		/<ol\s+start=["']?(0|-\d+)["']?>/gi,
		'<ol start="1">'
	);
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
				<Text key={index}>{line}</Text>
			))}
		</Box>
	);
}

export default function MarkdownRenderer({content}: Props) {
	// Use marked + marked-terminal for elegant markdown rendering with syntax highlighting
	// marked provides better stability and cross-platform support
	
	try {
		// Stage 1: Sanitize content to prevent invalid list numbering
		const sanitizedContent = sanitizeMarkdownContent(content);
		
		// Stage 2: Render with marked
		const rendered = marked.parse(sanitizedContent) as string;

		// Split into lines and render each separately
		// This prevents Ink's Text component from creating mysterious whitespace
		// when handling multi-line content with \n characters
		const lines = rendered.split('\n');

		// Safety check: prevent rendering issues with excessively long output
		if (lines.length > 500) {
			logger.warn('[MarkdownRenderer] Rendered output has too many lines', {
				totalLines: lines.length,
				truncatedTo: 500,
			});
			return (
				<Box flexDirection="column">
					{lines.slice(0, 500).map((line: string, index: number) => (
						<Text key={index}>{line}</Text>
					))}
				</Box>
			);
		}

		return (
			<Box flexDirection="column">
				{lines.map((line: string, index: number) => (
					<Text key={index}>{line}</Text>
				))}
			</Box>
		);
	} catch (error: any) {
		// Stage 3: Error handling - catch number-to-alphabet errors
		if (error?.message?.includes('Number must be >')) {
			logger.warn('[MarkdownRenderer] Invalid list numbering detected, falling back to plain text', {
				error: error.message,
			});
			return renderFallback(content);
		}
		
		// Re-throw other errors for debugging
		logger.error('[MarkdownRenderer] Unexpected error during markdown rendering', {
			error: error.message,
			stack: error.stack,
		});
		
		// Still provide fallback to prevent crash
		return renderFallback(content);
	}
}
