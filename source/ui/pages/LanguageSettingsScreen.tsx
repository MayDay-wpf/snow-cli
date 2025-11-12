import React, {useState, useCallback} from 'react';
import {Box, Text} from 'ink';
import Menu from '../components/Menu.js';
import {useI18n} from '../../i18n/index.js';
import type {Language} from '../../utils/languageConfig.js';

type Props = {
	onBack: () => void;
};

export default function LanguageSettingsScreen({onBack}: Props) {
	const {language, setLanguage} = useI18n();
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
			label: '← Back',
			value: 'back',
			color: 'gray',
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

	return (
		<Box flexDirection="column" paddingX={1}>
			<Box borderStyle="round" borderColor="cyan" paddingX={1}>
				<Box flexDirection="column" width="100%">
					<Box paddingX={1} paddingY={1}>
						<Text bold color="cyan">
							Language Settings / 语言设置
						</Text>
					</Box>
					<Box paddingX={1}>
						<Text color="gray" dimColor>
							Current: {selectedLanguage === 'en' ? 'English' : '简体中文'}
						</Text>
					</Box>
					<Menu
						options={languageOptions}
						onSelect={handleSelect}
						onSelectionChange={handleSelectionChange}
					/>
				</Box>
			</Box>
		</Box>
	);
}
