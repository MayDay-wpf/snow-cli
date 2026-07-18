import React, {useState, useEffect, useCallback, useMemo, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import {hashBasedSnapshotManager} from '../../../utils/codebase/hashBasedSnapshot.js';
import {convertSessionMessagesToUI} from '../../../utils/session/sessionConverter.js';
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
	terminalWidth?: number;
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
	terminalWidth,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [busy, setBusy] = useState(false);
	// When true, the unmount cleanup will NOT send closeDiff to VSCode,
	// so the multi-file diff review opened via showDiffReview can stay visible.
	const skipCloseOnUnmountRef = useRef(false);
	// Real (deduplicated) file count per snapshot index. snapshotFileCount
	// from props sums per-snapshot file counts which double-counts the same
	// file modified across multiple snapshots; getFilesToRollback returns a
	// deduplicated list of relative paths and is the source of truth.
	const [dedupedFileCount, setDedupedFileCount] = useState<Map<number, number>>(
		new Map(),
	);

	// File list mode state
	const [viewMode, setViewMode] = useState<ViewMode>('messages');
	const [filePaths, setFilePaths] = useState<string[]>([]);
	const [fileHighlightIndex, setFileHighlightIndex] = useState(0);
	const [fileScrollIndex, setFileScrollIndex] = useState(0);
	const [activeMessageIndex, setActiveMessageIndex] = useState<number | null>(
		null,
	);

	const VISIBLE_ITEMS = 5;
	const MAX_VISIBLE_FILES = 10;

	const userMessages: MessageItem[] = useMemo(() => {
		const items: MessageItem[] = [];
		let userMsgIndex = 0;

		const currentSession = sessionManager.getCurrentSession();
		const uiMessages = currentSession
			? convertSessionMessagesToUI(currentSession.messages)
			: null;

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

				let snapshotIdx = i;
				if (uiMessages) {
					const ordinal = userMsgIndex + 1;
					let count = 0;
					for (let j = 0; j < uiMessages.length; j++) {
						const um = uiMessages[j];
						if (
							um?.role === 'user' &&
							um.content?.trim() &&
							!um.subAgentDirected
						) {
							count++;
							if (count === ordinal) {
								snapshotIdx = j;
								break;
							}
						}
					}
				}

				// Prefer the real deduplicated count (computed via
				// getFilesToRollback in the effect below). Fall back to the
				// summed prop value while the async dedupe is still loading
				// so the UI doesn't flash empty.
				let totalFileCount: number;
				if (dedupedFileCount.has(snapshotIdx)) {
					totalFileCount = dedupedFileCount.get(snapshotIdx) ?? 0;
				} else {
					totalFileCount = 0;
					for (const [idx, count] of snapshotFileCount.entries()) {
						if (idx >= snapshotIdx) {
							totalFileCount += count;
						}
					}
				}

				items.push({
					label: `${userMsgIndex + 1}. ${cleanContent.slice(0, 60)}${
						cleanContent.length > 60 ? '...' : ''
					}`,
					originalIndex: i,
					fileCount: totalFileCount,
				});
				userMsgIndex++;
			}
		}
		return items;
	}, [messages, snapshotFileCount, dedupedFileCount]);

	// (resolveSnapshotIdx is defined further below; the dedupe effect lives
	// after that definition so we can reuse it.)

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
			if (skipCloseOnUnmountRef.current) return;
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
				.getRollbackPreviewForFile(
					currentSession.id,
					activeMessageIndex,
					filePath,
				)
				.then(async preview => {
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
	}, [
		fileHighlightIndex,
		viewMode,
		filePaths,
		activeMessageIndex,
		closeDiffPreview,
	]);

	const resolveSnapshotIdx = useCallback(
		(liveIndex: number): number => {
			const session = sessionManager.getCurrentSession();
			if (!session) return liveIndex;
			const converted = convertSessionMessagesToUI(session.messages);
			let userOrdinal = 0;
			for (let i = 0; i <= liveIndex && i < messages.length; i++) {
				const m = messages[i];
				if (m?.role === 'user' && m.content?.trim() && !m.subAgentDirected) {
					userOrdinal++;
				}
			}
			if (userOrdinal === 0) return 0;
			let count = 0;
			for (let i = 0; i < converted.length; i++) {
				const m = converted[i];
				if (m?.role === 'user' && m.content?.trim() && !m.subAgentDirected) {
					count++;
					if (count === userOrdinal) return i;
				}
			}
			return liveIndex;
		},
		[messages],
	);

	// Asynchronously compute deduplicated file counts via getFilesToRollback
	// for every visible user message. snapshotFileCount sums per-snapshot
	// file counts which double-counts the same file modified across multiple
	// snapshots; getFilesToRollback returns a deduplicated relative-path list
	// and is the authoritative count we want to display.
	useEffect(() => {
		const session = sessionManager.getCurrentSession();
		if (!session) return;
		let cancelled = false;

		const targets: number[] = [];
		const seen = new Set<number>();
		for (let i = 0; i < messages.length; i++) {
			const msg = messages[i];
			if (
				msg &&
				msg.role === 'user' &&
				msg.content.trim() &&
				!msg.subAgentDirected
			) {
				const sIdx = resolveSnapshotIdx(i);
				if (!seen.has(sIdx)) {
					seen.add(sIdx);
					targets.push(sIdx);
				}
			}
		}

		(async () => {
			const next = new Map<number, number>();
			for (const sIdx of targets) {
				try {
					const files = await hashBasedSnapshotManager.getFilesToRollback(
						session.id,
						sIdx,
					);
					next.set(sIdx, files.length);
				} catch {
					next.set(sIdx, 0);
				}
				if (cancelled) return;
			}
			if (cancelled) return;
			setDedupedFileCount(next);
		})();

		return () => {
			cancelled = true;
		};
	}, [messages, snapshotFileCount, resolveSnapshotIdx]);

	// Load file list when Tab is pressed on a message
	const loadFileList = useCallback(
		async (messageIndex: number) => {
			const currentSession = sessionManager.getCurrentSession();
			if (!currentSession) return;

			const sIdx = resolveSnapshotIdx(messageIndex);
			const files = await hashBasedSnapshotManager.getFilesToRollback(
				currentSession.id,
				sIdx,
			);
			setFilePaths(files);
			setFileHighlightIndex(0);
			setFileScrollIndex(0);
			setActiveMessageIndex(sIdx);
			setViewMode('files');
		},
		[resolveSnapshotIdx],
	);

	// Send all diffs to IDE (snapshotIdx is already in snapshot coordinate space)
	const handleSelectSnapshot = useCallback(
		async (snapshotIdx: number) => {
			setBusy(true);
			try {
				const currentSession = sessionManager.getCurrentSession();
				if (!currentSession || !vscodeConnection.isConnected()) {
					onClose();
					return;
				}

				const allFiles = await hashBasedSnapshotManager.getFilesToRollback(
					currentSession.id,
					snapshotIdx,
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
								snapshotIdx,
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
					// Mark before sending so the unmount cleanup triggered by
					// onClose() below will NOT close the diffs we just opened.
					skipCloseOnUnmountRef.current = true;
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
						setFileScrollIndex(
							Math.min(maxScroll, newIdx - MAX_VISIBLE_FILES + 1),
						);
					}
					return newIdx;
				});
				return;
			}

			// Enter in file mode: send all diffs (activeMessageIndex is already snapshot-space)
			if (key.return && activeMessageIndex !== null) {
				// Do NOT call closeDiffPreview here — it would close the
				// multi-file diffs that handleSelectSnapshot is about to open
				// (showDiff and closeDiff share the same activeDiffEditors list
				// on the VSCode side, so a close right before showDiffReview
				// races with the editors being created).
				void handleSelectSnapshot(activeMessageIndex);
				return;
			}
			return;
		}

		// Message list navigation
		if (key.upArrow) {
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : userMessages.length - 1));
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev => (prev < userMessages.length - 1 ? prev + 1 : 0));
			return;
		}

		if (key.return && userMessages.length > 0) {
			const selected = userMessages[selectedIndex];
			if (selected) {
				void handleSelectSnapshot(resolveSnapshotIdx(selected.originalIndex));
			}
			return;
		}
	});

	const dividerWidth = Math.max(1, (terminalWidth ?? 80) - 2);
	const divider = '─'.repeat(dividerWidth);

	if (userMessages.length === 0) {
		return (
			<Box flexDirection="column">
				<Text dimColor>{divider}</Text>
				<Box flexDirection="column" paddingX={1}>
					<Text color={theme.colors.menuSelected}>
						{t.diffReviewPanel.title}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.diffReviewPanel.noSnapshots}
					</Text>
				</Box>
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
			<Box flexDirection="column">
				<Text dimColor>{divider}</Text>
				<Box flexDirection="column" paddingX={1}>
					<Text color={theme.colors.menuSelected}>
						{t.diffReviewPanel.title} -{' '}
						{t.diffReviewPanel.filesSuffix.replace(
							'{count}',
							String(filePaths.length),
						)}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.diffReviewPanel.filesViewNavigationHint}
					</Text>

					{hasMoreAbove && (
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.diffReviewPanel.moreAbove.replace(
								'{count}',
								String(fileScrollIndex),
							)}
						</Text>
					)}
					{displayFiles.map((file, idx) => {
						const actualIdx = fileScrollIndex + idx;
						const isHighlighted = actualIdx === fileHighlightIndex;
						return (
							<Box key={file} height={1}>
								<Text
									color={
										isHighlighted
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
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
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.diffReviewPanel.moreBelow.replace(
								'{count}',
								String(filePaths.length - fileScrollIndex - MAX_VISIBLE_FILES),
							)}
						</Text>
					)}
				</Box>
			</Box>
		);
	}
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
		<Box flexDirection="column">
			<Text dimColor>{divider}</Text>
			<Box flexDirection="column" paddingX={1}>
				<Text color={theme.colors.menuSelected}>
					{t.diffReviewPanel.title} ({selectedIndex + 1}/{userMessages.length})
				</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.diffReviewPanel.navigationHint}
				</Text>

				{hasMoreAbove && (
					<Box height={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.diffReviewPanel.moreAbove.replace(
								'{count}',
								String(startIndex),
							)}
						</Text>
					</Box>
				)}

				{visibleMessages.map((item, displayIndex) => {
					const actualIndex = startIndex + displayIndex;
					const isSelected = actualIndex === selectedIndex;
					return (
						<Box key={item.originalIndex} height={1}>
							<Text
								color={
									isSelected
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={isSelected}
								wrap="truncate"
							>
								{isSelected ? '❯ ' : '  '}
								{item.label}
							</Text>
							{item.fileCount > 0 && (
								<Text color={theme.colors.warning} dimColor>
									{' '}
									[
									{t.diffReviewPanel.filesSuffix.replace(
										'{count}',
										String(item.fileCount),
									)}
									]
								</Text>
							)}
						</Box>
					);
				})}

				{hasMoreBelow && (
					<Box height={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.diffReviewPanel.moreBelow.replace(
								'{count}',
								String(userMessages.length - endIndex),
							)}
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	);
}
