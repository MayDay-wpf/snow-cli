import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {useI18n} from '../../../i18n/I18nContext.js';
import {vscodeConnection} from '../../../utils/ui/vscodeConnection.js';
import {hashBasedSnapshotManager} from '../../../utils/codebase/hashBasedSnapshot.js';

type Props = {
	fileCount: number;
	filePaths: string[];
	previewSessionId?: string;
	previewTargetMessageIndex?: number;
	onConfirm: (rollbackFiles: boolean | null, selectedFiles?: string[]) => void; // null means cancel, selectedFiles for partial rollback
};

export default function FileRollbackConfirmation({
	fileCount,
	filePaths,
	previewSessionId,
	previewTargetMessageIndex,
	onConfirm,
}: Props) {
	const {t} = useI18n();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [showFullList, setShowFullList] = useState(false);
	const [fileScrollIndex, setFileScrollIndex] = useState(0);
	const [selectedFiles, setSelectedFiles] = useState<Set<string>>(
		new Set(filePaths),
	); // Default all selected
	const [highlightedFileIndex, setHighlightedFileIndex] = useState(0);

	const closePreviewDiff = () => {
		if (vscodeConnection.isConnected()) {
			vscodeConnection.closeDiff().catch(() => {
				// Silently ignore close errors
			});
		}
	};

	// Close diff when leaving file list mode, and also when component unmounts
	useEffect(() => {
		if (!showFullList) {
			closePreviewDiff();
		}
		return () => {
			closePreviewDiff();
		};
	}, [showFullList]);

	// Show rollback preview diff when highlighted file changes in full list mode
	useEffect(() => {
		if (!showFullList || !filePaths[highlightedFileIndex]) {
			return;
		}

		const filePath = filePaths[highlightedFileIndex];
		const sessionId = previewSessionId;
		const targetMessageIndex = previewTargetMessageIndex;

		// Use setTimeout to debounce and avoid flickering during rapid navigation
		const timeoutId = setTimeout(() => {
			// Ensure old diff is closed before opening a new one
			closePreviewDiff();

			if (sessionId !== undefined && targetMessageIndex !== undefined) {
				hashBasedSnapshotManager
					.getRollbackPreviewForFile(sessionId, targetMessageIndex, filePath)
					.then(preview =>
						vscodeConnection.showDiff(
							preview.absolutePath,
							preview.currentContent,
							preview.rollbackContent,
							'Rollback Preview',
						),
					)
					.catch(() => {
						// Silently ignore diff preview errors
					});
				return;
			}

			// Fallback to git diff when preview context is missing
			vscodeConnection.showGitDiff(filePath).catch(() => {
				// Silently ignore git diff errors
			});
		}, 100);

		return () => {
			clearTimeout(timeoutId);
			closePreviewDiff();
		};
	}, [
		highlightedFileIndex,
		showFullList,
		filePaths,
		previewSessionId,
		previewTargetMessageIndex,
	]);

	const options = [
		{label: t.fileRollback.yesRollbackFiles, value: true},
		{label: t.fileRollback.noConversationOnly, value: false},
	];

	useInput((input, key) => {
		// Tab - toggle full file list view
		if (key.tab) {
			// Leaving file list mode should close the diff
			if (showFullList) {
				closePreviewDiff();
			}
			setShowFullList(prev => !prev);
			setFileScrollIndex(0); // Reset scroll when toggling
			setHighlightedFileIndex(0); // Reset highlight when toggling
			return;
		}

		// In full list mode, use up/down to navigate files, space to toggle selection
		if (showFullList) {
			const maxVisibleFiles = 10;
			const maxScroll = Math.max(0, filePaths.length - maxVisibleFiles);

			if (key.upArrow) {
				setHighlightedFileIndex(prev => {
					const newIndex = Math.max(0, prev - 1);
					// Adjust scroll if needed
					if (newIndex < fileScrollIndex) {
						setFileScrollIndex(newIndex);
					}
					return newIndex;
				});
				return;
			}

			if (key.downArrow) {
				setHighlightedFileIndex(prev => {
					const newIndex = Math.min(filePaths.length - 1, prev + 1);
					// Adjust scroll if needed
					if (newIndex >= fileScrollIndex + maxVisibleFiles) {
						setFileScrollIndex(
							Math.min(maxScroll, newIndex - maxVisibleFiles + 1),
						);
					}
					return newIndex;
				});
				return;
			}

			// Space - toggle file selection
			if (input === ' ') {
				const file = filePaths[highlightedFileIndex];
				if (file) {
					setSelectedFiles(prev => {
						const newSet = new Set(prev);
						if (newSet.has(file)) {
							newSet.delete(file);
						} else {
							newSet.add(file);
						}
						return newSet;
					});
				}
				return;
			}

			// Enter - confirm selection (when in file selection mode)
			if (key.return) {
				const selectedFilesArray = Array.from(selectedFiles);
				if (selectedFilesArray.length === 0) {
					// If no files selected, treat as conversation only
					onConfirm(false);
				} else if (selectedFilesArray.length === filePaths.length) {
					// All files selected, rollback all
					onConfirm(true);
				} else {
					// Partial selection
					onConfirm(true, selectedFilesArray);
				}
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

			// Enter - confirm selection (only when not in full list mode)
			if (key.return) {
				const choice = options[selectedIndex]?.value ?? false;
				if (choice) {
					// If user wants to rollback files, pass all selected files
					const selectedFilesArray = Array.from(selectedFiles);
					if (selectedFilesArray.length === filePaths.length) {
						onConfirm(true);
					} else {
						onConfirm(true, selectedFilesArray);
					}
				} else {
					// Conversation only
					onConfirm(false);
				}
				return;
			}
		}

		// ESC - exit full list mode or cancel rollback
		if (key.escape) {
			if (showFullList) {
				closePreviewDiff();
				setShowFullList(false);
				setFileScrollIndex(0);
				setHighlightedFileIndex(0);
			} else {
				closePreviewDiff();
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
	const hasMoreBelow =
		showFullList && fileScrollIndex + maxFilesToShowFull < filePaths.length;

	const selectedCount = selectedFiles.size;

	return (
		<Box flexDirection="column" marginX={1} marginBottom={1} padding={1}>
			<Box marginBottom={1}>
				<Text color="yellow" bold>
					⚠ {t.fileRollback.title}
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color="white">
					{showFullList
						? t.fileRollback.filesCountWithSelection
								.replace('{count}', String(fileCount))
								.replace('{selected}', String(selectedCount))
								.replace('{total}', String(fileCount))
						: t.fileRollback.filesCount.replace('{count}', String(fileCount))}
					:
				</Text>
			</Box>

			{/* File list */}
			<Box flexDirection="column" marginBottom={1} marginLeft={2}>
				{hasMoreAbove && (
					<Text color="gray" dimColor>
						{fileScrollIndex} {t.fileRollback.moreAbove}
					</Text>
				)}
				{displayFiles.map((file, index) => {
					const actualIndex = showFullList ? fileScrollIndex + index : index;
					const isSelected = selectedFiles.has(file);
					const isHighlighted =
						showFullList && actualIndex === highlightedFileIndex;

					return (
						<Box key={index}>
							<Text
								color={isHighlighted ? 'green' : isSelected ? 'cyan' : 'gray'}
								dimColor={!isHighlighted && !isSelected}
								bold={isHighlighted}
							>
								{showFullList ? (isSelected ? '[x] ' : '[ ] ') : '• '}
								{file}
							</Text>
						</Box>
					);
				})}
				{hasMoreBelow && (
					<Text color="gray" dimColor>
						{filePaths.length - (fileScrollIndex + maxFilesToShowFull)}{' '}
						{t.fileRollback.moreBelow}
					</Text>
				)}
				{!showFullList && remainingCountCompact > 0 && (
					<Text color="gray" dimColor>
						... {t.fileRollback.andMoreFiles} {remainingCountCompact} more file
						{remainingCountCompact > 1 ? 's' : ''}
					</Text>
				)}
			</Box>

			{!showFullList && (
				<>
					<Box marginBottom={1}>
						<Text color="gray" dimColor>
							{t.fileRollback.question}
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
						? `${t.fileRollback.navigateHint} · ${t.fileRollback.toggleHint} · ${t.fileRollback.confirmHint} · ${t.fileRollback.backHint}`
						: `${t.fileRollback.selectHint} · ${t.fileRollback.viewAllHint} · ${t.fileRollback.confirmHint} · ${t.fileRollback.cancelHint}`}
				</Text>
			</Box>
		</Box>
	);
}
