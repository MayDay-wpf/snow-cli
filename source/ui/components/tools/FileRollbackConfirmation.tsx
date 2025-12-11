import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

type Props = {
	fileCount: number;
	filePaths: string[];
	onConfirm: (rollbackFiles: boolean | null) => void; // null means cancel
};

export default function FileRollbackConfirmation({ fileCount, filePaths, onConfirm }: Props) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [showFullList, setShowFullList] = useState(false);
	const [fileScrollIndex, setFileScrollIndex] = useState(0);

	const options = [
		{ label: 'Yes, rollback files and conversation', value: true },
		{ label: 'No, rollback conversation only', value: false }
	];

	useInput((_, key) => {
		// Tab - toggle full file list view
		if (key.tab) {
			setShowFullList(prev => !prev);
			setFileScrollIndex(0); // Reset scroll when toggling
			return;
		}

		// In full list mode, use up/down to scroll files
		if (showFullList) {
			const maxVisibleFiles = 10;
			const maxScroll = Math.max(0, filePaths.length - maxVisibleFiles);

			if (key.upArrow) {
				setFileScrollIndex(prev => Math.max(0, prev - 1));
				return;
			}

			if (key.downArrow) {
				setFileScrollIndex(prev => Math.min(maxScroll, prev + 1));
				return;
			}
		} else {
			// In compact mode, up/down navigate options
			if (key.upArrow) {
				setSelectedIndex(prev => Math.max(0, prev - 1));
				return;
			}

			if (key.downArrow) {
				setSelectedIndex(prev => Math.min(options.length - 1, prev + 1));
				return;
			}
		}

		// Enter - confirm selection (only when not in full list mode)
		if (key.return && !showFullList) {
			onConfirm(options[selectedIndex]?.value ?? false);
			return;
		}

		// ESC - exit full list mode or cancel rollback
		if (key.escape) {
			if (showFullList) {
				setShowFullList(false);
				setFileScrollIndex(0);
			} else {
				onConfirm(null); // null means cancel everything
			}
			return;
		}
	});

	// Display logic for file list
	const maxFilesToShowCompact = 5;
	const maxFilesToShowFull = 10;

	const displayFiles = showFullList
		? filePaths.slice(fileScrollIndex, fileScrollIndex + maxFilesToShowFull)
		: filePaths.slice(0, maxFilesToShowCompact);

	const remainingCountCompact = fileCount - maxFilesToShowCompact;
	const hasMoreAbove = showFullList && fileScrollIndex > 0;
	const hasMoreBelow = showFullList && (fileScrollIndex + maxFilesToShowFull) < filePaths.length;

	return (
		<Box flexDirection="column" marginX={1} marginBottom={1} padding={1}>
			<Box marginBottom={1}>
				<Text color="yellow" bold>
					⚠  File Rollback Confirmation
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color="white">
					This checkpoint has {fileCount} file{fileCount > 1 ? 's' : ''} that will be rolled back:
				</Text>
			</Box>

			{/* File list */}
			<Box flexDirection="column" marginBottom={1} marginLeft={2}>
				{hasMoreAbove && (
					<Text color="gray" dimColor>
						↑ {fileScrollIndex} more above...
					</Text>
				)}
				{displayFiles.map((file, index) => (
					<Text key={index} color="cyan" dimColor>
						• {file}
					</Text>
				))}
				{hasMoreBelow && (
					<Text color="gray" dimColor>
						↓ {filePaths.length - (fileScrollIndex + maxFilesToShowFull)} more below...
					</Text>
				)}
				{!showFullList && remainingCountCompact > 0 && (
					<Text color="gray" dimColor>
						... and {remainingCountCompact} more file{remainingCountCompact > 1 ? 's' : ''}
					</Text>
				)}
			</Box>

			{!showFullList && (
				<>
					<Box marginBottom={1}>
						<Text color="gray" dimColor>
							Do you want to rollback the files as well?
						</Text>
					</Box>

					<Box flexDirection="column" marginBottom={1}>
						{options.map((option, index) => (
							<Box key={index}>
								<Text
									color={index === selectedIndex ? 'green' : 'white'}
									bold={index === selectedIndex}
								>
									{index === selectedIndex ? '❯  ' : '  '}
									{option.label}
								</Text>
							</Box>
						))}
					</Box>
				</>
			)}

			<Box>
				<Text color="gray" dimColor>
					{showFullList
						? '↑↓ scroll · Tab back · ESC close'
						: fileCount > maxFilesToShowCompact
						? `↑↓ select · Tab view all (${fileCount} files) · Enter confirm · ESC cancel`
						: '↑↓ select · Enter confirm · ESC cancel'}
				</Text>
			</Box>
		</Box>
	);
}
