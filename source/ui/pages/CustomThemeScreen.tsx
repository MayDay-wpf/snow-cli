import React, {useState, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import Menu from '../components/common/Menu.js';
import DiffViewer from '../components/tools/DiffViewer.js';
import UserMessagePreview from '../components/chat/UserMessagePreview.js';
import {ThemeContext, useTheme} from '../contexts/ThemeContext.js';
import {
	ThemeColors,
	ThemeType,
	defaultCustomColors,
	getCustomTheme,
} from '../themes/index.js';
import {saveCustomColors} from '../../utils/config/themeConfig.js';
import {useI18n} from '../../i18n/index.js';

type Props = {
	onBack: (nextSelectedTheme?: ThemeType) => void;
};

type ColorKey = keyof ThemeColors;

const colorKeys: ColorKey[] = [
	'background',
	'text',
	'border',
	'diffAdded',
	'diffRemoved',
	'diffModified',
	'lineNumber',
	'lineNumberBorder',
	'menuSelected',
	'menuNormal',
	'menuInfo',
	'menuSecondary',
	'error',
	'warning',
	'success',
	'logoGradient',
	'userMessageBackground',
];

const sampleOldCode = `function greet(name) {
  console.log("Hello " + name);
  return "Welcome!";
}`;

const sampleNewCode = `function greet(name: string): string {
  console.log(\`Hello \${name}\`);
  return \`Welcome, \${name}!\`;
}`;

export default function CustomThemeScreen({onBack}: Props) {
	const {setThemeType, refreshCustomTheme} = useTheme();
	const {t} = useI18n();
	const [colors, setColors] = useState<ThemeColors>(() => {
		const custom = getCustomTheme();
		return custom.colors;
	});
	const [editingKey, setEditingKey] = useState<ColorKey | null>(null);
	const [editValue, setEditValue] = useState('');
	const [infoText, setInfoText] = useState('');

	const menuOptions = useMemo(() => {
		const options: Array<{label: string; value: string; infoText: string}> =
			colorKeys.map(key => ({
				label: `${key}: ${colors[key]}`,
				value: key,
				infoText: t.customTheme?.colorHint || 'Press Enter to edit this color',
			}));
		options.push({
			label: t.customTheme?.save || 'Save',
			value: 'save',
			infoText: t.customTheme?.saveInfo || 'Save custom theme colors',
		});
		options.push({
			label: t.customTheme?.reset || 'Reset to Default',
			value: 'reset',
			infoText: t.customTheme?.resetInfo || 'Reset all colors to default',
		});
		options.push({
			label: t.customTheme?.back || '← Back',
			value: 'back',
			infoText: t.customTheme?.backInfo || 'Return to theme settings',
		});
		return options;
	}, [colors, t]);

	const saveAndExit = useCallback(() => {
		saveCustomColors(colors);
		refreshCustomTheme?.();
		setThemeType('custom');
		onBack('custom');
	}, [colors, onBack, refreshCustomTheme, setThemeType]);

	const handleSelect = useCallback(
		(value: string) => {
			if (value === 'back') {
				onBack();
			} else if (value === 'save') {
				saveAndExit();
			} else if (value === 'reset') {
				setColors({...defaultCustomColors});
			} else {
				const key = value as ColorKey;
				setEditingKey(key);
				// Handle array type for logoGradient
				const colorValue = colors[key];
				setEditValue(
					Array.isArray(colorValue) ? colorValue.join(', ') : colorValue,
				);
			}
		},
		[onBack, saveAndExit, colors],
	);

	const handleSelectionChange = useCallback((newInfoText: string) => {
		setInfoText(newInfoText);
	}, []);

	const handleEditSubmit = useCallback(() => {
		if (editingKey && editValue.trim()) {
			setColors(prev => {
				const newValue =
					editingKey === 'logoGradient'
						? (editValue
								.split(',')
								.map(v => v.trim())
								.filter(v => v) as [string, string, string])
						: editValue.trim();
				return {
					...prev,
					[editingKey]: newValue,
				};
			});
		}
		setEditingKey(null);
		setEditValue('');
	}, [editingKey, editValue]);

	useInput((_input, key) => {
		if (key.escape) {
			if (editingKey) {
				setEditingKey(null);
				setEditValue('');
			} else {
				saveAndExit();
			}
		}
	});

	if (editingKey) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text bold color="cyan">
					{t.customTheme?.editColor || 'Edit Color'}: {editingKey}
				</Text>
				<Box marginTop={1}>
					<Text>{t.customTheme?.currentValue || 'Current'}: </Text>
					<Text>
						{Array.isArray(colors[editingKey])
							? (colors[editingKey] as [string, string, string]).join(', ')
							: colors[editingKey]}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text>{t.customTheme?.newValue || 'New value'}: </Text>
					<TextInput
						value={editValue}
						onChange={setEditValue}
						onSubmit={handleEditSubmit}
					/>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>
						{t.customTheme?.colorFormat ||
							'Format: #RRGGBB or color name (red, blue, etc.)'}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>
						ESC: {t.customTheme?.cancel || 'Cancel'} | Enter:{' '}
						{t.customTheme?.confirm || 'Confirm'}
					</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Box borderStyle="round" borderColor="cyan" paddingX={1}>
				<Text bold color="cyan">
					{t.customTheme?.title || 'Custom Theme Editor'}
				</Text>
			</Box>

			<Menu
				options={menuOptions}
				onSelect={handleSelect}
				onSelectionChange={handleSelectionChange}
			/>

			<Box flexDirection="column" paddingX={1} marginTop={1}>
				<Text color="gray" dimColor>
					{t.customTheme?.preview || 'Preview'}:
				</Text>
				<ThemeContext.Provider
					value={{
						theme: {name: 'Custom', type: 'custom', colors},
						themeType: 'custom',
						setThemeType,
						refreshCustomTheme,
					}}
				>
					<DiffViewer
						oldContent={sampleOldCode}
						newContent={sampleNewCode}
						filename="example.ts"
					/>
					<Box marginTop={1} flexDirection="column">
						<Text color="gray" dimColor>
							{t.customTheme?.userMessagePreview || 'User message preview'}:
						</Text>
						<UserMessagePreview
							content={
								t.customTheme?.userMessageSample ||
								'这个预览用于检查 userMessageBackground 是否合适'
							}
						/>
					</Box>
				</ThemeContext.Provider>
			</Box>

			{infoText && (
				<Box paddingX={1} marginTop={1}>
					<Text color="gray">{infoText}</Text>
				</Box>
			)}
		</Box>
	);
}
