import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import PickerList from '../common/PickerList.js';
import {
	ALL_CLEANUP_CATEGORY_IDS,
	CLEANUP_DAY_OPTIONS,
	deleteOlderThan,
	deleteProjectData,
	formatBytes,
	getCleanupCategories,
	scanCleanupOverview,
	scanOlderThanBuckets,
	scanProjects,
	type CleanupCategoryId,
	type CleanupDeleteResult,
	type CleanupProjectInfo,
	type SizeStats,
} from '../../../utils/core/cleanupService.js';

type Props = {
	onClose: () => void;
};

type Mode = 'menu' | 'byProject' | 'byAge';

type PendingAction =
	| {type: 'projects'; projectIds: string[]}
	| {type: 'age'; days: number};

const EMPTY_STATS: SizeStats = {files: 0, bytes: 0};

export default function CleanupPanel({onClose}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const labels = t.cleanupPanel;

	const [mode, setMode] = useState<Mode>('menu');
	const [menuIndex, setMenuIndex] = useState(0);
	const [loading, setLoading] = useState(true);
	const [projects, setProjects] = useState<CleanupProjectInfo[]>([]);
	const [overview, setOverview] = useState<SizeStats>(EMPTY_STATS);
	const [overviewCategories, setOverviewCategories] = useState<
		Partial<Record<CleanupCategoryId, SizeStats>>
	>({});
	const [ageBuckets, setAgeBuckets] = useState<SizeStats[]>([]);
	const [projectIndex, setProjectIndex] = useState(0);
	const [markedProjects, setMarkedProjects] = useState<Set<string>>(new Set());
	const [ageIndex, setAgeIndex] = useState(0);
	const [pending, setPending] = useState<PendingAction | null>(null);
	const [deleting, setDeleting] = useState(false);
	const [result, setResult] = useState<CleanupDeleteResult | null>(null);

	const projectScopedCategories = useMemo(
		() => getCleanupCategories('project').map(category => category.id),
		[],
	);

	/**
	 * 一次性重算所有统计数据。
	 * 扫描成本较高（需要遍历整个 ~/.snow），因此只在挂载和删除完成后调用，
	 * 绝不在 render 路径上直接调用，避免每次按键都全盘扫描。
	 */
	const reload = useCallback(() => {
		const overviewSnapshot = scanCleanupOverview();
		setProjects(scanProjects());
		setOverview(overviewSnapshot.total);
		setOverviewCategories(overviewSnapshot.categories);
		setAgeBuckets(
			scanOlderThanBuckets(CLEANUP_DAY_OPTIONS, ALL_CLEANUP_CATEGORY_IDS),
		);
		setMarkedProjects(new Set());
		setProjectIndex(0);
		setAgeIndex(0);
	}, []);

	useEffect(() => {
		reload();
		setLoading(false);
	}, [reload]);

	const selectedDays = CLEANUP_DAY_OPTIONS[ageIndex] ?? 7;
	const selectedAgeStats = ageBuckets[ageIndex] ?? EMPTY_STATS;

	const closeAll = useCallback(() => {
		setResult(null);
		setPending(null);
		setMode('menu');
		setMenuIndex(0);
	}, []);

	const runDelete = useCallback(
		(action: PendingAction) => {
			setDeleting(true);
			setPending(null);

			try {
				const deleteResult =
					action.type === 'projects'
						? deleteProjectData(action.projectIds, projectScopedCategories)
						: deleteOlderThan(action.days, ALL_CLEANUP_CATEGORY_IDS);

				setResult(deleteResult);
				reload();
			} finally {
				setDeleting(false);
			}
		},
		[projectScopedCategories, reload],
	);

	useInput(
		useCallback(
			(input, key) => {
				if (deleting) {
					return;
				}

				// 结果页：任意键返回菜单
				if (result) {
					if (key.escape || key.return || input) {
						closeAll();
					}

					return;
				}

				// 删除确认页
				if (pending) {
					if (key.escape) {
						setPending(null);
						return;
					}

					if (input.toLowerCase() === 'y') {
						runDelete(pending);
					} else if (input.toLowerCase() === 'n') {
						setPending(null);
					}

					return;
				}

				if (key.escape) {
					if (mode === 'menu') {
						onClose();
					} else {
						setMode('menu');
					}

					return;
				}

				if (mode === 'menu') {
					if (key.upArrow) {
						setMenuIndex(prev => Math.max(0, prev - 1));
						return;
					}

					if (key.downArrow) {
						setMenuIndex(prev => Math.min(1, prev + 1));
						return;
					}

					if (key.return) {
						setMode(menuIndex === 0 ? 'byProject' : 'byAge');
						setResult(null);
					}

					return;
				}

				if (mode === 'byProject') {
					if (key.upArrow) {
						setProjectIndex(prev => Math.max(0, prev - 1));
						return;
					}

					if (key.downArrow) {
						setProjectIndex(prev =>
							Math.min(Math.max(0, projects.length - 1), prev + 1),
						);
						return;
					}

					if (input === ' ' && projects.length > 0) {
						const current = projects[projectIndex];
						if (current) {
							setMarkedProjects(prev => {
								const next = new Set(prev);
								if (next.has(current.projectId)) {
									next.delete(current.projectId);
								} else {
									next.add(current.projectId);
								}

								return next;
							});
						}

						return;
					}

					if (input.toLowerCase() === 'a' && projects.length > 0) {
						setMarkedProjects(prev =>
							prev.size === projects.length
								? new Set()
								: new Set(projects.map(project => project.projectId)),
						);
						return;
					}

					if (input.toLowerCase() === 'd' && markedProjects.size > 0) {
						setPending({
							type: 'projects',
							projectIds: [...markedProjects],
						});
					}

					return;
				}

				if (mode === 'byAge') {
					if (key.upArrow) {
						setAgeIndex(prev => Math.max(0, prev - 1));
						return;
					}

					if (key.downArrow) {
						setAgeIndex(prev =>
							Math.min(CLEANUP_DAY_OPTIONS.length - 1, prev + 1),
						);
						return;
					}

					if (input.toLowerCase() === 'd') {
						setPending({type: 'age', days: selectedDays});
					}
				}
			},
			[
				deleting,
				result,
				pending,
				mode,
				menuIndex,
				projects,
				projectIndex,
				markedProjects,
				selectedDays,
				onClose,
				closeAll,
				runDelete,
			],
		),
	);

	const renderCategorySummary = useCallback(
		(stats: Partial<Record<CleanupCategoryId, SizeStats>>): React.ReactNode => {
			const items = ALL_CLEANUP_CATEGORY_IDS.filter(
				id => (stats[id]?.files ?? 0) > 0,
			).map(id => {
				const label = labels.categories[id];
				const size = formatBytes(stats[id]?.bytes ?? 0);
				return `${label} ${size}`;
			});

			if (items.length === 0) {
				return null;
			}

			return (
				<Box marginLeft={3}>
					<Text color={theme.colors.menuSecondary} dimColor wrap="truncate-end">
						{items.join(' · ')}
					</Text>
				</Box>
			);
		},
		[labels, theme.colors.menuSecondary],
	);

	const header = (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={theme.colors.menuSelected} bold>
				{labels.title}
			</Text>
			<Text color={theme.colors.menuSecondary} dimColor>
				{labels.totalUsage.replace('{size}', formatBytes(overview.bytes))}
			</Text>
		</Box>
	);

	const footer = (
		<Box marginTop={1} flexDirection="column">
			<Text color={theme.colors.menuSecondary} dimColor>
				{mode === 'menu'
					? labels.menuHint
					: mode === 'byProject'
					? labels.byProjectHint
					: labels.byAgeHint}
			</Text>
		</Box>
	);

	// 删除中
	if (deleting) {
		return (
			<Box flexDirection="column" paddingX={1}>
				{header}
				<Text color={theme.colors.warning}>{labels.deleting}</Text>
			</Box>
		);
	}

	// 删除结果
	if (result) {
		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				<Text color={theme.colors.success} bold>
					{labels.resultTitle}
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.colors.text}>
						{labels.resultSummary
							.replace('{files}', result.deletedFiles.toString())
							.replace('{size}', formatBytes(result.deletedBytes))}
					</Text>
					{result.errors.length > 0 && (
						<Box marginTop={1} flexDirection="column">
							<Text color={theme.colors.error}>
								{labels.resultErrors.replace(
									'{count}',
									result.errors.length.toString(),
								)}
							</Text>
							{result.errors.slice(0, 3).map(error => (
								<Text key={error} color={theme.colors.error} dimColor>
									{'  '}
									{error}
								</Text>
							))}
						</Box>
					)}
				</Box>
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{labels.resultHint}
					</Text>
				</Box>
			</Box>
		);
	}

	// 确认页
	if (pending) {
		const projectNames =
			pending.type === 'projects'
				? projects
						.filter(project => pending.projectIds.includes(project.projectId))
						.map(project => project.displayName)
				: [];
		const message =
			pending.type === 'projects'
				? labels.confirmProjects
						.replace('{count}', pending.projectIds.length.toString())
						.replace(
							'{names}',
							projectNames.length > 0 ? `(${projectNames.join(', ')})` : '',
						)
				: labels.confirmAge
						.replace('{days}', pending.days.toString())
						.replace(
							'{size}',
							formatBytes(
								ageBuckets[CLEANUP_DAY_OPTIONS.indexOf(pending.days)]?.bytes ??
									0,
							),
						);

		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				<Text color={theme.colors.warning} bold>
					{labels.confirmTitle}
				</Text>
				<Box marginTop={1}>
					<Text color={theme.colors.text}>{message}</Text>
				</Box>
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{labels.confirmHint}
					</Text>
				</Box>
			</Box>
		);
	}

	if (loading) {
		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				<Text color={theme.colors.menuSelected} bold>
					{labels.title}
				</Text>
				<Text color={theme.colors.text}>{labels.loading}</Text>
			</Box>
		);
	}

	// 主菜单
	if (mode === 'menu') {
		const menuItems = [
			{key: 'byProject', label: labels.menu.byProject},
			{key: 'byAge', label: labels.menu.byAge},
		];

		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				{header}
				<Box flexDirection="column">
					{menuItems.map((item, index) => {
						const isSelected = index === menuIndex;
						return (
							<Text
								key={item.key}
								color={
									isSelected
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={isSelected}
							>
								{isSelected ? '❯ ' : '  '}
								{item.label}
							</Text>
						);
					})}
				</Box>
				{renderCategorySummary(overviewCategories)}
				{footer}
			</Box>
		);
	}

	// 按项目清理
	if (mode === 'byProject') {
		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				{header}
				<PickerList
					items={projects}
					selectedIndex={projectIndex}
					visible
					itemHeight={2}
					getItemKey={(project: CleanupProjectInfo) => project.projectId}
					emptyContent={
						<Text dimColor color={theme.colors.text}>
							{labels.noProjects}
						</Text>
					}
					renderItem={(project: CleanupProjectInfo, isSelected: boolean) => {
						const isMarked = markedProjects.has(project.projectId);
						return (
							<Box flexDirection="column">
								<Box>
									<Text
										color={
											isSelected
												? theme.colors.menuSelected
												: theme.colors.menuNormal
										}
										bold={isSelected}
									>
										{isSelected ? '❯ ' : '  '}
									</Text>
									<Text
										color={
											isMarked
												? theme.colors.warning
												: isSelected
												? theme.colors.menuSelected
												: theme.colors.text
										}
									>
										[{isMarked ? 'x' : ' '}]
									</Text>
									<Text
										color={
											isSelected ? theme.colors.menuSelected : theme.colors.text
										}
									>
										{' '}
										{project.displayName}
									</Text>
									<Text color={theme.colors.menuSecondary} dimColor>
										{'  '}
										{formatBytes(project.total.bytes)}
									</Text>
								</Box>
								{renderCategorySummary(project.categories)}
							</Box>
						);
					}}
				/>
				<Box marginTop={1}>
					<Text color={theme.colors.warning}>
						{labels.markedProjects.replace(
							'{count}',
							markedProjects.size.toString(),
						)}
					</Text>
				</Box>
				{footer}
			</Box>
		);
	}

	// 按时间清理
	const ageItems = CLEANUP_DAY_OPTIONS.map((days, index) => ({
		days,
		stats: ageBuckets[index] ?? EMPTY_STATS,
	}));

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			{header}
			<PickerList
				items={ageItems}
				selectedIndex={ageIndex}
				visible
				itemHeight={2}
				getItemKey={(item: {days: number}) => item.days.toString()}
				renderItem={(
					item: {days: number; stats: SizeStats},
					isSelected: boolean,
				) => (
					<Box flexDirection="column">
						<Box>
							<Text
								color={
									isSelected ? theme.colors.menuSelected : theme.colors.text
								}
								bold={isSelected}
							>
								{isSelected ? '❯ ' : '  '}
								{labels.olderThan.replace('{days}', item.days.toString())}
							</Text>
							<Text color={theme.colors.menuSecondary} dimColor>
								{'  '}
								{formatBytes(item.stats.bytes)}
							</Text>
						</Box>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{labels.filesCount.replace(
									'{count}',
									item.stats.files.toString(),
								)}
							</Text>
						</Box>
					</Box>
				)}
			/>
			<Box marginTop={1} flexDirection="column">
				<Text color={theme.colors.menuSecondary} dimColor>
					{labels.ageIncludes}
				</Text>
				<Text color={theme.colors.warning}>
					{labels.ageSelected
						.replace('{days}', selectedDays.toString())
						.replace('{size}', formatBytes(selectedAgeStats.bytes))}
				</Text>
			</Box>
			{footer}
		</Box>
	);
}
