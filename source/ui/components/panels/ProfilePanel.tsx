import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';

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

		// Fixed maximum display items to prevent rendering issues
		const MAX_DISPLAY_ITEMS = 5;
		const effectiveMaxItems = maxHeight
			? Math.min(maxHeight, MAX_DISPLAY_ITEMS)
			: MAX_DISPLAY_ITEMS;

		const displayWindow = useMemo(() => {
			if (profiles.length <= effectiveMaxItems) {
				return {
					items: profiles,
					startIndex: 0,
					endIndex: profiles.length,
				};
			}

			// Show profiles around the selected index
			const halfWindow = Math.floor(effectiveMaxItems / 2);
			let startIndex = Math.max(0, selectedIndex - halfWindow);
			let endIndex = Math.min(profiles.length, startIndex + effectiveMaxItems);

			// Adjust if we're near the end
			if (endIndex - startIndex < effectiveMaxItems) {
				startIndex = Math.max(0, endIndex - effectiveMaxItems);
			}

			return {
				items: profiles.slice(startIndex, endIndex),
				startIndex,
				endIndex,
			};
		}, [profiles, selectedIndex, effectiveMaxItems]);

		const displayedProfiles = displayWindow.items;
		const hiddenAboveCount = displayWindow.startIndex;
		const hiddenBelowCount = Math.max(
			0,
			profiles.length - displayWindow.endIndex,
		);

		// Calculate actual selected index in the displayed subset
		const displayedSelectedIndex = useMemo(() => {
			return displayedProfiles.findIndex(profile => {
				const originalIndex = profiles.indexOf(profile);
				return originalIndex === selectedIndex;
			});
		}, [displayedProfiles, profiles, selectedIndex]);

		// Don't show panel if not visible
		if (!visible) {
			return null;
		}

		return (
			<Box flexDirection="column">
				<Box width="100%">
					<Box flexDirection="column" width="100%">
						<Box>
							<Text color={theme.colors.warning} bold>
								{t.profilePanel.title}{' '}
								{profiles.length > effectiveMaxItems &&
									`(${selectedIndex + 1}/${profiles.length})`}
							</Text>
						</Box>
						{searchQuery && (
							<Box marginTop={1}>
								<Text color={theme.colors.menuInfo}>
									{t.profilePanel.searchLabel}{' '}
									<Text color={theme.colors.menuSelected}>{searchQuery}</Text>
								</Text>
							</Box>
						)}
						{profiles.length === 0 ? (
							<Box marginTop={1}>
								<Text color={theme.colors.menuSecondary} dimColor>
									{t.profilePanel.noResults}
								</Text>
							</Box>
						) : (
							<>
								{displayedProfiles.map((profile, index) => (
									<Box key={profile.name} flexDirection="column" width="100%">
										<Text
											color={
												index === displayedSelectedIndex
													? theme.colors.menuSelected
													: theme.colors.menuNormal
											}
											bold
										>
											{index === displayedSelectedIndex ? '> ' : '  '}
											{profile.displayName}
											{profile.isActive && ` ${t.profilePanel.activeLabel}`}
										</Text>
									</Box>
								))}
								{profiles.length > effectiveMaxItems && (
									<Box marginTop={1}>
										<Text color={theme.colors.menuSecondary} dimColor>
											{t.profilePanel.scrollHint}
											{hiddenAboveCount > 0 && (
												<>
													·{' '}
													{t.profilePanel.moreAbove.replace(
														'{count}',
														hiddenAboveCount.toString(),
													)}
												</>
											)}
											{hiddenBelowCount > 0 && (
												<>
													·{' '}
													{t.profilePanel.moreBelow.replace(
														'{count}',
														hiddenBelowCount.toString(),
													)}
												</>
											)}
											{hiddenAboveCount === 0 && hiddenBelowCount === 0 && (
												<>
													·{' '}
													{t.profilePanel.moreHidden.replace(
														'{count}',
														(profiles.length - effectiveMaxItems).toString(),
													)}
												</>
											)}
										</Text>
									</Box>
								)}
							</>
						)}
						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.profilePanel.escHint}
							</Text>
						</Box>
					</Box>
				</Box>
			</Box>
		);
	},
);

ProfilePanel.displayName = 'ProfilePanel';

export default ProfilePanel;
