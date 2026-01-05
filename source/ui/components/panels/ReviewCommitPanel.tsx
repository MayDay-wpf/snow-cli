import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {reviewAgent} from '../../../agents/reviewAgent.js';

export type ReviewCommitSelection =
	| {type: 'staged'}
	| {type: 'unstaged'}
	| {type: 'commit'; sha: string};

type CommitItem = {
	sha: string;
	subject: string;
	authorName: string;
	dateIso: string;
};

type Props = {
	visible: boolean;
	onClose: () => void;
	onConfirm: (selection: ReviewCommitSelection[], notes: string) => void;
	maxHeight?: number;
};

const VISIBLE_ITEMS = 6;
const PAGE_SIZE = 30;

function formatShortSha(sha: string): string {
	return sha.slice(0, 8);
}

function formatDate(isoDate: string): string {
	// Keep it simple and stable; show YYYY-MM-DD
	const match = isoDate.match(/^(\d{4}-\d{2}-\d{2})/);
	return match?.[1] ?? isoDate;
}

function truncateText(text: string, maxLen: number): string {
	if (maxLen <= 0) return '';
	if (text.length <= maxLen) return text;
	if (maxLen === 1) return '…';
	return text.slice(0, Math.max(1, maxLen - 1)) + '…';
}

export default function ReviewCommitPanel({
	visible,
	onClose,
	onConfirm,
	maxHeight,
}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const effectiveVisibleItems = maxHeight
		? Math.max(3, Math.min(maxHeight, VISIBLE_ITEMS))
		: VISIBLE_ITEMS;

	const [loading, setLoading] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [gitRoot, setGitRoot] = useState<string | null>(null);

	const [commits, setCommits] = useState<CommitItem[]>([]);
	const [hasMore, setHasMore] = useState(true);
	const [skip, setSkip] = useState(0);

	const [selectedIndex, setSelectedIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const [checked, setChecked] = useState<Set<string>>(new Set());

	const [hasStaged, setHasStaged] = useState(false);
	const [hasUnstaged, setHasUnstaged] = useState(false);
	const [stagedFileCount, setStagedFileCount] = useState(0);
	const [unstagedFileCount, setUnstagedFileCount] = useState(0);

	const [notes, setNotes] = useState('');

	const items = useMemo(() => {
		const base: Array<
			{kind: 'staged'} | {kind: 'unstaged'} | {kind: 'commit'; item: CommitItem}
		> = [];
		if (hasStaged) {
			base.push({kind: 'staged'});
		}
		if (hasUnstaged) {
			base.push({kind: 'unstaged'});
		}
		for (const c of commits) {
			base.push({kind: 'commit', item: c});
		}
		return base;
	}, [commits, hasStaged, hasUnstaged]);

	const canNavigate = visible && !loading && items.length > 0;

	const loadFirstPage = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const gitCheck = reviewAgent.checkGitRepository();
			if (!gitCheck.isGitRepo || !gitCheck.gitRoot) {
				setError(gitCheck.error || 'Not a git repository');
				setGitRoot(null);
				setCommits([]);
				setHasMore(false);
				return;
			}

			setGitRoot(gitCheck.gitRoot);

			// Check working tree status
			const status = reviewAgent.getWorkingTreeStatus(gitCheck.gitRoot);
			setHasStaged(status.hasStaged);
			setHasUnstaged(status.hasUnstaged);
			setStagedFileCount(status.stagedFileCount);
			setUnstagedFileCount(status.unstagedFileCount);

			const result = reviewAgent.listCommitsPaginated(
				gitCheck.gitRoot,
				0,
				PAGE_SIZE,
			);
			setCommits(result.commits);
			setHasMore(result.hasMore);
			setSkip(result.nextSkip);
			setSelectedIndex(0);
			setScrollOffset(0);
			setChecked(new Set());
			setNotes('');
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to load commits');
			setCommits([]);
			setHasMore(false);
			setGitRoot(null);
		} finally {
			setLoading(false);
		}
	}, []);

	const loadMore = useCallback(async () => {
		if (!gitRoot) return;
		if (loadingMore || !hasMore) return;

		setLoadingMore(true);
		try {
			const result = reviewAgent.listCommitsPaginated(gitRoot, skip, PAGE_SIZE);
			setCommits(prev => [...prev, ...result.commits]);
			setHasMore(result.hasMore);
			setSkip(result.nextSkip);
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Failed to load more commits');
		} finally {
			setLoadingMore(false);
		}
	}, [gitRoot, hasMore, loadingMore, skip]);

	useEffect(() => {
		if (!visible) return;
		void loadFirstPage();
	}, [visible, loadFirstPage]);

	useInput(
		(input, key) => {
			if (!visible) return;

			if (key.escape) {
				onClose();
				return;
			}

			if (loading) return;

			if (key.upArrow && canNavigate) {
				setSelectedIndex(prev => {
					const next = prev > 0 ? prev - 1 : items.length - 1;
					if (next < scrollOffset) {
						setScrollOffset(next);
					} else if (next === items.length - 1) {
						setScrollOffset(Math.max(0, items.length - effectiveVisibleItems));
					}
					return next;
				});
				return;
			}

			if (key.downArrow && canNavigate) {
				setSelectedIndex(prev => {
					const next = prev < items.length - 1 ? prev + 1 : 0;

					if (
						hasMore &&
						!loadingMore &&
						next >= items.length - 4 &&
						next !== 0
					) {
						void loadMore();
					}

					if (next >= scrollOffset + effectiveVisibleItems) {
						setScrollOffset(next - effectiveVisibleItems + 1);
					} else if (next === 0) {
						setScrollOffset(0);
					}

					return next;
				});
				return;
			}

			if (input === ' ' && canNavigate) {
				const current = items[selectedIndex];
				if (!current) return;

				const keyId =
					current.kind === 'staged'
						? 'staged'
						: current.kind === 'unstaged'
						? 'unstaged'
						: current.item.sha;

				setChecked(prev => {
					const next = new Set(prev);
					if (next.has(keyId)) next.delete(keyId);
					else next.add(keyId);
					return next;
				});
				return;
			}

			if (key.return) {
				const selection: ReviewCommitSelection[] = [];
				if (checked.has('staged')) {
					selection.push({type: 'staged'});
				}
				if (checked.has('unstaged')) {
					selection.push({type: 'unstaged'});
				}
				for (const c of commits) {
					if (checked.has(c.sha)) {
						selection.push({type: 'commit', sha: c.sha});
					}
				}

				if (selection.length === 0) {
					setError(t.reviewCommitPanel.errorSelectAtLeastOne);
					return;
				}

				onConfirm(selection, notes.trim());
				return;
			}

			// Notes input
			if (key.backspace || key.delete) {
				setNotes(prev => prev.slice(0, -1));
				return;
			}

			if (
				input &&
				!key.ctrl &&
				!key.meta &&
				!key.tab &&
				!key.upArrow &&
				!key.downArrow &&
				!key.leftArrow &&
				!key.rightArrow
			) {
				setNotes(prev => prev + input);
			}
		},
		{isActive: visible},
	);

	const visibleItems = items.slice(
		scrollOffset,
		scrollOffset + effectiveVisibleItems,
	);

	if (!visible) return null;

	if (loading) {
		return (
			<Box flexDirection="column" width="100%">
				<Text color={theme.colors.warning} bold>
					{t.reviewCommitPanel.title}
				</Text>
				<Box marginTop={1}>
					<Alert variant="info">{t.reviewCommitPanel.loadingCommits}</Alert>
				</Box>
			</Box>
		);
	}

	if (error) {
		return (
			<Box flexDirection="column" width="100%">
				<Text color={theme.colors.warning} bold>
					{t.reviewCommitPanel.title}
				</Text>
				<Box marginTop={1}>
					<Alert variant="warning">{error}</Alert>
				</Box>
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.reviewCommitPanel.hintEscClose}
					</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" width="100%">
			<Text color={theme.colors.warning} bold>
				{t.reviewCommitPanel.title}
				{items.length > effectiveVisibleItems
					? ` (${selectedIndex + 1}/${items.length})`
					: ''}
				{loadingMore ? ` ${t.reviewCommitPanel.loadingMoreSuffix}` : ''}
			</Text>
			<Box marginTop={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.reviewCommitPanel.hintNavigation}
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				{visibleItems.map((it, idx) => {
					const absoluteIndex = scrollOffset + idx;
					const isActive = absoluteIndex === selectedIndex;
					const keyId =
						it.kind === 'staged'
							? 'staged'
							: it.kind === 'unstaged'
							? 'unstaged'
							: it.item.sha;
					const isChecked = checked.has(keyId);

					const title =
						it.kind === 'staged'
							? `${t.reviewCommitPanel.stagedLabel} (${stagedFileCount} ${t.reviewCommitPanel.filesLabel})`
							: it.kind === 'unstaged'
							? `${t.reviewCommitPanel.unstagedLabel} (${unstagedFileCount} ${t.reviewCommitPanel.filesLabel})`
							: `${formatShortSha(it.item.sha)} ${truncateText(
									it.item.subject,
									72,
							  )}`;

					const subtitle =
						it.kind === 'staged' || it.kind === 'unstaged'
							? ''
							: `${truncateText(it.item.authorName, 24)} · ${formatDate(
									it.item.dateIso,
							  )}`;

					return (
						<Box key={keyId} flexDirection="column" width="100%">
							<Text
								color={
									isActive ? theme.colors.menuSelected : theme.colors.menuNormal
								}
							>
								{isActive ? '> ' : '  '}
								{isChecked ? '[✓] ' : '[ ] '}
								{title}
							</Text>
							{subtitle ? (
								<Text
									color={
										isActive
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									dimColor={!isActive}
								>
									{subtitle}
								</Text>
							) : null}
						</Box>
					);
				})}
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text color={theme.colors.menuInfo}>
					{t.reviewCommitPanel.notesLabel}:{' '}
					{notes || t.reviewCommitPanel.notesOptional}
				</Text>
				{checked.size > 0 && (
					<Text color={theme.colors.menuInfo}>
						{t.reviewCommitPanel.selectedLabel}: {checked.size}
					</Text>
				)}
			</Box>
		</Box>
	);
}
