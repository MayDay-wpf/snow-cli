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
	// If no old content, show as new file creation
	const isNewFile = !oldContent || oldContent.trim() === '';

	if (isNewFile) {
		const allLines = newContent.split('\n');
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

	// Generate diff
	const diffResult = Diff.diffLines(oldContent, newContent);

	// Calculate line numbers and build display lines
	let oldLineNum = 1;
	let newLineNum = 1;
	const totalOldLines = oldContent.split('\n').length;
	const totalNewLines = newContent.split('\n').length;
	const lineNumberWidth = Math.max(String(totalOldLines).length, String(totalNewLines).length);

	// Build all display lines with their metadata
	interface DisplayLine {
		type: 'added' | 'removed' | 'unchanged';
		content: string;
		oldLineNum?: number;
		newLineNum?: number;
	}

	const displayLines: DisplayLine[] = [];

	diffResult.forEach((part) => {
		const lines = part.value.replace(/\n$/, '').split('\n');

		lines.forEach((line) => {
			if (part.added) {
				displayLines.push({
					type: 'added',
					content: line,
					newLineNum: newLineNum++
				});
			} else if (part.removed) {
				displayLines.push({
					type: 'removed',
					content: line,
					oldLineNum: oldLineNum++
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
					if (displayLine.type === 'added') {
						return (
							<Box key={index}>
								<Text color="gray" dimColor>
									{String(displayLine.newLineNum).padStart(lineNumberWidth, ' ')} │
								</Text>
								<Text color="white" backgroundColor="green">
									+ {displayLine.content}
								</Text>
							</Box>
						);
					}

					if (displayLine.type === 'removed') {
						return (
							<Box key={index}>
								<Text color="gray" dimColor>
									{String(displayLine.oldLineNum).padStart(lineNumberWidth, ' ')} │
								</Text>
								<Text color="white" backgroundColor="red">
									- {displayLine.content}
								</Text>
							</Box>
						);
					}

					// Unchanged lines
					return (
						<Box key={index}>
							<Text color="gray" dimColor>
								{String(displayLine.oldLineNum).padStart(lineNumberWidth, ' ')} │
							</Text>
							<Text dimColor>
								  {displayLine.content}
							</Text>
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}
