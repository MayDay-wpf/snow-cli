import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {hashBasedSnapshotManager} from '../../../utils/codebase/hashBasedSnapshot.js';
import {vscodeConnection} from '../../../utils/ui/vscodeConnection.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {cleanIDEContext} from '../../../utils/core/fileUtils.js';
import fs from 'fs/promises';

type Props = {
	messages: Array<{
		role: string;
		content: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
		subAgentDirected?: unknown;
	}>;
	snapshotFileCount: Map<number, number>;
	onClose: () => void;
};

type MessageItem = {
	label: string;
	originalIndex: number;
	fileCount: number;
};

type ViewMode = 'messages' | 'files';

export default function DiffReviewPanel({
	messages,
	snapshotFileCount,
	onClose,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [busy, setBusy] = useState(false);

	// File list mode state
	const [viewMode, setViewMode] = useState<ViewMode>('messages');
	const [filePaths, setFilePaths] = useState<string[]>([]);
	const [fileHighlightIndex, setFileHighlightIndex] = useState(0);
	const [fileScrollIndex, setFileScrollIndex] = useState(0);
	const [activeMessageIndex, setActiveMessageIndex] = useState<number | null>(null);

	const VISIBLE_ITEMS = 5;
	const MAX_VISIBLE_FILES = 10;

	const userMessages: MessageItem[] = useMemo(() => {
		const items: MessageItem[] = [];
		let userMsgIndex = 0;
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (
				msg &&
				msg.role === 'user' &&
				msg.content.trim() &&
				!msg.subAgentDirected
			) {
				const cleanedContent = cleanIDEContext(msg.content);
				const cleanContent = cleanedContent
					.replace(/[\r\n\t\v\f\u0000-\u001F\u007F-\u009F]+/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();

				let totalFileCount = 0;
				for (const [idx, count] of snapshotFileCount.entries()) {
					if (idx >= i) {
						totalFileCount += count;
					}
				}

				items.push({
					label: `${userMsgIndex + 1}. ${cleanContent.slice(0, 60)}${cleanContent.length > 60 ? '...' : ''}`,
					originalIndex: i,
					fileCount: totalFileCount,
				});
				userMsgIndex++;
			}
		}
		return items;
	}, [messages, snapshotFileCount]);

	useEffect(() => {
		if (userMessages.length > 0) {
			setSelectedIndex(userMessages.length - 1);
		}
	}, [userMessages.length]);

	const closeDiffPreview = useCallback(() => {
		if (vscodeConnection.isConnected()) {
			vscodeConnection.closeDiff().catch(() => {});
		}
	}, []);

	useEffect(() => {
		return () => {
			closeDiffPreview();
		};
	}, [closeDiffPreview]);

	// Preview single file diff when navigating file list
	useEffect(() => {
		if (viewMode !== 'files' || activeMessageIndex === null) return;
		const filePath = filePaths[fileHighlightIndex];
		if (!filePath) return;

		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) return;

		const timeoutId = setTimeout(() => {
			closeDiffPreview();
			hashBasedSnapshotManager
				.getRollbackPreviewForFile(currentSession.id, activeMessageIndex, filePath)
				.then(async (preview) => {
					let currentContent = '';
					try {
						currentContent = await fs.readFile(preview.absolutePath, 'utf-8');
					} catch {
						currentContent = '';
					}
					await vscodeConnection.showDiff(
						preview.absolutePath,
						preview.rollbackContent,
						currentContent,
						'Diff Review',
					);
				})
				.catch(() => {});
		}, 100);

		return () => {
			clearTimeout(timeoutId);
		};
	}, [fileHighlightIndex, viewMode, filePaths, activeMessageIndex, closeDiffPreview]);

	// Load file list when Tab is pressed on a message
	const loadFileList = useCallback(async (messageIndex: number) => {
		const currentSession = sessionManager.getCurrentSession();
		if (!currentSession) return;

		const files = await hashBasedSnapshotManager.getFilesToRollback(
			currentSession.id,
			messageIndex,
		);
		setFilePaths(files);
		setFileHighlightIndex(0);
		setFileScrollIndex(0);
		setActiveMessageIndex(messageIndex);
		setViewMode('files');
	}, []);

	// Send all diffs to IDE
	const handleSelect = useCallback(
		async (messageIndex: number) => {
			setBusy(true);
			try {
				const currentSession = sessionManager.getCurrentSession();
				if (!currentSession || !vscodeConnection.isConnected()) {
					onClose();
					return;
				}

				const allFiles = await hashBasedSnapshotManager.getFilesToRollback(
					currentSession.id,
					messageIndex,
				);
				if (allFiles.length === 0) {
					onClose();
					return;
				}

				const diffFiles: Array<{
					filePath: string;
					originalContent: string;
					newContent: string;
				}> = [];

				for (const relativeFile of allFiles) {
					try {
						const preview =
							await hashBasedSnapshotManager.getRollbackPreviewForFile(
								currentSession.id,
								messageIndex,
								relativeFile,
							);
						const originalContent = preview.rollbackContent;
						let currentContent = '';
						try {
							currentContent = await fs.readFile(preview.absolutePath, 'utf-8');
						} catch {
							currentContent = '';
						}
						if (originalContent !== currentContent) {
							diffFiles.push({
								filePath: preview.absolutePath,
								originalContent,
								newContent: currentContent,
							});
						}
					} catch {
						// skip
					}
				}

				if (diffFiles.length > 0) {
					await vscodeConnection.showDiffReview(diffFiles);
				}
			} catch {
				// silently fail
			} finally {
				onClose();
			}
		},
		[onClose],
	);

	useInput((_input, key) => {
		if (busy) return;

		if (key.escape) {
			if (viewMode === 'files') {
				closeDiffPreview();
				setViewMode('messages');
				return;
			}
			onClose();
			return;
		}

		// Tab toggles file list view for current message
		if (key.tab && viewMode === 'messages' && userMessages.length > 0) {
			const selected = userMessages[selectedIndex];
			if (selected && selected.fileCount > 0) {
				void loadFileList(selected.originalIndex);
			}
			return;
		}

		if (key.tab && viewMode === 'files') {
			closeDiffPreview();
			setViewMode('messages');
			return;
		}

		if (viewMode === 'files') {
			const maxScroll = Math.max(0, filePaths.length - MAX_VISIBLE_FILES);

			if (key.upArrow) {
				setFileHighlightIndex(prev => {
					const newIdx = Math.max(0, prev - 1);
					if (newIdx < fileScrollIndex) {
						setFileScrollIndex(newIdx);
					}
					return newIdx;
				});
				return;
			}

			if (key.downArrow) {
				setFileHighlightIndex(prev => {
					const newIdx = Math.min(filePaths.length - 1, prev + 1);
					if (newIdx >= fileScrollIndex + MAX_VISIBLE_FILES) {
						setFileScrollIndex(Math.min(maxScroll, newIdx - MAX_VISIBLE_FILES + 1));
					}
					return newIdx;
				});
				return;
			}

			// Enter in file mode: send all diffs
			if (key.return && activeMessageIndex !== null) {
				closeDiffPreview();
				void handleSelect(activeMessageIndex);
				return;
			}
			return;
		}

		// Message list navigation
		if (key.upArrow) {
			setSelectedIndex(prev =>
				prev > 0 ? prev - 1 : userMessages.length - 1,
			);
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev =>
				prev < userMessages.length - 1 ? prev + 1 : 0,
			);
			return;
		}

		if (key.return && userMessages.length > 0) {
			const selected = userMessages[selectedIndex];
			if (selected) {
				void handleSelect(selected.originalIndex);
			}
			return;
		}
	});

	if (userMessages.length === 0) {
		return (
			<Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
				<Text color="magenta">
					{t.diffReviewPanel?.title || 'Diff Review'}
				</Text>
				<Text color="gray" dimColor>
					{t.diffReviewPanel?.noSnapshots || 'No file changes found in this session'}
				</Text>
			</Box>
		);
	}

	// File list view
	if (viewMode === 'files') {
		const displayFiles = filePaths.slice(
			fileScrollIndex,
			fileScrollIndex + MAX_VISIBLE_FILES,
		);
		const hasMoreAbove = fileScrollIndex > 0;
		const hasMoreBelow = fileScrollIndex + MAX_VISIBLE_FILES < filePaths.length;

		return (
			<Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
				<Text color="magenta">
					{t.diffReviewPanel?.title || 'Diff Review'} - {filePaths.length} files
				</Text>
				<Text color="gray" dimColor>
					↑↓ navigate · Tab back · Enter open all · ESC close
				</Text>

				{hasMoreAbove && (
					<Text color="gray" dimColor>
						↑ {fileScrollIndex} more above
					</Text>
				)}
				{displayFiles.map((file, idx) => {
					const actualIdx = fileScrollIndex + idx;
					const isHighlighted = actualIdx === fileHighlightIndex;
					return (
						<Box key={file} height={1}>
							<Text
								color={isHighlighted ? 'green' : 'gray'}
								bold={isHighlighted}
								dimColor={!isHighlighted}
								wrap="truncate"
							>
								{isHighlighted ? '❯ ' : '  '}
								{file}
							</Text>
						</Box>
					);
				})}
				{hasMoreBelow && (
					<Text color="gray" dimColor>
						↓ {filePaths.length - fileScrollIndex - MAX_VISIBLE_FILES} more below
					</Text>
				)}
			</Box>
		);
	}

	// Message list view
	let startIndex = 0;
	if (userMessages.length > VISIBLE_ITEMS) {
		startIndex = Math.max(0, selectedIndex - Math.floor(VISIBLE_ITEMS / 2));
		startIndex = Math.min(startIndex, userMessages.length - VISIBLE_ITEMS);
	}
	const endIndex = Math.min(userMessages.length, startIndex + VISIBLE_ITEMS);
	const visibleMessages = userMessages.slice(startIndex, endIndex);
	const hasMoreAbove = startIndex > 0;
	const hasMoreBelow = endIndex < userMessages.length;

	return (
		<Box borderStyle="round" borderColor="magenta" paddingX={1} flexDirection="column">
			<Text color="magenta">
				{t.diffReviewPanel?.title || 'Diff Review'} ({selectedIndex + 1}/
				{userMessages.length})
			</Text>
			<Text color="gray" dimColor>
				{t.diffReviewPanel?.navigationHint || '↑↓ navigate • Tab view files • Enter open all • ESC close'}
			</Text>

			{hasMoreAbove && (
				<Box height={1}>
					<Text color="gray" dimColor>↑ {startIndex} more above</Text>
				</Box>
			)}

			{visibleMessages.map((item, displayIndex) => {
				const actualIndex = startIndex + displayIndex;
				const isSelected = actualIndex === selectedIndex;
				return (
					<Box key={item.originalIndex} height={1}>
						<Text
							color={isSelected ? theme.colors.menuSelected : theme.colors.menuNormal}
							bold={isSelected}
							wrap="truncate"
						>
							{isSelected ? '❯ ' : '  '}
							{item.label}
						</Text>
						{item.fileCount > 0 && (
							<Text color="yellow" dimColor>
								{' '}[{item.fileCount} files]
							</Text>
						)}
					</Box>
				);
			})}

			{hasMoreBelow && (
				<Box height={1}>
					<Text color="gray" dimColor>↓ {userMessages.length - endIndex} more below</Text>
				</Box>
			)}
		</Box>
	);
}
