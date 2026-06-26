import React, {useState, useEffect, useMemo, useCallback, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	toggleSkill,
	isSkillEnabled,
} from '../../../utils/config/disabledSkills.js';
import {
	updateSingleGithubSkill,
	updateAllGithubSkills,
} from '../../../utils/skills/githubSkillInstaller.js';
import type {Skill} from '../../../mcp/skills.js';

const UPDATE_TIMEOUT_MS = 120_000; // 2 minutes

interface Props {
	onClose: () => void;
}

const NON_FOCUSED_SKILL_DESC_MAX_LEN = 30;
const MAX_DISPLAY_ITEMS = 8;

type UpdateStatus = 'idle' | 'updating' | 'done' | 'error';

export default function SkillsListPanel({onClose}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [skills, setSkills] = useState<Skill[]>([]);
	const [skillEnabledMap, setSkillEnabledMap] = useState<
		Record<string, boolean>
	>({});
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle');
	const [updateMessage, setUpdateMessage] = useState<string>('');
	const abortRef = useRef<AbortController | null>(null);
	const clearMsgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const scheduleClearMessage = useCallback(() => {
		if (clearMsgTimer.current) clearTimeout(clearMsgTimer.current);
		clearMsgTimer.current = setTimeout(() => {
			setUpdateStatus('idle');
			setUpdateMessage('');
			clearMsgTimer.current = null;
		}, 2000);
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			abortRef.current?.abort();
			if (clearMsgTimer.current) clearTimeout(clearMsgTimer.current);
		};
	}, []);

	const loadSkills = useCallback(async () => {
		setIsLoading(true);
		try {
			const {listAvailableSkills} = await import('../../../mcp/skills.js');
			const skillsList = await listAvailableSkills(process.cwd());
			setSkills(skillsList);
			const enabledMap: Record<string, boolean> = {};
			for (const skill of skillsList) {
				enabledMap[skill.id] = isSkillEnabled(skill.id);
			}
			setSkillEnabledMap(enabledMap);
			setIsLoading(false);
		} catch (error) {
			setErrorMessage(
				error instanceof Error ? error.message : 'Failed to load skills',
			);
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		loadSkills();
	}, [loadSkills]);

	const displayWindow = useMemo(() => {
		if (skills.length <= MAX_DISPLAY_ITEMS) {
			return {
				items: skills,
				startIndex: 0,
				endIndex: skills.length,
			};
		}

		const halfWindow = Math.floor(MAX_DISPLAY_ITEMS / 2);
		let startIndex = Math.max(0, selectedIndex - halfWindow);
		const endIndex = Math.min(skills.length, startIndex + MAX_DISPLAY_ITEMS);
		if (endIndex - startIndex < MAX_DISPLAY_ITEMS) {
			startIndex = Math.max(0, endIndex - MAX_DISPLAY_ITEMS);
		}

		return {
			items: skills.slice(startIndex, endIndex),
			startIndex,
			endIndex,
		};
	}, [skills, selectedIndex]);

	const hiddenAboveCount = displayWindow.startIndex;
	const hiddenBelowCount = Math.max(0, skills.length - displayWindow.endIndex);

	const formatSkillDescription = (
		description: string,
		isSelected: boolean,
	): string => {
		if (isSelected || description.length <= NON_FOCUSED_SKILL_DESC_MAX_LEN) {
			return description;
		}
		return `${description.slice(0, NON_FOCUSED_SKILL_DESC_MAX_LEN - 3)}...`;
	};

	const handleUpdate = useCallback(async () => {
		if (updateStatus === 'updating') return;
		const current = skills[selectedIndex];
		if (!current) return;

		setUpdateStatus('updating');
		setUpdateMessage(
			(
				t.skillsListPanel?.updateInProgress || 'Updating skill: {name}...'
			).replace('{name}', current.name || current.id),
		);

		const controller = new AbortController();
		abortRef.current = controller;
		const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);

		try {
			const result = await updateSingleGithubSkill(
				current.id,
				undefined,
				controller.signal,
			);
			if (result.success) {
				setUpdateStatus('done');
				setUpdateMessage(
					result.updated
						? (
								t.skillsListPanel?.updateSingleSuccess ||
								'{name}: updated to latest.'
						  ).replace('{name}', current.name || current.id)
						: (
								t.skillsListPanel?.updateSingleUpToDate ||
								'{name}: already up to date.'
						  ).replace('{name}', current.name || current.id),
				);
				if (result.updated) {
					await loadSkills();
				}
			} else {
				setUpdateStatus('error');
				setUpdateMessage(
					`${t.skillsListPanel?.updateFailed || 'Update failed'}: ${
						result.message
					}`,
				);
			}
		} catch (error) {
			setUpdateStatus('error');
			const isAborted =
				controller.signal.aborted ||
				(error instanceof Error && error.name === 'AbortError');
			const reason = isAborted
				? t.skillsListPanel?.updateTimeout || 'Timed out'
				: error instanceof Error
				? error.message
				: 'Unknown error';
			setUpdateMessage(
				`${t.skillsListPanel?.updateFailed || 'Update failed'}: ${reason}`,
			);
		} finally {
			clearTimeout(timer);
			abortRef.current = null;
			scheduleClearMessage();
		}
	}, [
		updateStatus,
		t,
		loadSkills,
		scheduleClearMessage,
		skills,
		selectedIndex,
	]);

	const handleUpdateAll = useCallback(async () => {
		if (updateStatus === 'updating') return;
		setUpdateStatus('updating');
		setUpdateMessage(
			t.skillsListPanel?.updateAllInProgress || 'Updating all GitHub skills...',
		);

		const controller = new AbortController();
		abortRef.current = controller;
		const timer = setTimeout(() => controller.abort(), UPDATE_TIMEOUT_MS);

		try {
			const results = await updateAllGithubSkills(undefined, controller.signal);
			const totalCount = results.length;
			if (totalCount === 0) {
				setUpdateStatus('done');
				setUpdateMessage(
					t.skillsListPanel?.updateNoSkills ||
						'No GitHub-installed skills found to update.',
				);
			} else {
				const updatedCount = results.filter(r => r.updated).length;
				const failedCount = results.filter(r => !r.success).length;
				setUpdateStatus(
					failedCount > 0 && updatedCount === 0 ? 'error' : 'done',
				);
				let msg: string;
				if (updatedCount === 0 && failedCount === 0) {
					msg = (
						t.skillsListPanel?.updateAllUpToDate ||
						'Checked {total} skills, all up to date.'
					).replace('{total}', String(totalCount));
				} else if (failedCount > 0) {
					msg = (
						t.skillsListPanel?.updatePartial ||
						'Updated {updated}/{total}, {failed} failed.'
					)
						.replace('{updated}', String(updatedCount))
						.replace('{total}', String(totalCount))
						.replace('{failed}', String(failedCount));
				} else {
					msg = (
						t.skillsListPanel?.updateResult ||
						'Updated {updated}/{total} skills.'
					)
						.replace('{updated}', String(updatedCount))
						.replace('{total}', String(totalCount));
				}
				setUpdateMessage(msg);
				if (updatedCount > 0) {
					await loadSkills();
				}
			}
		} catch (error) {
			setUpdateStatus('error');
			const isAborted =
				controller.signal.aborted ||
				(error instanceof Error && error.name === 'AbortError');
			const reason = isAborted
				? t.skillsListPanel?.updateTimeout || 'Timed out'
				: error instanceof Error
				? error.message
				: 'Unknown error';
			setUpdateMessage(
				`${t.skillsListPanel?.updateFailed || 'Update failed'}: ${reason}`,
			);
		} finally {
			clearTimeout(timer);
			abortRef.current = null;
			scheduleClearMessage();
		}
	}, [updateStatus, t, loadSkills, scheduleClearMessage]);

	useInput((input, key) => {
		if (isLoading) return;

		// ESC: close panel (or cancel update if in progress)
		if (key.escape) {
			if (updateStatus === 'updating') {
				abortRef.current?.abort();
				return;
			}
			onClose();
			return;
		}

		// Block navigation keys while updating
		if (updateStatus === 'updating') return;

		// 'u' to update the selected GitHub-installed skill
		if (input === 'u' || input === 'U') {
			handleUpdate();
			return;
		}

		// 'A' to update ALL GitHub-installed skills
		if (input === 'a' || input === 'A') {
			handleUpdateAll();
			return;
		}

		if (skills.length === 0) return;

		if (key.upArrow) {
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : skills.length - 1));
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev => (prev < skills.length - 1 ? prev + 1 : 0));
			return;
		}

		if (key.tab || input === ' ' || key.return) {
			const current = skills[selectedIndex];
			if (!current) return;
			try {
				toggleSkill(current.id);
				setSkillEnabledMap(prev => ({
					...prev,
					[current.id]: !prev[current.id],
				}));
			} catch (error) {
				setErrorMessage(
					error instanceof Error ? error.message : 'Failed to toggle skill',
				);
			}
			return;
		}
	});

	if (isLoading) {
		return (
			<Text color={theme.colors.menuSecondary}>
				{t.skillsListPanel?.loading || 'Loading skills...'}
			</Text>
		);
	}

	if (errorMessage) {
		return (
			<Box
				borderColor={theme.colors.error}
				borderStyle="round"
				paddingX={2}
				paddingY={0}
			>
				<Text color={theme.colors.error} dimColor>
					{(t.skillsListPanel?.error || 'Error: {message}').replace(
						'{message}',
						errorMessage,
					)}
				</Text>
			</Box>
		);
	}

	if (skills.length === 0) {
		return (
			<Box
				borderColor={theme.colors.menuInfo}
				borderStyle="round"
				paddingX={2}
				paddingY={0}
			>
				<Box flexDirection="column">
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.skillsListPanel?.noSkills || 'No skills available'}
					</Text>
					{updateStatus !== 'idle' && updateMessage && (
						<Box marginTop={1}>
							<Text
								color={
									updateStatus === 'error'
										? theme.colors.error
										: updateStatus === 'updating'
										? theme.colors.warning
										: theme.colors.success
								}
							>
								{updateMessage}
							</Text>
						</Box>
					)}
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.skillsListPanel?.navigationHint ||
								'↑↓ Navigate • Tab/Space/Enter Toggle • U Update Selected • A Update All • ESC Close'}
						</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	return (
		<Box
			borderColor={theme.colors.menuInfo}
			borderStyle="round"
			paddingX={2}
			paddingY={0}
		>
			<Box flexDirection="column">
				<Text color={theme.colors.menuInfo} bold>
					{t.skillsListPanel?.title || 'Skills'}
					{skills.length > MAX_DISPLAY_ITEMS &&
						` (${selectedIndex + 1}/${skills.length})`}
				</Text>

				{hiddenAboveCount > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
						{(t.skillsListPanel?.moreAbove || '↑ {count} more above').replace(
							'{count}',
							String(hiddenAboveCount),
						)}
					</Text>
				)}

				{displayWindow.items.map((skill, displayIdx) => {
					const actualIndex = displayWindow.startIndex + displayIdx;
					const isSelected = actualIndex === selectedIndex;
					const isEnabled = skillEnabledMap[skill.id] !== false;
					const locationSuffix =
						skill.location === 'project'
							? t.skillsListPanel?.locationProject || '(Project)'
							: t.skillsListPanel?.locationGlobal || '(Global)';
					const skillDescription = (skill.description || '').trim();
					const hasDescription = Boolean(skillDescription);
					const renderedDescription = hasDescription
						? formatSkillDescription(skillDescription, isSelected)
						: '';

					return (
						<Box key={skill.id} flexDirection="column">
							<Text>
								{isSelected ? '❯ ' : '  '}
								<Text
									color={
										isEnabled
											? theme.colors.success
											: theme.colors.menuSecondary
									}
								>
									◆{' '}
								</Text>
								<Text
									color={
										isSelected
											? theme.colors.menuInfo
											: isEnabled
											? theme.colors.text
											: theme.colors.menuSecondary
									}
								>
									{skill.name || skill.id}
								</Text>
								<Text color={theme.colors.menuSecondary} dimColor>
									{' '}
									{isEnabled
										? locationSuffix
										: t.skillsListPanel?.statusDisabled || '(Disabled)'}
								</Text>
							</Text>
							{isEnabled && hasDescription ? (
								<Box marginLeft={4}>
									<Text color={theme.colors.menuSecondary} dimColor>
										{renderedDescription}
									</Text>
								</Box>
							) : null}
						</Box>
					);
				})}

				{hiddenBelowCount > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
						{(t.skillsListPanel?.moreBelow || '↓ {count} more below').replace(
							'{count}',
							String(hiddenBelowCount),
						)}
					</Text>
				)}

				{updateStatus !== 'idle' && updateMessage && (
					<Box marginTop={1}>
						<Text
							color={
								updateStatus === 'error'
									? theme.colors.error
									: updateStatus === 'updating'
									? theme.colors.warning
									: theme.colors.success
							}
						>
							{updateStatus === 'updating'
								? '⟳ '
								: updateStatus === 'done'
								? '✓ '
								: '✗ '}
							{updateMessage}
						</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.skillsListPanel?.navigationHint ||
							'↑↓ Navigate • Tab/Space/Enter Toggle • U Update Selected • A Update All • ESC Close'}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
