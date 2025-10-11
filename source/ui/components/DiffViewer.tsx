import React from 'react';
import { Box, Text } from 'ink';
import * as Diff from 'diff';

interface Props {
	oldContent?: string;
	newContent: string;
	filename?: string;
}

export default function DiffViewer({
	oldContent = '',
	newContent,
	filename
}: Props) {
	// Strip line numbers if present (format: "123→content")
	const stripLineNumbers = (content: string): string => {
		return content
			.split('\n')
			.map(line => {
				// Match line number prefix pattern: "  123→"
				const match = line.match(/^\s*\d+→(.*)$/);
				return match ? match[1] : line;
			})
			.join('\n');
	};

	// Clean the content from filesystem line numbers
	const cleanOldContent = stripLineNumbers(oldContent);
	const cleanNewContent = stripLineNumbers(newContent);

	// If no old content, show as new file creation
	const isNewFile = !cleanOldContent || cleanOldContent.trim() === '';

	if (isNewFile) {
		const allLines = cleanNewContent.split('\n');
		const totalLines = allLines.length;
		const lineNumberWidth = String(totalLines).length;

		return (
			<Box flexDirection="column">
				<Box marginBottom={1}>
					<Text bold color="green">
						[New File]
					</Text>
					{filename && (
						<Text color="cyan">
							{' '}
							{filename}
						</Text>
					)}
				</Box>
				<Box flexDirection="column">
					{allLines.map((line, index) => (
						<Box key={index}>
							<Text color="gray" dimColor>
								{String(index + 1).padStart(lineNumberWidth, ' ')} │
							</Text>
							<Text color="white" backgroundColor="green">
								+ {line}
							</Text>
						</Box>
					))}
				</Box>
			</Box>
		);
	}

	// Generate diff using a unified diff format
	const diffResult = Diff.diffLines(cleanOldContent, cleanNewContent);

	// Calculate line numbers
	const totalOldLines = cleanOldContent.split('\n').length;
	const totalNewLines = cleanNewContent.split('\n').length;
	const lineNumberWidth = Math.max(
		String(totalOldLines).length,
		String(totalNewLines).length,
		2
	);

	// Build display lines with proper line number tracking
	interface DisplayLine {
		type: 'added' | 'removed' | 'unchanged';
		content: string;
		oldLineNum: number | null;
		newLineNum: number | null;
	}

	const displayLines: DisplayLine[] = [];
	let oldLineNum = 1;
	let newLineNum = 1;

	diffResult.forEach((part) => {
		const lines = part.value.replace(/\n$/, '').split('\n');

		lines.forEach((line) => {
			if (part.added) {
				displayLines.push({
					type: 'added',
					content: line,
					oldLineNum: null,
					newLineNum: newLineNum++
				});
			} else if (part.removed) {
				displayLines.push({
					type: 'removed',
					content: line,
					oldLineNum: oldLineNum++,
					newLineNum: null
				});
			} else {
				displayLines.push({
					type: 'unchanged',
					content: line,
					oldLineNum: oldLineNum++,
					newLineNum: newLineNum++
				});
			}
		});
	});

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold color="yellow">
					[File Modified]
				</Text>
				{filename && (
					<Text color="cyan">
						{' '}
						{filename}
					</Text>
				)}
			</Box>
			<Box flexDirection="column">
				{displayLines.map((displayLine, index) => {
					const oldNum = displayLine.oldLineNum !== null
						? String(displayLine.oldLineNum).padStart(lineNumberWidth, ' ')
						: ' '.repeat(lineNumberWidth);
					const newNum = displayLine.newLineNum !== null
						? String(displayLine.newLineNum).padStart(lineNumberWidth, ' ')
						: ' '.repeat(lineNumberWidth);

					if (displayLine.type === 'added') {
						return (
							<Box key={index} flexDirection="row">
								<Box flexShrink={0}>
									<Text color="gray" dimColor>
										{oldNum}
									</Text>
									<Text color="green" dimColor>
										{' + '}
									</Text>
									<Text color="gray" dimColor>
										{newNum}
									</Text>
									<Text dimColor> │ </Text>
								</Box>
								<Box>
									<Text color="white" backgroundColor="green" wrap="truncate-end">
										{' ' + displayLine.content}
									</Text>
								</Box>
							</Box>
						);
					}

					if (displayLine.type === 'removed') {
						return (
							<Box key={index} flexDirection="row">
								<Box flexShrink={0}>
									<Text color="gray" dimColor>
										{oldNum}
									</Text>
									<Text color="red" dimColor>
										{' - '}
									</Text>
									<Text color="gray" dimColor>
										{newNum}
									</Text>
									<Text dimColor> │ </Text>
								</Box>
								<Box>
									<Text color="white" backgroundColor="red" wrap="truncate-end">
										{' ' + displayLine.content}
									</Text>
								</Box>
							</Box>
						);
					}

					// Unchanged lines
					return (
						<Box key={index} flexDirection="row">
							<Box flexShrink={0}>
								<Text color="gray" dimColor>
									{oldNum}
								</Text>
								<Text dimColor>
									{'   '}
								</Text>
								<Text color="gray" dimColor>
									{newNum}
								</Text>
								<Text dimColor> │ </Text>
							</Box>
							<Box>
								<Text dimColor wrap="truncate-end">
									{displayLine.content}
								</Text>
							</Box>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
