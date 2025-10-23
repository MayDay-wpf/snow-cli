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
	// Keep single blank lines for paragraph spacing (better readability)
	const trimmedRendered = rendered
		.split('\n')
		.map((line: string) => line.trimEnd()) // Remove trailing spaces from each line
		.join('\n')
		.replace(/\n{3,}/g, '\n\n') // Replace 3+ consecutive newlines with 2 (paragraph spacing)
		.replace(/^\n+/g, '') // Remove leading newlines
		.replace(/\n+$/g, ''); // Remove trailing newlines

	return <Text>{trimmedRendered}</Text>;
}
