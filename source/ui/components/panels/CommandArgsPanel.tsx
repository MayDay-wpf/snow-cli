import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	getCommandArgOptionLabel,
	getCommandArgOptionValue,
	type CommandArgOption,
} from '../../../hooks/ui/useCommandPanel.js';
import PickerList from '../common/PickerList.js';

interface Props {
	commandName: string;
	options: CommandArgOption[];
	selectedIndex: number;
	visible: boolean;
}

const CommandArgsPanel = memo(
	({commandName, options, selectedIndex, visible}: Props) => {
		const {theme} = useTheme();
		const {t} = useI18n();

		if (!visible || options.length === 0) {
			return null;
		}

		return (
			<PickerList
				items={options}
				selectedIndex={selectedIndex}
				visible={visible}
				maxDisplayItems={6}
				itemHeight={1}
				getItemKey={(option: CommandArgOption) =>
					getCommandArgOptionValue(option)
				}
				title={
					<>
						<Text color={theme.colors.warning} bold>
							/{commandName}{' '}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.commandArgsPanel.navigationHint}
						</Text>
					</>
				}
				renderItem={(option: CommandArgOption, isSelected: boolean) => (
					<Box overflow="hidden">
						<Text
							color={
								isSelected ? theme.colors.menuSelected : theme.colors.menuNormal
							}
							bold={isSelected}
							wrap="truncate-end"
						>
							{isSelected ? '> ' : '  '}
							{getCommandArgOptionLabel(option)}
						</Text>
					</Box>
				)}
			/>
		);
	},
);

CommandArgsPanel.displayName = 'CommandArgsPanel';

export default CommandArgsPanel;
