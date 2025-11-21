import React, {useMemo, useCallback, useState, Suspense} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert, Spinner} from '@inkjs/ui';
import Menu from '../components/Menu.js';
import DiffViewer from '../components/DiffViewer.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {ThemeType} from '../themes/index.js';
import {useI18n} from '../../i18n/index.js';

const CustomThemeScreen = React.lazy(() => import('./CustomThemeScreen.js'));

type Props = {
	onBack: () => void;
	inlineMode?: boolean;
};

type Screen = 'main' | 'custom';

const sampleOldCode = `function greet(name) {
  console.log("Hello " + name);
  return "Welcome!";
}`;

const sampleNewCode = `function greet(name: string): string {
  console.log(\`Hello \${name}\`);
  return \`Welcome, \${name}!\`;
}`;

export default function ThemeSettingsScreen({
	onBack,
	inlineMode = false,
}: Props) {
	const {themeType, setThemeType} = useTheme();
	const {t} = useI18n();
	// Use themeType from context which is already loaded from config
	const [selectedTheme, setSelectedTheme] = useState<ThemeType>(themeType);
	const [infoText, setInfoText] = useState<string>('');
	const [screen, setScreen] = useState<Screen>('main');

	const themeOptions = useMemo(
		() => [
			{
				label:
					selectedTheme === 'dark'
						? `✓ ${t.themeSettings.darkTheme}`
						: t.themeSettings.darkTheme,
				value: 'dark',
				infoText: t.themeSettings.darkThemeInfo,
			},
			{
				label:
					selectedTheme === 'light'
						? `✓ ${t.themeSettings.lightTheme}`
						: t.themeSettings.lightTheme,
				value: 'light',
				infoText: t.themeSettings.lightThemeInfo,
			},
			{
				label:
					selectedTheme === 'github-dark'
						? `✓ ${t.themeSettings.githubDark}`
						: t.themeSettings.githubDark,
				value: 'github-dark',
				infoText: t.themeSettings.githubDarkInfo,
			},
			{
				label:
					selectedTheme === 'rainbow'
						? `✓ ${t.themeSettings.rainbow}`
						: t.themeSettings.rainbow,
				value: 'rainbow',
				infoText: t.themeSettings.rainbowInfo,
			},
			{
				label:
					selectedTheme === 'solarized-dark'
						? `✓ ${t.themeSettings.solarizedDark}`
						: t.themeSettings.solarizedDark,
				value: 'solarized-dark',
				infoText: t.themeSettings.solarizedDarkInfo,
			},
			{
				label:
					selectedTheme === 'nord'
						? `✓ ${t.themeSettings.nord}`
						: t.themeSettings.nord,
				value: 'nord',
				infoText: t.themeSettings.nordInfo,
			},
			{
				label:
					selectedTheme === 'custom'
						? `✓ ${t.themeSettings?.custom || 'Custom'}`
						: t.themeSettings?.custom || 'Custom',
				value: 'custom',
				infoText: t.themeSettings?.customInfo || 'Use your own custom colors',
			},
			{
				label: t.themeSettings?.editCustom || 'Edit Custom Theme...',
				value: 'edit-custom',
				infoText: t.themeSettings?.editCustomInfo || 'Customize theme colors',
			},
			{
				label: t.themeSettings.back,
				value: 'back',
				color: 'gray',
				infoText: t.themeSettings.backInfo,
			},
		],
		[selectedTheme, t],
	);

	const handleSelect = useCallback(
		(value: string) => {
			if (value === 'back') {
				// Restore original theme if cancelled
				setThemeType(selectedTheme);
				onBack();
			} else if (value === 'edit-custom') {
				// Go to custom theme editor
				setScreen('custom');
			} else {
				// Confirm and apply the theme (Enter pressed)
				const newTheme = value as ThemeType;
				setSelectedTheme(newTheme);
				setThemeType(newTheme);
			}
		},
		[onBack, setThemeType, selectedTheme],
	);

	const handleSelectionChange = useCallback(
		(newInfoText: string, value: string) => {
			setInfoText(newInfoText);
			// Preview theme on selection change (navigation)
			if (value === 'back' || value === 'edit-custom') {
				// Restore to selected theme when hovering on "Back" or "Edit Custom"
				setThemeType(selectedTheme);
			} else {
				// Preview the theme
				setThemeType(value as ThemeType);
			}
		},
		[setThemeType, selectedTheme],
	);

	const handleBackFromCustom = useCallback(() => {
		setScreen('main');
	}, []);

	useInput((_input, key) => {
		if (key.escape) {
			// Restore original theme on ESC
			setThemeType(selectedTheme);
			onBack();
		}
	});

	if (screen === 'custom') {
		return (
			<Suspense fallback={<Spinner label="Loading..." />}>
				<CustomThemeScreen onBack={handleBackFromCustom} />
			</Suspense>
		);
	}

	return (
		<Box flexDirection="column">
			{!inlineMode && (
				<Box borderStyle="round" borderColor="cyan" paddingX={1}>
					<Text bold color="cyan">
						{t.themeSettings.title}
					</Text>
				</Box>
			)}

			<Box flexDirection="column" paddingX={1}>
				<Text color="gray" dimColor>
					{t.themeSettings.current}{' '}
					{themeOptions
						.find(opt => opt.value === selectedTheme)
						?.label.replace('✓ ', '') || selectedTheme}
				</Text>
			</Box>

			<Menu
				options={themeOptions}
				onSelect={handleSelect}
				onSelectionChange={handleSelectionChange}
			/>

			<Box flexDirection="column" paddingX={1}>
				<Text color="gray" dimColor>
					{t.themeSettings.preview}
				</Text>
				<DiffViewer
					oldContent={sampleOldCode}
					newContent={sampleNewCode}
					filename="example.ts"
				/>
			</Box>

			{infoText && (
				<Box paddingX={1}>
					<Alert variant="info">{infoText}</Alert>
				</Box>
			)}
		</Box>
	);
}
