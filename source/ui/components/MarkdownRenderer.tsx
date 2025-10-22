import React from 'react';
import {Text} from 'ink';
import {highlight} from 'cli-highlight';
// @ts-expect-error - cli-markdown doesn't have TypeScript definitions
import cliMarkdown from 'cli-markdown';

interface Props {
	content: string;
}

export default function MarkdownRenderer({content}: Props) {
	// Use cli-markdown for elegant markdown rendering with syntax highlighting
	const rendered = cliMarkdown(content, {
		// Enable syntax highlighting for code blocks
		code: (code: string, language?: string) => {
			if (!language) return code;
			try {
				return highlight(code, {language, ignoreIllegals: true});
			} catch {
				return code;
			}
		},
	});

	// Remove excessive trailing newlines and whitespace from cli-markdown output
	// This prevents large blank spaces in the terminal
	const trimmedRendered = rendered
		.replace(/\n{3,}/g, '\n\n') // Replace 3+ newlines with 2 newlines
		.trimEnd(); // Remove trailing whitespace

	return <Text>{trimmedRendered}</Text>;
}
