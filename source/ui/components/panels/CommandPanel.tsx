import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import PickerList from '../common/PickerList.js';
import {
	COMMAND_CATEGORY_TABS,
	type CommandCategoryFilter,
} from '../../../utils/commands/commandMatch.js';

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
	categoryFilter?: CommandCategoryFilter;
}

const TAB_LABEL_KEYS: Record<
	CommandCategoryFilter,
	'all' | 'frequent' | 'settings' | 'advanced' | 'fun' | 'custom'
> = {
	all: 'all',
	frequent: 'frequent',
	settings: 'settings',
	advanced: 'advanced',
	fun: 'fun',
	custom: 'custom',
};

const CommandPanel = memo(
	({
		commands,
		selectedIndex,
		visible,
		maxHeight,
		categoryFilter = 'all',
		query,
	}: Props) => {
		const {t} = useI18n();
		const {theme} = useTheme();
		const showTabs = !query?.trim();
		const categoryLabels = t.commandPanel.categories;

		return (
			<Box flexDirection="column">
				{showTabs && (
					<Box marginBottom={0}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{COMMAND_CATEGORY_TABS.map((tab, index) => {
								const label =
									categoryLabels?.[TAB_LABEL_KEYS[tab]] ?? tab;
								const active = tab === categoryFilter;
								return (
									<Text key={tab}>
										{index > 0 ? ' ' : ''}
										<Text
											color={
												active
													? theme.colors.menuSelected
													: theme.colors.menuSecondary
											}
											bold={active}
										>
											{active ? `[${label}]` : label}
										</Text>
									</Text>
								);
							})}
						</Text>
					</Box>
				)}
				<PickerList
					items={commands}
					selectedIndex={selectedIndex}
					visible={visible}
					maxDisplayItems={maxHeight}
					getItemKey={(cmd: Command) => cmd.name}
					title={
						<Text color={theme.colors.warning} bold>
							{t.commandPanel.availableCommands}{' '}
							{commands.length > 5 &&
								`(${selectedIndex + 1}/${commands.length})`}
						</Text>
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
							{above === 0 && below === 0 && (
								<>
									·{' '}
									{t.commandPanel.moreHidden.replace(
										'{count}',
										(commands.length - 5).toString(),
									)}
								</>
							)}
						</Text>
					)}
					renderItem={(command: Command, isSelected: boolean) => (
						<>
							<Text
								color={
									isSelected
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold
							>
								{isSelected ? '❯ ' : '  '}/{command.name}
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
									└─ {command.description}
								</Text>
							</Box>
						</>
					)}
				/>
			</Box>
		);
	},
);

CommandPanel.displayName = 'CommandPanel';

export default CommandPanel;
