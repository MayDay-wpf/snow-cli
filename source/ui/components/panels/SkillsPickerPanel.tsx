import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';

export type SkillsPickerFocus = 'search' | 'append';

export type SkillsPickerItem = {
	id: string;
	name: string;
	description: string;
	location: 'project' | 'global';
};

interface Props {
	skills: SkillsPickerItem[];
	selectedIndex: number;
	visible: boolean;
	maxHeight?: number;
	isLoading?: boolean;
	searchQuery?: string;
	appendText?: string;
	focus?: SkillsPickerFocus;
}

const SkillsPickerPanel = memo(
	({
		skills,
		selectedIndex,
		visible,
		maxHeight,
		isLoading = false,
		searchQuery = '',
		appendText = '',
		focus = 'search',
	}: Props) => {
		const {theme} = useTheme();
		const MAX_DISPLAY_ITEMS = 5;
		const effectiveMaxItems = maxHeight
			? Math.min(maxHeight, MAX_DISPLAY_ITEMS)
			: MAX_DISPLAY_ITEMS;

		const displayWindow = useMemo(() => {
			if (skills.length <= effectiveMaxItems) {
				return {
					items: skills,
					startIndex: 0,
					endIndex: skills.length,
				};
			}

			const halfWindow = Math.floor(effectiveMaxItems / 2);
			let startIndex = Math.max(0, selectedIndex - halfWindow);
			let endIndex = Math.min(skills.length, startIndex + effectiveMaxItems);
			if (endIndex - startIndex < effectiveMaxItems) {
				startIndex = Math.max(0, endIndex - effectiveMaxItems);
			}

			return {
				items: skills.slice(startIndex, endIndex),
				startIndex,
				endIndex,
			};
		}, [skills, selectedIndex, effectiveMaxItems]);

		const displayedSkills = displayWindow.items;
		const hiddenAboveCount = displayWindow.startIndex;
		const hiddenBelowCount = Math.max(0, skills.length - displayWindow.endIndex);

		const displayedSelectedIndex = useMemo(() => {
			return displayedSkills.findIndex(skill => {
				const originalIndex = skills.indexOf(skill);
				return originalIndex === selectedIndex;
			});
		}, [displayedSkills, skills, selectedIndex]);

		if (!visible) {
			return null;
		}

		return (
			<Box flexDirection="column">
				<Box width="100%" flexDirection="column">
					<Box>
						<Text color={theme.colors.warning} bold>
							Select Skill{' '}
							{skills.length > effectiveMaxItems &&
								`(${selectedIndex + 1}/${skills.length})`}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							(ESC: cancel · Tab: switch · Enter: confirm)
						</Text>
					</Box>

					{isLoading ? (
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								Loading skills...
							</Text>
						</Box>
					) : (
						<>
							<Box marginTop={1} flexDirection="column">
								<Text color={theme.colors.menuInfo}>
									{focus === 'search' ? '▶ ' : '  '}Search:{' '}
									<Text color={theme.colors.menuSelected}>
										{searchQuery || '(empty)'}
									</Text>
								</Text>
								<Text color={theme.colors.menuInfo}>
									{focus === 'append' ? '▶ ' : '  '}Append:{' '}
									<Text color={theme.colors.menuSelected}>
										{appendText || '(empty)'}
									</Text>
								</Text>
							</Box>

							{skills.length === 0 ? (
								<Box marginTop={1}>
									<Text color={theme.colors.menuSecondary} dimColor>
										No skills found
									</Text>
								</Box>
							) : (
								<Box marginTop={1} flexDirection="column">
									{displayedSkills.map((skill, index) => (
										<Box key={skill.id} flexDirection="column" width="100%">
											<Text
												color={
													index === displayedSelectedIndex
														? theme.colors.menuSelected
														: theme.colors.menuNormal
												}
												bold
											>
												{index === displayedSelectedIndex ? '❯ ' : '  '}#{skill.id}
												{' '}
												<Text dimColor>
													({skill.location})
												</Text>
											</Text>
											<Box marginLeft={3}>
												<Text
													color={
														index === displayedSelectedIndex
															? theme.colors.menuSelected
															: theme.colors.menuNormal
													}
													dimColor
												>
													└─ {skill.description || skill.name || 'No description'}
												</Text>
											</Box>
										</Box>
									))}

									{skills.length > effectiveMaxItems && (
										<Box marginTop={1}>
											<Text color={theme.colors.menuSecondary} dimColor>
												↑↓ to scroll · {hiddenAboveCount > 0 && `${hiddenAboveCount} above`} 
												{hiddenBelowCount > 0 && `${hiddenBelowCount} below`}
											</Text>
										</Box>
									)}
								</Box>
							)}
						</>
					)}
				</Box>
			</Box>
		);
	},
);

SkillsPickerPanel.displayName = 'SkillsPickerPanel';

export default SkillsPickerPanel;
