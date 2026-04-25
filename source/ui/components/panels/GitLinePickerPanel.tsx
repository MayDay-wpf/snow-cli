import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import type {GitLineCommit} from '../../../hooks/picker/useGitLinePicker.js';
import PickerList from '../common/PickerList.js';

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
			<PickerList
				items={commits}
				selectedIndex={selectedIndex}
				visible={visible}
				maxDisplayItems={maxHeight}
				getItemKey={(commit: GitLineCommit) => commit.sha}
				title={
					<Text color={theme.colors.warning} bold>
						{t.gitLinePickerPanel.title}{' '}
						{commits.length > 5 &&
							`(${selectedIndex + 1}/${commits.length})`}
						{isLoadingMore
							? ` ${t.gitLinePickerPanel.loadingMoreSuffix}`
							: ''}
					</Text>
				}
				header={
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
				}
				footer={
					selectedCommits.size > 0 ? (
						<Box marginTop={1}>
							<Text color={theme.colors.menuInfo}>
								{t.gitLinePickerPanel.selectedLabel}:{' '}
								{selectedCommits.size}
							</Text>
						</Box>
					) : undefined
				}
				scrollHintFormat={(above, below) => (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.commandPanel.scrollHint}
						{above > 0 && (
							<>
								·{' '}
								{t.commandPanel.moreAbove.replace(
									'{count}',
									above.toString(),
								)}
							</>
						)}
						{below > 0 && (
							<>
								·{' '}
								{t.commandPanel.moreBelow.replace(
									'{count}',
									below.toString(),
								)}
							</>
						)}
						{hasMore && <>· {t.gitLinePickerPanel.scrollToLoadMore}</>}
					</Text>
				)}
				renderItem={(commit: GitLineCommit, isSelected: boolean) => {
					const isChecked = selectedCommits.has(commit.sha);
					const title =
						commit.kind === 'staged'
							? `${t.reviewCommitPanel.stagedLabel} (${
									commit.fileCount ?? 0
							  } ${t.reviewCommitPanel.filesLabel})`
							: `${formatShortSha(commit.sha)} ${truncateText(
									commit.subject,
									72,
							  )}`;
					const subtitle =
						commit.kind === 'staged'
							? ''
							: `${commit.authorName} · ${formatDate(commit.dateIso)}`;

					return (
						<>
							<Box overflow="hidden">
								<Text
									color={
										isSelected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold
									wrap="truncate-end"
								>
									{isSelected ? '❯ ' : '  '}
									{isChecked ? '[✓]' : '[ ]'} {title}
								</Text>
							</Box>
							{subtitle ? (
								<Box marginLeft={5} overflow="hidden">
									<Text
										color={
											isSelected
												? theme.colors.menuSelected
												: theme.colors.menuNormal
										}
										dimColor={!isSelected}
										wrap="truncate-end"
									>
										└─ {subtitle}
									</Text>
								</Box>
							) : null}
						</>
					);
				}}
			/>
		);
	},
);

GitLinePickerPanel.displayName = 'GitLinePickerPanel';

export default GitLinePickerPanel;
