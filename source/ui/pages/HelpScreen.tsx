import React from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {useI18n} from '../../i18n/I18nContext.js';
import HelpPanel from '../components/panels/HelpPanel.js';
import {navigateTo} from '../../hooks/integration/useGlobalNavigation.js';

type Props = {
	// Future-proof: allow calling screen to decide where to go back.
	onBackDestination?: 'chat' | 'welcome';
};

export default function HelpScreen({onBackDestination = 'chat'}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();

	useInput((input, key) => {
		if (key.escape) {
			navigateTo(onBackDestination);
			return;
		}

		// Allow 'q' as a secondary exit key (common in pagers).
		if (input === 'q' || input === 'Q') {
			navigateTo(onBackDestination);
		}
	});

	return (
		<Box paddingX={1} flexDirection="column">
			<HelpPanel />
			<Box marginTop={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.chatScreen.pressEscToClose}
				</Text>
			</Box>
		</Box>
	);
}
