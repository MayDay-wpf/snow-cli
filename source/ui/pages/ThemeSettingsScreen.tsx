import React, {
	useMemo,
	useCallback,
	useState,
	useEffect,
	Suspense,
} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import {Alert, Spinner} from '@inkjs/ui';
import Menu from '../components/common/Menu.js';
import DiffViewer from '../components/tools/DiffViewer.js';
import UserMessagePreview from '../components/chat/UserMessagePreview.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {ThemeType} from '../themes/index.js';
import {useI18n} from '../../i18n/index.js';
import {
	getSimpleMode,
	setSimpleMode,
	getToolDisplayMode,
	setToolDisplayMode,
	getThinkDisplayMode,
	setThinkDisplayMode,
	getSubAgentDisplayMode,
	setSubAgentDisplayMode,
	type ToolDisplayMode,
	type ThinkDisplayMode,
	type SubAgentDisplayMode,
} from '../../utils/config/themeConfig.js';
import {configEvents} from '../../utils/config/configEvents.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';

const CustomThemeScreen = React.lazy(() => import('./CustomThemeScreen.js'));

type Props = {
	onBack: () => void;
	inlineMode?: boolean;
};

type Screen = 'main' | 'custom';

const TOOL_DISPLAY_CYCLE: ToolDisplayMode[] = ['full', 'compact', 'hidden'];
const THINK_DISPLAY_CYCLE: ThinkDisplayMode[] = ['compact', 'full'];
const SUBAGENT_DISPLAY_CYCLE: SubAgentDisplayMode[] = [
	'slots',
	'multi',
	'compact',
	'hidden',
];

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
	const {themeType, setThemeType, diffOpacity, setDiffOpacity} = useTheme();
	const {t} = useI18n();
	useTerminalTitle(`Snow CLI - ${t.themeSettings.title}`);
	const {stdout} = useStdout();

	// Use themeType from context which is already loaded from config
	const [selectedTheme, setSelectedTheme] = useState<ThemeType>(themeType);
	const [infoText, setInfoText] = useState<string>('');
	const [screen, setScreen] = useState<Screen>('main');
	const [simpleMode, setSimpleModeState] = useState<boolean>(() =>
		getSimpleMode(),
	);
	const [toolDisplayMode, setToolDisplayModeState] = useState<ToolDisplayMode>(
		() => getToolDisplayMode(),
	);
	const [thinkDisplayMode, setThinkDisplayModeState] =
		useState<ThinkDisplayMode>(() => getThinkDisplayMode());
	const [subAgentDisplayMode, setSubAgentDisplayModeState] =
		useState<SubAgentDisplayMode>(() => getSubAgentDisplayMode());
	const terminalHeight = stdout?.rows || 24;
	const themeMenuHeight = Math.max(4, Math.min(8, terminalHeight - 18));

	// Load simple mode + display modes on mount
	useEffect(() => {
		setSimpleModeState(getSimpleMode());
		setToolDisplayModeState(getToolDisplayMode());
		setThinkDisplayModeState(getThinkDisplayMode());
		setSubAgentDisplayModeState(getSubAgentDisplayMode());
	}, []);

	const handleToggleSimpleMode = useCallback(() => {
		const newSimpleMode = !simpleMode;
		setSimpleModeState(newSimpleMode);
		setSimpleMode(newSimpleMode);
	}, [simpleMode]);

	const handleAdjustDiffOpacity = useCallback(() => {
		const nextOpacity = diffOpacity >= 1 ? 0.3 : diffOpacity + 0.1;
		setDiffOpacity(Number(nextOpacity.toFixed(2)));
	}, [diffOpacity, setDiffOpacity]);

	const handleCycleToolDisplay = useCallback(() => {
		const idx = TOOL_DISPLAY_CYCLE.indexOf(toolDisplayMode);
		const next =
			TOOL_DISPLAY_CYCLE[(idx + 1) % TOOL_DISPLAY_CYCLE.length] ?? 'full';
		setToolDisplayModeState(next);
		setToolDisplayMode(next);
		configEvents.emitConfigChange({type: 'toolDisplayMode', value: next});
	}, [toolDisplayMode]);

	const handleCycleThinkDisplay = useCallback(() => {
		const idx = THINK_DISPLAY_CYCLE.indexOf(thinkDisplayMode);
		const next =
			THINK_DISPLAY_CYCLE[(idx + 1) % THINK_DISPLAY_CYCLE.length] ?? 'compact';
		setThinkDisplayModeState(next);
		setThinkDisplayMode(next);
		configEvents.emitConfigChange({type: 'thinkDisplayMode', value: next});
	}, [thinkDisplayMode]);

	const handleCycleSubAgentDisplay = useCallback(() => {
		const idx = SUBAGENT_DISPLAY_CYCLE.indexOf(subAgentDisplayMode);
		const next =
			SUBAGENT_DISPLAY_CYCLE[(idx + 1) % SUBAGENT_DISPLAY_CYCLE.length] ??
			'slots';
		setSubAgentDisplayModeState(next);
		setSubAgentDisplayMode(next);
		configEvents.emitConfigChange({type: 'subAgentDisplayMode', value: next});
	}, [subAgentDisplayMode]);

	const themeOptions = useMemo(
		() => [
			{
				label: `${t.themeSettings.simpleMode} ${
					simpleMode ? t.themeSettings.enabled : t.themeSettings.disabled
				}`,
				value: 'simple-mode',
				infoText: t.themeSettings.simpleModeInfo,
			},
			{
				label: `${t.themeSettings.diffOpacity} ${Math.round(
					diffOpacity * 100,
				)}%`,
				value: 'diff-opacity',
				infoText: t.themeSettings.diffOpacityInfo,
			},
			{
				label: `${t.themeSettings.toolDisplay} ${t.displayPanel.formatMode(
					toolDisplayMode,
				)}`,
				value: 'tool-display',
				infoText: t.themeSettings.toolDisplayInfo,
			},
			{
				label: `${t.themeSettings.thinkDisplay} ${t.displayPanel.formatMode(
					thinkDisplayMode,
				)}`,
				value: 'think-display',
				infoText: t.themeSettings.thinkDisplayInfo,
			},
			{
				label: `${t.themeSettings.subAgentDisplay} ${t.displayPanel.formatMode(
					subAgentDisplayMode,
				)}`,
				value: 'subagent-display',
				infoText: t.themeSettings.subAgentDisplayInfo,
			},
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
					selectedTheme === 'tiffany'
						? `✓ ${t.themeSettings.tiffany}`
						: t.themeSettings.tiffany,
				value: 'tiffany',
				infoText: t.themeSettings.tiffanyInfo,
			},
			{
				label:
					selectedTheme === 'macaron-pink'
						? `✓ ${t.themeSettings.macaronPink}`
						: t.themeSettings.macaronPink,
				value: 'macaron-pink',
				infoText: t.themeSettings.macaronPinkInfo,
			},
			{
				label:
					selectedTheme === 'trump-gold'
						? `✓ ${t.themeSettings.trumpGold}`
						: t.themeSettings.trumpGold,
				value: 'trump-gold',
				infoText: t.themeSettings.trumpGoldInfo,
			},
			{
				label:
					selectedTheme === 'china-red'
						? `✓ ${t.themeSettings.chinaRed}`
						: t.themeSettings.chinaRed,
				value: 'china-red',
				infoText: t.themeSettings.chinaRedInfo,
			},
			{
				label:
					selectedTheme === 'eva-purple'
						? `✓ ${t.themeSettings.evaPurple}`
						: t.themeSettings.evaPurple,
				value: 'eva-purple',
				infoText: t.themeSettings.evaPurpleInfo,
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
		[
			selectedTheme,
			simpleMode,
			diffOpacity,
			toolDisplayMode,
			thinkDisplayMode,
			subAgentDisplayMode,
			t,
		],
	);

	const handleSelect = useCallback(
		(value: string) => {
			if (value === 'back') {
				// Restore original theme if cancelled
				setThemeType(selectedTheme);
				onBack();
			} else if (value === 'simple-mode') {
				// Toggle simple mode
				handleToggleSimpleMode();
			} else if (value === 'diff-opacity') {
				handleAdjustDiffOpacity();
			} else if (value === 'tool-display') {
				handleCycleToolDisplay();
			} else if (value === 'think-display') {
				handleCycleThinkDisplay();
			} else if (value === 'subagent-display') {
				handleCycleSubAgentDisplay();
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
		[
			onBack,
			setThemeType,
			selectedTheme,
			handleToggleSimpleMode,
			handleAdjustDiffOpacity,
			handleCycleToolDisplay,
			handleCycleThinkDisplay,
			handleCycleSubAgentDisplay,
		],
	);

	const handleSelectionChange = useCallback(
		(newInfoText: string, value: string) => {
			setInfoText(newInfoText);
			// Preview theme on selection change (navigation)
			if (
				value === 'back' ||
				value === 'edit-custom' ||
				value === 'simple-mode' ||
				value === 'diff-opacity' ||
				value === 'tool-display' ||
				value === 'think-display' ||
				value === 'subagent-display'
			) {
				// Restore to selected theme when hovering non-theme rows
				setThemeType(selectedTheme);
			} else {
				// Preview the theme
				setThemeType(value as ThemeType);
			}
		},
		[setThemeType, selectedTheme],
	);

	const handleBackFromCustom = useCallback((nextSelectedTheme?: ThemeType) => {
		setScreen('main');
		if (nextSelectedTheme) {
			setSelectedTheme(nextSelectedTheme);
		}
	}, []);

	useInput(
		(_input, key) => {
			if (key.escape) {
				// Restore original theme on ESC
				setThemeType(selectedTheme);
				onBack();
			}
		},
		{isActive: screen === 'main'},
	);

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
				maxHeight={themeMenuHeight}
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
				<Box flexDirection="column">
					<Text color="gray" dimColor>
						{t.themeSettings.userMessagePreview}
					</Text>
					<UserMessagePreview content={t.themeSettings.userMessageSample} />
				</Box>
			</Box>

			{infoText && (
				<Box paddingX={1}>
					<Alert variant="info">{infoText}</Alert>
				</Box>
			)}
		</Box>
	);
}
