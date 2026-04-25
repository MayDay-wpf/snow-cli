import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import PickerList from '../common/PickerList.js';

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
		const {t} = useI18n();
		const {theme} = useTheme();

		if (!visible) {
			return null;
		}

		if (isLoading) {
			return (
				<Box flexDirection="column">
					<Box width="100%" flexDirection="column">
						<Box>
							<Text color={theme.colors.warning} bold>
								{t.skillsPickerPanel.title}
							</Text>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.skillsPickerPanel.loading}
							</Text>
						</Box>
					</Box>
				</Box>
			);
		}

		return (
			<PickerList
				items={skills}
				selectedIndex={selectedIndex}
				visible={visible}
				maxDisplayItems={maxHeight}
				getItemKey={(skill: SkillsPickerItem) => skill.id}
				title={
					<>
						<Text color={theme.colors.warning} bold>
							{t.skillsPickerPanel.title}{' '}
							{skills.length > 5 &&
								`(${selectedIndex + 1}/${skills.length})`}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.skillsPickerPanel.keyboardHint}
						</Text>
					</>
				}
				header={
					<Box marginTop={1} flexDirection="column">
						<Text color={theme.colors.menuInfo}>
							{focus === 'search' ? '▶ ' : '  '}
							{t.skillsPickerPanel.searchLabel}{' '}
							<Text color={theme.colors.menuSelected}>
								{searchQuery || t.skillsPickerPanel.empty}
							</Text>
						</Text>
						<Text color={theme.colors.menuInfo}>
							{focus === 'append' ? '▶ ' : '  '}
							{t.skillsPickerPanel.appendLabel}{' '}
							<Text color={theme.colors.menuSelected}>
								{appendText || t.skillsPickerPanel.empty}
							</Text>
						</Text>
					</Box>
				}
				emptyContent={
					<Box width="100%" flexDirection="column">
						<Box>
							<Text color={theme.colors.warning} bold>
								{t.skillsPickerPanel.title}
							</Text>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.skillsPickerPanel.keyboardHint}
							</Text>
						</Box>
						<Box marginTop={1} flexDirection="column">
							<Text color={theme.colors.menuInfo}>
								{focus === 'search' ? '▶ ' : '  '}
								{t.skillsPickerPanel.searchLabel}{' '}
								<Text color={theme.colors.menuSelected}>
									{searchQuery || t.skillsPickerPanel.empty}
								</Text>
							</Text>
							<Text color={theme.colors.menuInfo}>
								{focus === 'append' ? '▶ ' : '  '}
								{t.skillsPickerPanel.appendLabel}{' '}
								<Text color={theme.colors.menuSelected}>
									{appendText || t.skillsPickerPanel.empty}
								</Text>
							</Text>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.skillsPickerPanel.noSkillsFound}
							</Text>
						</Box>
					</Box>
				}
				scrollHintFormat={(above, below) => (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.skillsPickerPanel.scrollHint}
						{above > 0 && (
							<>
								·{' '}
								{t.skillsPickerPanel.moreAbove.replace(
									'{count}',
									above.toString(),
								)}
							</>
						)}
						{below > 0 && (
							<>
								·{' '}
								{t.skillsPickerPanel.moreBelow.replace(
									'{count}',
									below.toString(),
								)}
							</>
						)}
					</Text>
				)}
				renderItem={(skill: SkillsPickerItem, isSelected: boolean) => (
					<>
						<Text
							color={
								isSelected
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
							bold
						>
							{isSelected ? '❯ ' : '  '}#{skill.id}{' '}
							<Text dimColor>({skill.location})</Text>
						</Text>
						<Box marginLeft={3} overflow="hidden">
							<Text
								color={
									isSelected
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								dimColor
								wrap="truncate-end"
							>
								└─{' '}
								{skill.description ||
									skill.name ||
									t.skillsPickerPanel.noDescription}
							</Text>
						</Box>
					</>
				)}
			/>
		);
	},
);

SkillsPickerPanel.displayName = 'SkillsPickerPanel';

export default SkillsPickerPanel;
