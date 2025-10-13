import React from 'react';
import {Box, Text} from 'ink';
import {highlight} from 'cli-highlight';

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

interface HeadingBlock {
	type: 'heading';
	level: number;
	content: string;
}

interface ListBlock {
	type: 'list';
	items: string[];
}

type ContentBlock = CodeBlock | TextBlock | HeadingBlock | ListBlock;

export default function MarkdownRenderer({content, color}: Props) {
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
									<Text>{highlightCode(block.code, block.language)}</Text>
								</Box>
							</Box>
						</Box>
					);
				}

				// Render heading
				if (block.type === 'heading') {
					const headingColors = ['cyan', 'blue', 'magenta', 'yellow'];
					const headingColor = headingColors[block.level - 1] || 'white';
					return (
						<Box key={index} marginY={0}>
							<Text bold color={headingColor}>
								{renderInlineFormatting(block.content)}
							</Text>
						</Box>
					);
				}

				// Render list
				if (block.type === 'list') {
					return (
						<Box key={index} flexDirection="column" marginY={0}>
							{block.items.map((item, itemIndex) => (
								<Box key={itemIndex}>
									<Text color="yellow">• </Text>
									<Text color={color}>{renderInlineFormatting(item)}</Text>
								</Box>
							))}
						</Box>
					);
				}

				// Render text with inline formatting
				return (
					<Box key={index} flexDirection="column">
						{block.content
							.split('\n')
							.map((line: string, lineIndex: number) => (
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

		// Check for heading (# ## ### ####)
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
		if (headingMatch) {
			blocks.push({
				type: 'heading',
				level: headingMatch[1]!.length,
				content: headingMatch[2]!.trim(),
			});
			i++;
			continue;
		}

		// Check for list item (* or -)
		const listMatch = line.match(/^[\s]*[*\-]\s+(.+)$/);
		if (listMatch) {
			const listItems: string[] = [listMatch[1]!.trim()];
			i++;

			// Collect consecutive list items
			while (i < lines.length) {
				const currentLine = lines[i] ?? '';
				const nextListMatch = currentLine.match(/^[\s]*[*\-]\s+(.+)$/);
				if (!nextListMatch) {
					break;
				}
				listItems.push(nextListMatch[1]!.trim());
				i++;
			}

			blocks.push({
				type: 'list',
				items: listItems,
			});
			continue;
		}

		// Collect text lines until next code block, heading, or list
		const textLines: string[] = [];
		while (i < lines.length) {
			const currentLine = lines[i] ?? '';
			if (
				currentLine.trim().startsWith('```') ||
				currentLine.match(/^#{1,6}\s+/) ||
				currentLine.match(/^[\s]*[*\-]\s+/)
			) {
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
			js: 'javascript',
			ts: 'typescript',
			py: 'python',
			rb: 'ruby',
			sh: 'bash',
			shell: 'bash',
			cs: 'csharp',
			'c#': 'csharp',
			cpp: 'cpp',
			'c++': 'cpp',
			yml: 'yaml',
			md: 'markdown',
		};

		const mappedLanguage =
			languageMap[language.toLowerCase()] || language.toLowerCase();
		return highlight(code, {language: mappedLanguage, ignoreIllegals: true});
	} catch {
		// If highlighting fails, return the code as-is
		return code;
	}
}

function renderInlineFormatting(text: string): string {
	// Handle inline code `code` - remove backticks
	text = text.replace(/`([^`]+)`/g, (_, code) => {
		// Use ANSI codes for inline code styling
		return `\x1b[36m${code}\x1b[0m`;
	});

	// Handle bold **text** or __text__ - remove markers
	text = text.replace(/(\*\*|__)([^*_]+)\1/g, (_, __, content) => {
		return `\x1b[1m${content}\x1b[0m`;
	});

	// Handle italic *text* or _text_ (but not part of bold) - remove markers
	text = text.replace(/(?<!\*)(\*)(?!\*)([^*]+)\1(?!\*)/g, (_, __, content) => {
		return `\x1b[3m${content}\x1b[0m`;
	});

	return text;
}
