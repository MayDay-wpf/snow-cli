import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import PickerList from '../common/PickerList.js';

interface Props {
	commandName: string;
	options: string[];
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
				getItemKey={(option: string) => option}
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
				renderItem={(option: string, isSelected: boolean) => (
					<Box overflow="hidden">
						<Text
							color={
								isSelected
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
							bold={isSelected}
							wrap="truncate-end"
						>
							{isSelected ? '❯ ' : '  '}
							{option}
						</Text>
					</Box>
				)}
			/>
		);
	},
);

CommandArgsPanel.displayName = 'CommandArgsPanel';

export default CommandArgsPanel;
