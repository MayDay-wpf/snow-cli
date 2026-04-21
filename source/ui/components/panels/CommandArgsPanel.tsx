import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';

interface Props {
	commandName: string;
	options: string[];
	selectedIndex: number;
	visible: boolean;
}

const CommandArgsPanel = memo(
	({commandName, options, selectedIndex, visible}: Props) => {
		const {theme} = useTheme();

		const MAX_DISPLAY_ITEMS = 6;

		const displayWindow = useMemo(() => {
			if (options.length <= MAX_DISPLAY_ITEMS) {
				return {
					items: options,
					startIndex: 0,
					endIndex: options.length,
				};
			}

			const halfWindow = Math.floor(MAX_DISPLAY_ITEMS / 2);
			let startIndex = Math.max(0, selectedIndex - halfWindow);
			let endIndex = Math.min(options.length, startIndex + MAX_DISPLAY_ITEMS);

			if (endIndex - startIndex < MAX_DISPLAY_ITEMS) {
				startIndex = Math.max(0, endIndex - MAX_DISPLAY_ITEMS);
			}

			return {
				items: options.slice(startIndex, endIndex),
				startIndex,
				endIndex,
			};
		}, [options, selectedIndex]);

		const displayedItems = displayWindow.items;
		const displayedSelectedIndex = selectedIndex - displayWindow.startIndex;

		if (!visible || options.length === 0) {
			return null;
		}

		return (
			<Box flexDirection="column">
				<Box>
					<Text color={theme.colors.warning} bold>
						/{commandName}{' '}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						Tab ↑↓ Enter
					</Text>
				</Box>
				{displayedItems.map((option, index) => (
					<Box key={option} flexDirection="row">
						<Text
							color={
								index === displayedSelectedIndex
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
							bold={index === displayedSelectedIndex}
						>
							{index === displayedSelectedIndex ? '❯ ' : '  '}
							{option}
						</Text>
					</Box>
				))}
			</Box>
		);
	},
);

CommandArgsPanel.displayName = 'CommandArgsPanel';

export default CommandArgsPanel;
