import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';

interface Command {
	name: string;
	description: string;
}

interface Props {
	commands: Command[];
	selectedIndex: number;
	query: string;
	visible: boolean;
	maxHeight?: number;
	isProcessing?: boolean;
}

const CommandPanel = memo(
	({
		commands,
		selectedIndex,
		visible,
		maxHeight,
		isProcessing = false,
	}: Props) => {
		const {t} = useI18n();
		const {theme} = useTheme();

		// Fixed maximum display items to prevent rendering issues
		const MAX_DISPLAY_ITEMS = 5;
		const effectiveMaxItems = maxHeight
			? Math.min(maxHeight, MAX_DISPLAY_ITEMS)
			: MAX_DISPLAY_ITEMS;

		const displayWindow = useMemo(() => {
			if (commands.length <= effectiveMaxItems) {
				return {
					items: commands,
					startIndex: 0,
					endIndex: commands.length,
				};
			}

			// Show commands around the selected index
			const halfWindow = Math.floor(effectiveMaxItems / 2);
			let startIndex = Math.max(0, selectedIndex - halfWindow);
			let endIndex = Math.min(commands.length, startIndex + effectiveMaxItems);

			// Adjust if we're near the end
			if (endIndex - startIndex < effectiveMaxItems) {
				startIndex = Math.max(0, endIndex - effectiveMaxItems);
			}

			return {
				items: commands.slice(startIndex, endIndex),
				startIndex,
				endIndex,
			};
		}, [commands, selectedIndex, effectiveMaxItems]);

		const displayedCommands = displayWindow.items;
		const hiddenAboveCount = displayWindow.startIndex;
		const hiddenBelowCount = Math.max(
			0,
			commands.length - displayWindow.endIndex,
		);

		// Calculate actual selected index in the displayed subset
		const displayedSelectedIndex = useMemo(() => {
			return displayedCommands.findIndex(cmd => {
				const originalIndex = commands.indexOf(cmd);
				return originalIndex === selectedIndex;
			});
		}, [displayedCommands, commands, selectedIndex]);

		// Don't show panel if not visible
		if (!visible) {
			return null;
		}

		// Show processing message if conversation is in progress
		if (isProcessing) {
			return (
				<Box flexDirection="column">
					<Box width="100%">
						<Box flexDirection="column" width="100%">
							<Box>
								<Text color={theme.colors.warning} bold>
									{t.commandPanel.title}
								</Text>
							</Box>
							<Box marginTop={1}>
								<Alert variant="info">{t.commandPanel.processingMessage}</Alert>
							</Box>
						</Box>
					</Box>
				</Box>
			);
		}

		// Don't show panel if no commands found
		if (commands.length === 0) {
			return null;
		}

		return (
			<Box flexDirection="column">
				<Box width="100%">
					<Box flexDirection="column" width="100%">
						<Box>
							<Text color={theme.colors.warning} bold>
								{t.commandPanel.availableCommands}{' '}
								{commands.length > effectiveMaxItems &&
									`(${selectedIndex + 1}/${commands.length})`}
							</Text>
						</Box>
						{displayedCommands.map((command, index) => (
							<Box key={command.name} flexDirection="column" width="100%">
								<Text
									color={
										index === displayedSelectedIndex
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold
								>
									{index === displayedSelectedIndex ? '❯ ' : '  '}/
									{command.name}
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
										└─ {command.description}
									</Text>
								</Box>
							</Box>
						))}
						{commands.length > effectiveMaxItems && (
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
									{hiddenAboveCount === 0 && hiddenBelowCount === 0 && (
										<>
											·{' '}
											{t.commandPanel.moreHidden.replace(
												'{count}',
												(commands.length - effectiveMaxItems).toString(),
											)}
										</>
									)}
								</Text>
							</Box>
						)}
					</Box>
				</Box>
			</Box>
		);
	},
);

CommandPanel.displayName = 'CommandPanel';

export default CommandPanel;
