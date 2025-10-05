import React from 'react';
import { Box, Text } from 'ink';
import { highlight } from 'cli-highlight';

interface Props {
	content: string;
	color?: string;
}

interface CodeBlock {
	type: 'code';
	language: string;
	code: string;
}

interface TextBlock {
	type: 'text';
	content: string;
}

type ContentBlock = CodeBlock | TextBlock;

export default function MarkdownRenderer({ content, color }: Props) {
	const blocks = parseMarkdown(content);

	return (
		<Box flexDirection="column">
			{blocks.map((block, index) => {
				if (block.type === 'code') {
					return (
						<Box key={index} flexDirection="column" marginY={0}>
							<Box borderStyle="round" borderColor="blue">
								<Box flexDirection="column">
									{block.language && (
										<Text backgroundColor="green" color="white">
											{block.language}
										</Text>

									)}
									<Text>
										{highlightCode(block.code, block.language)}
									</Text>
								</Box>
							</Box>
						</Box>
					);
				}

				// Render text with inline formatting
				return (
					<Box key={index} flexDirection="column">
						{block.content.split('\n').map((line, lineIndex) => (
							<Text key={lineIndex} color={color}>
								{line === '' ? ' ' : renderInlineFormatting(line)}
							</Text>
						))}
					</Box>
				);
			})}
		</Box>
	);
}

function parseMarkdown(content: string): ContentBlock[] {
	const blocks: ContentBlock[] = [];
	const lines = content.split('\n');
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] ?? '';

		// Check for code block - support ```language or just ```
		const codeBlockMatch = line.match(/^```(.*)$/);
		if (codeBlockMatch) {
			const language = codeBlockMatch[1]?.trim() || '';
			const codeLines: string[] = [];
			i++;

			// Collect code block lines
			while (i < lines.length) {
				const currentLine = lines[i] ?? '';
				if (currentLine.trim().startsWith('```')) {
					break;
				}
				codeLines.push(currentLine);
				i++;
			}

			blocks.push({
				type: 'code',
				language,
				code: codeLines.join('\n'),
			});
			i++; // Skip closing ```
			continue;
		}

		// Collect text lines until next code block
		const textLines: string[] = [];
		while (i < lines.length) {
			const currentLine = lines[i] ?? '';
			if (currentLine.trim().startsWith('```')) {
				break;
			}
			textLines.push(currentLine);
			i++;
		}

		if (textLines.length > 0) {
			blocks.push({
				type: 'text',
				content: textLines.join('\n'),
			});
		}
	}

	return blocks;
}

function highlightCode(code: string, language: string): string {
	try {
		// If no language specified, try to auto-detect or just return the code
		if (!language) {
			return code;
		}

		// Map common language aliases to cli-highlight supported names
		const languageMap: Record<string, string> = {
			'js': 'javascript',
			'ts': 'typescript',
			'py': 'python',
			'rb': 'ruby',
			'sh': 'bash',
			'shell': 'bash',
			'cs': 'csharp',
			'c#': 'csharp',
			'cpp': 'cpp',
			'c++': 'cpp',
			'yml': 'yaml',
			'md': 'markdown',
		};

		const mappedLanguage = languageMap[language.toLowerCase()] || language.toLowerCase();
		return highlight(code, { language: mappedLanguage, ignoreIllegals: true });
	} catch {
		// If highlighting fails, return the code as-is
		return code;
	}
}

function renderInlineFormatting(text: string): string {
	// Handle inline code `code`
	text = text.replace(/`([^`]+)`/g, (_, code) => {
		// Use ANSI codes for inline code styling
		return `\x1b[36m${code}\x1b[0m`;
	});

	// Handle bold **text** or __text__
	text = text.replace(/(\*\*|__)([^*_]+)\1/g, (_, __, content) => {
		return `\x1b[1m${content}\x1b[0m`;
	});

	// Handle italic *text* or _text_ (but not part of bold)
	text = text.replace(/(?<!\*)(\*)(?!\*)([^*]+)\1(?!\*)/g, (_, __, content) => {
		return `\x1b[3m${content}\x1b[0m`;
	});

	return text;
}
