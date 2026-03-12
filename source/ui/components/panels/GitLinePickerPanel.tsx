import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import type {GitLineCommit} from '../../../hooks/picker/useGitLinePicker.js';

interface Props {
	commits: GitLineCommit[];
	selectedIndex: number;
	selectedCommits: Set<string>;
	visible: boolean;
	maxHeight?: number;
	hasMore?: boolean;
	isLoading?: boolean;
	isLoadingMore?: boolean;
	searchQuery?: string;
	error?: string | null;
}

const MAX_DISPLAY_ITEMS = 5;

function formatShortSha(sha: string): string {
	return sha.slice(0, 8);
}

function formatDate(isoDate: string): string {
	const match = isoDate.match(/^(\d{4}-\d{2}-\d{2})/);
	return match?.[1] ?? isoDate;
}

function truncateText(text: string, maxLen: number): string {
	if (maxLen <= 0) return '';
	if (text.length <= maxLen) return text;
	if (maxLen === 1) return '…';
	return text.slice(0, Math.max(1, maxLen - 1)) + '…';
}

const GitLinePickerPanel = memo(
	({
		commits,
		selectedIndex,
		selectedCommits,
		visible,
		maxHeight,
		hasMore = false,
		isLoading = false,
		isLoadingMore = false,
		searchQuery = '',
		error = null,
	}: Props) => {
		const {t} = useI18n();
		const {theme} = useTheme();
		const effectiveMaxItems = maxHeight
			? Math.min(maxHeight, MAX_DISPLAY_ITEMS)
			: MAX_DISPLAY_ITEMS;

		const displayWindow = useMemo(() => {
			if (commits.length <= effectiveMaxItems) {
				return {
					items: commits,
					startIndex: 0,
					endIndex: commits.length,
				};
			}

			const halfWindow = Math.floor(effectiveMaxItems / 2);
			let startIndex = Math.max(0, selectedIndex - halfWindow);
			let endIndex = Math.min(commits.length, startIndex + effectiveMaxItems);
			if (endIndex - startIndex < effectiveMaxItems) {
				startIndex = Math.max(0, endIndex - effectiveMaxItems);
			}

			return {
				items: commits.slice(startIndex, endIndex),
				startIndex,
				endIndex,
			};
		}, [commits, selectedIndex, effectiveMaxItems]);

		const displayedCommits = displayWindow.items;
		const hiddenAboveCount = displayWindow.startIndex;
		const hiddenBelowCount = Math.max(
			0,
			commits.length - displayWindow.endIndex,
		);

		const displayedSelectedIndex = useMemo(() => {
			return displayedCommits.findIndex(commit => {
				const originalIndex = commits.indexOf(commit);
				return originalIndex === selectedIndex;
			});
		}, [displayedCommits, commits, selectedIndex]);

		if (!visible) {
			return null;
		}

		if (isLoading) {
			return (
				<Box flexDirection="column">
					<Text color={theme.colors.warning} bold>
						{t.gitLinePickerPanel.title}
					</Text>
					<Box marginTop={1}>
						<Alert variant="info">{t.gitLinePickerPanel.loadingCommits}</Alert>
					</Box>
				</Box>
			);
		}

		if (error) {
			return (
				<Box flexDirection="column">
					<Text color={theme.colors.warning} bold>
						{t.gitLinePickerPanel.title}
					</Text>
					<Box marginTop={1}>
						<Alert variant="error">{error}</Alert>
					</Box>
				</Box>
			);
		}

		if (commits.length === 0) {
			return (
				<Box flexDirection="column">
					<Text color={theme.colors.warning} bold>
						{t.gitLinePickerPanel.title}
					</Text>
					<Box marginTop={1}>
						<Alert variant="info">{t.gitLinePickerPanel.noCommits}</Alert>
					</Box>
				</Box>
			);
		}

		return (
			<Box flexDirection="column">
				<Box>
					<Text color={theme.colors.warning} bold>
						{t.gitLinePickerPanel.title}{' '}
						{commits.length > effectiveMaxItems &&
							`(${selectedIndex + 1}/${commits.length})`}
						{isLoadingMore ? ` ${t.gitLinePickerPanel.loadingMoreSuffix}` : ''}
					</Text>
				</Box>
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.colors.menuInfo}>
						{t.gitLinePickerPanel.searchLabel}{' '}
						<Text color={theme.colors.menuSelected}>
							{searchQuery || t.gitLinePickerPanel.emptySearch}
						</Text>
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.gitLinePickerPanel.hintNavigation}
					</Text>
				</Box>
				<Box marginTop={1} flexDirection="column">
					{displayedCommits.map((commit, index) => {
						const isSelected = index === displayedSelectedIndex;
						const isChecked = selectedCommits.has(commit.sha);
						const subject = truncateText(commit.subject, 72);

						return (
							<Box key={commit.sha} flexDirection="column" width="100%">
								<Text
									color={
										isSelected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold
								>
									{isSelected ? '❯ ' : '  '}
									{isChecked ? '[✓]' : '[ ]'} {formatShortSha(commit.sha)}{' '}
									{subject}
								</Text>
								<Box marginLeft={5}>
									<Text
										color={
											isSelected
												? theme.colors.menuSelected
												: theme.colors.menuNormal
										}
										dimColor={!isSelected}
									>
										└─ {commit.authorName} · {formatDate(commit.dateIso)}
									</Text>
								</Box>
							</Box>
						);
					})}
				</Box>
				{(commits.length > effectiveMaxItems || hasMore) && (
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.commandPanel.scrollHint}
							{hiddenAboveCount > 0 && (
								<>
									·{' '}
									{t.commandPanel.moreAbove.replace(
										'{count}',
										hiddenAboveCount.toString(),
									)}
								</>
							)}
							{hiddenBelowCount > 0 && (
								<>
									·{' '}
									{t.commandPanel.moreBelow.replace(
										'{count}',
										hiddenBelowCount.toString(),
									)}
								</>
							)}
							{hasMore && <>· {t.gitLinePickerPanel.scrollToLoadMore}</>}
						</Text>
					</Box>
				)}
				{selectedCommits.size > 0 && (
					<Box marginTop={1}>
						<Text color={theme.colors.menuInfo}>
							{t.gitLinePickerPanel.selectedLabel}: {selectedCommits.size}
						</Text>
					</Box>
				)}
			</Box>
		);
	},
);

GitLinePickerPanel.displayName = 'GitLinePickerPanel';

export default GitLinePickerPanel;
