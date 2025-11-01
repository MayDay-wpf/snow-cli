import React from 'react';
import {Text, Box} from 'ink';
// @ts-expect-error - cli-markdown doesn't have TypeScript definitions
import cliMarkdown from 'cli-markdown';
import logger from '../../utils/logger.js';

interface Props {
	content: string;
}

export default function MarkdownRenderer({content}: Props) {
	// Use cli-markdown for elegant markdown rendering with syntax highlighting
	// The patched highlight function will gracefully handle unknown languages
	const rendered = cliMarkdown(content);

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
}
