import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import PickerList from '../common/PickerList.js';

export interface ProfileItem {
	name: string;
	displayName: string;
	isActive: boolean;
}

interface Props {
	profiles: ProfileItem[];
	selectedIndex: number;
	visible: boolean;
	maxHeight?: number;
	searchQuery?: string;
}

const ProfilePanel = memo(
	({profiles, selectedIndex, visible, maxHeight, searchQuery}: Props) => {
		const {t} = useI18n();
		const {theme} = useTheme();

		if (!visible) {
			return null;
		}

		return (
			<PickerList
				items={profiles}
				selectedIndex={selectedIndex}
				visible={visible}
				maxDisplayItems={maxHeight}
				itemHeight={1}
				getItemKey={(profile: ProfileItem) => profile.name}
				title={
					<Text color={theme.colors.warning} bold>
						{t.profilePanel.title}{' '}
						{profiles.length > 5 &&
							`(${selectedIndex + 1}/${profiles.length})`}
					</Text>
				}
				header={
					searchQuery ? (
						<Box marginTop={1}>
							<Text color={theme.colors.menuInfo}>
								{t.profilePanel.searchLabel}{' '}
								<Text color={theme.colors.menuSelected}>
									{searchQuery}
								</Text>
							</Text>
						</Box>
					) : undefined
				}
				footer={
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.profilePanel.escHint}
						</Text>
					</Box>
				}
				emptyContent={
					<Box width="100%" flexDirection="column">
						<Box>
							<Text color={theme.colors.warning} bold>
								{t.profilePanel.title}
							</Text>
						</Box>
						{searchQuery && (
							<Box marginTop={1}>
								<Text color={theme.colors.menuInfo}>
									{t.profilePanel.searchLabel}{' '}
									<Text color={theme.colors.menuSelected}>
										{searchQuery}
									</Text>
								</Text>
							</Box>
						)}
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.profilePanel.noResults}
							</Text>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.profilePanel.escHint}
							</Text>
						</Box>
					</Box>
				}
				scrollHintFormat={(above, below) => (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.profilePanel.scrollHint}
						{above > 0 && (
							<>
								·{' '}
								{t.profilePanel.moreAbove.replace(
									'{count}',
									above.toString(),
								)}
							</>
						)}
						{below > 0 && (
							<>
								·{' '}
								{t.profilePanel.moreBelow.replace(
									'{count}',
									below.toString(),
								)}
							</>
						)}
						{above === 0 && below === 0 && (
							<>
								·{' '}
								{t.profilePanel.moreHidden.replace(
									'{count}',
									(profiles.length - 5).toString(),
								)}
							</>
						)}
					</Text>
				)}
				renderItem={(profile: ProfileItem, isSelected: boolean) => (
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
							{isSelected ? '> ' : '  '}
							{profile.displayName}
							{profile.isActive && ` ${t.profilePanel.activeLabel}`}
						</Text>
					</Box>
				)}
			/>
		);
	},
);

ProfilePanel.displayName = 'ProfilePanel';

export default ProfilePanel;
