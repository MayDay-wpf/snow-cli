import React from 'react';
import { Box, Text } from 'ink';
import * as Diff from 'diff';

interface Props {
	oldContent?: string;
	newContent: string;
	filename?: string;
	// New props for complete file diff
	completeOldContent?: string;
	completeNewContent?: string;
}

interface DiffHunk {
	startLine: number;
	endLine: number;
	changes: Array<{
		type: 'added' | 'removed' | 'unchanged';
		content: string;
		oldLineNum: number | null;
		newLineNum: number | null;
	}>;
}

// Helper function to strip line numbers from content (format: "123→content")
function stripLineNumbers(content: string): string {
	return content
		.split('\n')
		.map(line => {
			// Match pattern: digits + → + content
			const match = line.match(/^\s*\d+→(.*)$/);
			return match ? match[1] : line;
		})
		.join('\n');
}

export default function DiffViewer({
	oldContent = '',
	newContent,
	filename,
	completeOldContent,
	completeNewContent,
}: Props) {
	// If complete file contents are provided, use them for intelligent diff
	const useCompleteContent = completeOldContent && completeNewContent;
	const diffOldContent = useCompleteContent
		? completeOldContent
		: stripLineNumbers(oldContent);
	const diffNewContent = useCompleteContent
		? completeNewContent
		: stripLineNumbers(newContent);

	// If no old content, show as new file creation
	const isNewFile = !diffOldContent || diffOldContent.trim() === '';

	if (isNewFile) {
		const allLines = diffNewContent.split('\n');

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
						<Text key={index} color="white" backgroundColor="#006400">
							+ {line}
						</Text>
					))}
				</Box>
			</Box>
		);
	}

	// Generate line-by-line diff
	const diffResult = Diff.diffLines(diffOldContent, diffNewContent);

	// Build all changes with line numbers
	interface Change {
		type: 'added' | 'removed' | 'unchanged';
		content: string;
		oldLineNum: number | null;
		newLineNum: number | null;
	}

	const allChanges: Change[] = [];
	let oldLineNum = 1;
	let newLineNum = 1;

	diffResult.forEach((part) => {
		const lines = part.value.replace(/\n$/, '').split('\n');

		lines.forEach((line) => {
			if (part.added) {
				allChanges.push({
					type: 'added',
					content: line,
					oldLineNum: null,
					newLineNum: newLineNum++,
				});
			} else if (part.removed) {
				allChanges.push({
					type: 'removed',
					content: line,
					oldLineNum: oldLineNum++,
					newLineNum: null,
				});
			} else {
				allChanges.push({
					type: 'unchanged',
					content: line,
					oldLineNum: oldLineNum++,
					newLineNum: newLineNum++,
				});
			}
		});
	});

	// Find diff hunks (groups of changes with context)
	const hunks: DiffHunk[] = [];
	const contextLines = 3; // Number of context lines before and after changes

	for (let i = 0; i < allChanges.length; i++) {
		const change = allChanges[i];
		if (change?.type !== 'unchanged') {
			// Found a change, create a hunk
			const hunkStart = Math.max(0, i - contextLines);
			let hunkEnd = i;

			// Extend the hunk to include all consecutive changes
			while (hunkEnd < allChanges.length - 1) {
				const nextChange = allChanges[hunkEnd + 1];
				if (!nextChange) break;

				// If next line is a change, extend the hunk
				if (nextChange.type !== 'unchanged') {
					hunkEnd++;
					continue;
				}

				// If there are more changes within context distance, extend the hunk
				let hasMoreChanges = false;
				for (
					let j = hunkEnd + 1;
					j < Math.min(allChanges.length, hunkEnd + 1 + contextLines * 2);
					j++
				) {
					if (allChanges[j]?.type !== 'unchanged') {
						hasMoreChanges = true;
						break;
					}
				}

				if (hasMoreChanges) {
					hunkEnd++;
				} else {
					break;
				}
			}

			// Add context lines after the hunk
			hunkEnd = Math.min(allChanges.length - 1, hunkEnd + contextLines);

			// Extract the hunk
			const hunkChanges = allChanges.slice(hunkStart, hunkEnd + 1);
			const firstChange = hunkChanges[0];
			const lastChange = hunkChanges[hunkChanges.length - 1];

			if (firstChange && lastChange) {
				hunks.push({
					startLine: firstChange.oldLineNum || firstChange.newLineNum || 1,
					endLine: lastChange.oldLineNum || lastChange.newLineNum || 1,
					changes: hunkChanges,
				});
			}

			// Skip to the end of this hunk
			i = hunkEnd;
		}
	}

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
				{hunks.map((hunk, hunkIndex) => (
					<Box key={hunkIndex} flexDirection="column" marginBottom={1}>
						{/* Hunk changes */}
						{hunk.changes.map((change, changeIndex) => {
							if (change.type === 'added') {
								return (
									<Text key={changeIndex} color="white" backgroundColor="#006400">
										+ {change.content}
									</Text>
								);
							}

							if (change.type === 'removed') {
								return (
									<Text key={changeIndex} color="white" backgroundColor="#8B0000">
										- {change.content}
									</Text>
								);
							}

							// Unchanged lines (context)
							return (
								<Text key={changeIndex} dimColor>
									  {change.content}
								</Text>
							);
						})}
					</Box>
				))}

				{/* Show total changes summary if there are multiple hunks */}
				{hunks.length > 1 && (
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							Total: {hunks.length} change region(s)
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
