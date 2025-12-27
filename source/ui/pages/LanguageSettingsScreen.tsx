import React, {useState, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import Menu from '../components/common/Menu.js';
import {useI18n} from '../../i18n/index.js';
import type {Language} from '../../utils/config/languageConfig.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	onBack: () => void;
	inlineMode?: boolean;
};

export default function LanguageSettingsScreen({
	onBack,
	inlineMode = false,
}: Props) {
	const {language, setLanguage} = useI18n();
	const {theme} = useTheme();
	const [selectedLanguage, setSelectedLanguage] = useState<Language>(language);

	const languageOptions = [
		{
			label: 'English',
			value: 'en',
			infoText: 'Switch to English',
		},
		{
			label: '简体中文',
			value: 'zh',
			infoText: '切换到简体中文',
		},
		{
			label: '繁體中文',
			value: 'zh-TW',
			infoText: '切換到繁體中文',
		},
		{
			label: '← Back',
			value: 'back',
			color: theme.colors.menuSecondary,
			infoText: 'Return to main menu',
		},
	];

	const handleSelect = useCallback(
		(value: string) => {
			if (value === 'back') {
				onBack();
			} else {
				const newLang = value as Language;
				setSelectedLanguage(newLang);
				setLanguage(newLang);
				// Auto return to menu after selection
				setTimeout(() => {
					onBack();
				}, 300);
			}
		},
		[onBack, setLanguage],
	);

	const handleSelectionChange = useCallback((_infoText: string) => {
		// Could update some info display here if needed
	}, []);

	useInput((_input, key) => {
		if (key.escape) {
			onBack();
		}
	});

	return (
		<Box flexDirection="column" paddingX={1}>
			{!inlineMode && (
				<Box
					borderStyle="round"
					borderColor={theme.colors.menuInfo}
					paddingX={1}
					marginBottom={1}
				>
					<Box flexDirection="column">
						<Text bold color={theme.colors.menuInfo}>
							Language Settings / 语言设置
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column">
				<Box paddingX={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						Current:{' '}
						{selectedLanguage === 'en'
							? 'English'
							: selectedLanguage === 'zh'
							? '简体中文'
							: '繁體中文'}
					</Text>
				</Box>
				<Menu
					options={languageOptions}
					onSelect={handleSelect}
					onSelectionChange={handleSelectionChange}
				/>
			</Box>
		</Box>
	);
}
