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

	return <Text>{rendered}</Text>;
}
