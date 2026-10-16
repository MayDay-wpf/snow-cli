import React, {useState, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import Menu from '../components/common/Menu.js';
import {ThemeContext, useTheme} from '../contexts/ThemeContext.js';
import {
	ThemeColors,
	ThemeType,
	getCustomTheme,
} from '../themes/index.js';
import {saveCustomColors} from '../../utils/config/themeConfig.js';
import {useI18n} from '../../i18n/index.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import {
	generatePerceptualTheme,
	MOOD_PROFILES,
	MoodType,
	DiffHarmonyType,
} from '../../utils/color-science/engine.js';
import {hexToOklch} from '../../utils/color-science/oklch.js';
import {
	getActiveProfileName,
	loadProfile,
} from '../../utils/config/configManager.js';
import UserMessagePreview from '../components/chat/UserMessagePreview.js';
import DiffViewer from '../components/tools/DiffViewer.js';
import {logger} from '../../utils/core/logger.js';

const pageLog = logger.child('ui:pages');

type Props = {
	onBack: (nextSelectedTheme?: ThemeType) => void;
};

type ColorKey = keyof ThemeColors;
type EditorMode = 'studio' | 'expert';
type StudioField =
	| 'hue'
	| 'chroma'
	| 'mood'
	| 'luminanceBias'
	| 'diffHarmony'
	| 'diffIntensity';

const STUDIO_FIELDS: StudioField[] = [
	'hue',
	'chroma',
	'mood',
	'luminanceBias',
	'diffHarmony',
	'diffIntensity',
];

const colorKeys: ColorKey[] = [
	'background',
	'text',
	'border',
	'diffAdded',
	'diffRemoved',
	'diffModified',
	'diffAddedForeground',
	'diffRemovedForeground',
	'lineNumber',
	'lineNumberBorder',
	'menuSelected',
	'menuNormal',
	'menuInfo',
	'menuSecondary',
	'error',
	'warning',
	'success',
	'cyan',
	'logoGradient',
	'userMessageBackground',
	'userMessageText',
	'diffOpacity',
];

const MOODS: MoodType[] = ['oled', 'abyss', 'charcoal', 'slate', 'matrix', 'mist'];
const DIFF_HARMONIES: DiffHarmonyType[] = ['adaptive', 'classic', 'accessible'];

export default function CustomThemeScreen({onBack}: Props) {
	const {setThemeType, refreshCustomTheme} = useTheme();
	const {t} = useI18n();

	useTerminalTitle(
		`Snow CLI - ${t.customTheme?.title || '感知色彩调谐工坊 (OKLCH+APCA)'}`,
	);

	const initialCustom = useMemo(() => getCustomTheme().colors, []);
	const initialOklch = useMemo(() => {
		try {
			return hexToOklch(initialCustom.text || '#ffffff');
		} catch (error) {
			pageLog.debug('Failed to parse hex to oklch', {error});
			return {h: 215, c: 0.16, l: 0.85};
		}
	}, [initialCustom]);

	const [mode, setMode] = useState<EditorMode>('studio');
	const [activeField, setActiveField] = useState<StudioField>('hue');
	const [hue, setHue] = useState<number>(Math.round(initialOklch.h || 215));
	const [chroma, setChroma] = useState<number>(0.16);
	const [moodIndex, setMoodIndex] = useState<number>(3); // 'slate'
	const [luminanceBias, setLuminanceBias] = useState<number>(0.0);
	const [diffHarmonyIndex, setDiffHarmonyIndex] = useState<number>(0); // 'adaptive'
	const [diffIntensity, setDiffIntensity] = useState<number>(75);
	const [overrides, setOverrides] = useState<Partial<ThemeColors>>({});

	// 读取真实运行环境的 Profile 与 Model
	const activeProfileName = useMemo(() => getActiveProfileName() || 'default', []);
	const activeModelName = useMemo(() => {
		try {
			const profile = loadProfile(activeProfileName);
			return (
				profile?.snowcfg?.advancedModel ||
				profile?.snowcfg?.basicModel ||
				activeProfileName
			);
		} catch (error) {
			pageLog.debug('Failed to load profile for active model name', {error});
			return 'default';
		}
	}, [activeProfileName]);

	// 生成当前派生的调色板、APCA 极品清晰度分数及 12-Step 色带
	const {colors, apcaScore, steps} = useMemo(() => {
		return generatePerceptualTheme({
			hue,
			chroma,
			mood: MOODS[moodIndex] || 'slate',
			luminanceBias,
			diffHarmony: DIFF_HARMONIES[diffHarmonyIndex] || 'adaptive',
			diffIntensity,
			overrides,
		});
	}, [hue, chroma, moodIndex, luminanceBias, diffHarmonyIndex, diffIntensity, overrides]);

	// 局域 ThemeContext 实例，驱动子组件在内存中以 60FPS 实时响应调色，零磁盘 I/O 抖动
	const previewThemeContextValue = useMemo(
		() => ({
			theme: {
				type: 'custom' as ThemeType,
				name: 'custom',
				colors,
			},
			themeType: 'custom' as ThemeType,
			diffOpacity: colors.diffOpacity ?? 0.75,
			setThemeType: () => {},
			setDiffOpacity: () => {},
		}),
		[colors],
	);

	const [editingKey, setEditingKey] = useState<ColorKey | null>(null);
	const [editValue, setEditValue] = useState('');
	const [infoText, setInfoText] = useState('');

	const saveAndExit = useCallback(() => {
		saveCustomColors(colors);
		refreshCustomTheme?.();
		setThemeType('custom');
		onBack('custom');
	}, [colors, onBack, refreshCustomTheme, setThemeType]);

	// 键盘左右/上下实时滑动响应
	useInput((input, key) => {
		if (editingKey) {
			if (key.escape) {
				setEditingKey(null);
				setEditValue('');
			}
			return;
		}

		if (key.escape || input === 'q' || input === 'Q') {
			saveAndExit();
			return;
		}

		// Tab 键在感知工坊 (Studio) 与极客微调 (Expert) 模式间切换
		if (key.tab) {
			setMode(prev => (prev === 'studio' ? 'expert' : 'studio'));
			return;
		}

		// 快捷保存
		if (input === 's' || input === 'S') {
			saveAndExit();
			return;
		}

		// 感知工坊模式下的左右/上下控制
		if (mode === 'studio') {
			if (key.upArrow) {
				setActiveField(prev => {
					const idx = STUDIO_FIELDS.indexOf(prev);
					return STUDIO_FIELDS[(idx - 1 + STUDIO_FIELDS.length) % STUDIO_FIELDS.length]!;
				});
			} else if (key.downArrow) {
				setActiveField(prev => {
					const idx = STUDIO_FIELDS.indexOf(prev);
					return STUDIO_FIELDS[(idx + 1) % STUDIO_FIELDS.length]!;
				});
			} else if (key.leftArrow) {
				const shift = key.shift;
				if (activeField === 'hue') {
					setHue(prev => (prev - (shift ? 15 : 5) + 360) % 360);
				} else if (activeField === 'chroma') {
					setChroma(prev => Math.max(0.00, Math.round((prev - (shift ? 0.05 : 0.01)) * 100) / 100));
				} else if (activeField === 'mood') {
					setMoodIndex(prev => (prev - 1 + MOODS.length) % MOODS.length);
				} else if (activeField === 'luminanceBias') {
					setLuminanceBias(prev => Math.max(-0.06, Math.round((prev - 0.01) * 100) / 100));
				} else if (activeField === 'diffHarmony') {
					setDiffHarmonyIndex(prev => (prev - 1 + DIFF_HARMONIES.length) % DIFF_HARMONIES.length);
				} else if (activeField === 'diffIntensity') {
					setDiffIntensity(prev => Math.max(20, prev - (shift ? 15 : 5)));
				}
			} else if (key.rightArrow) {
				const shift = key.shift;
				if (activeField === 'hue') {
					setHue(prev => (prev + (shift ? 15 : 5)) % 360);
				} else if (activeField === 'chroma') {
					setChroma(prev => Math.min(0.35, Math.round((prev + (shift ? 0.05 : 0.01)) * 100) / 100));
				} else if (activeField === 'mood') {
					setMoodIndex(prev => (prev + 1) % MOODS.length);
				} else if (activeField === 'luminanceBias') {
					setLuminanceBias(prev => Math.min(0.06, Math.round((prev + 0.01) * 100) / 100));
				} else if (activeField === 'diffHarmony') {
					setDiffHarmonyIndex(prev => (prev + 1) % DIFF_HARMONIES.length);
				} else if (activeField === 'diffIntensity') {
					setDiffIntensity(prev => Math.min(100, prev + (shift ? 15 : 5)));
				}
			}
		}
	});

	const menuOptions = useMemo(() => {
		const options: Array<{label: string; value: string; infoText: string}> =
			colorKeys.map(key => ({
				label: `${key}: ${colors[key]}`,
				value: key,
				infoText: t.customTheme?.colorHint || '按回车编辑此颜色 Token',
			}));
		options.push({
			label: t.customTheme?.save || '保存主题并退出 (S / Enter)',
			value: 'save',
			infoText: t.customTheme?.saveInfo || '保存当前自定义主题设置',
		});
		options.push({
			label: t.customTheme?.reset || '重置为工坊基准底模',
			value: 'reset',
			infoText: t.customTheme?.resetInfo || '清除单个 Token 的手动覆写',
		});
		options.push({
			label: t.customTheme?.back || '← 返回主题设置',
			value: 'back',
			infoText: t.customTheme?.backInfo || '返回上一级设置界面',
		});
		return options;
	}, [colors, t]);

	const handleSelect = useCallback(
		(value: string) => {
			if (value === 'back') {
				onBack();
			} else if (value === 'save') {
				saveAndExit();
			} else if (value === 'reset') {
				setOverrides({});
			} else {
				const key = value as ColorKey;
				setEditingKey(key);
				const colorValue = colors[key];
				setEditValue(
					Array.isArray(colorValue)
						? colorValue.join(', ')
						: String(colorValue),
				);
			}
		},
		[onBack, saveAndExit, colors],
	);

	const handleEditSubmit = useCallback(() => {
		if (editingKey && editValue.trim()) {
			const newValue =
				editingKey === 'logoGradient'
					? (editValue
							.split(',')
							.map(v => v.trim())
							.filter(v => v) as [string, string, string])
					: editingKey === 'diffOpacity'
					? Math.max(0, Math.min(1, Number.parseFloat(editValue.trim()) || 0))
					: editValue.trim();

			setOverrides(prev => ({
				...prev,
				[editingKey]: newValue,
			}));
		}

		setEditingKey(null);
		setEditValue('');
	}, [editingKey, editValue]);

	// 单独编辑 Token 的遮罩层
	if (editingKey) {
		return (
			<Box flexDirection="column" padding={1} borderStyle="round" borderColor="cyan">
				<Text bold color="cyan">
					{t.customTheme?.editColor || '覆写 Token'}: {editingKey}
				</Text>
				<Box marginTop={1}>
					<Text>{t.customTheme?.currentValue || '当前值'}: </Text>
					<Text>
						{Array.isArray(colors[editingKey])
							? (colors[editingKey] as [string, string, string]).join(', ')
							: String(colors[editingKey])}
					</Text>
				</Box>
				<Box marginTop={1}>
					<Text>{t.customTheme?.newValue || '新色值'}: </Text>
					<TextInput
						value={editValue}
						onChange={setEditValue}
						onSubmit={handleEditSubmit}
					/>
				</Box>
				<Box marginTop={1}>
					<Text dimColor>
						ESC: {t.customTheme?.cancel || '取消'} | Enter: {t.customTheme?.confirm || '确认'}
					</Text>
				</Box>
			</Box>
		);
	}

	const currentMood = MOODS[moodIndex] || 'slate';
	const moodProfile = MOOD_PROFILES[currentMood];
	const currentDiffHarmony = DIFF_HARMONIES[diffHarmonyIndex] || 'adaptive';

	const hueWidth = 26;
	const huePos = Math.round((hue / 360) * (hueWidth - 1));
	let hueBar = '';
	for (let i = 0; i < hueWidth; i++) hueBar += i === huePos ? 'O' : '─';

	const diffHarmonyLabels: Record<DiffHarmonyType, string> = {
		adaptive: t.customTheme?.diffHarmonyAdaptive || '自适应共振',
		classic: t.customTheme?.diffHarmonyClassic || '经典红绿',
		accessible: t.customTheme?.diffHarmonyAccessible || '蓝橙无障碍',
	};

	return (
		<Box flexDirection="column">
			{/* 顶部标题与模式状态栏 */}
			<Box paddingX={1} justifyContent="space-between">
				<Text bold color={colors.cyan}>
					Snow CLI - {t.customTheme?.title || '感知色彩调谐工坊 (OKLCH+APCA)'}
				</Text>
				<Box>
					<Text color={colors.lineNumber}>[模式: </Text>
					<Text bold color={mode === 'studio' ? colors.success : colors.warning}>
						{mode === 'studio'
							? t.customTheme?.studioMode || 'Studio 宏观滑台'
							: t.customTheme?.expertMode || 'Expert 逐项覆写'}
					</Text>
					<Text color={colors.lineNumber}> {t.customTheme?.modeToggleHint || '(Tab 切换)'}]</Text>
				</Box>
			</Box>

			{/* 实时 APCA 对比度硬门禁与按键操作指引 */}
			<Box paddingX={1} justifyContent="space-between">
				<Text color={colors.text}>
					{t.customTheme?.apcaLabel || 'APCA 极品对比度'}:{' '}
					<Text bold color={apcaScore >= 75 ? colors.success : colors.warning}>
						{apcaScore} Lc (WCAG 3{' '}
						{apcaScore >= 75
							? t.customTheme?.apcaRatingPass || '✓ PASS'
							: t.customTheme?.apcaRatingWeak || '⚠ WEAK'}
						)
					</Text>
				</Text>
				<Text color={colors.lineNumber} dimColor>
					{t.customTheme?.keyNavHint || '↑↓ 换项 | ←→ 滑动 (Shift 加速) | S 保存 | ESC 退出'}
				</Text>
			</Box>

			{/* 六维参数实时调谐器 */}
			{mode === 'studio' ? (
				<Box
					flexDirection="column"
					borderStyle="single"
					borderColor={colors.border}
					paddingX={1}
					marginTop={0}
				>
					{/* 1. 色相 Hue */}
					<Box justifyContent="space-between">
						<Text bold color={activeField === 'hue' ? colors.cyan : colors.text}>
							{activeField === 'hue' ? ' > ' : '   '}
							{t.customTheme?.fieldHue || '色相 (Hue)'}: {hue.toString().padStart(3)} deg
						</Text>
						<Box>
							<Text color={colors.lineNumber}>[</Text>
							<Text bold color={colors.diffAddedForeground}>{hueBar}</Text>
							<Text color={colors.lineNumber}>]</Text>
						</Box>
					</Box>

					{/* 2. 彩度 Chroma */}
					<Box justifyContent="space-between">
						<Text bold color={activeField === 'chroma' ? colors.cyan : colors.text}>
							{activeField === 'chroma' ? ' > ' : '   '}
							{t.customTheme?.fieldChroma || '彩度 (Chroma)'}: {chroma.toFixed(2)}
						</Text>
						<Box>
							<Text color={colors.lineNumber}>[</Text>
							<Text bold color={colors.diffAddedForeground}>
								{'#'.repeat(Math.round(chroma * 70)).padEnd(26)}
							</Text>
							<Text color={colors.lineNumber}>]</Text>
						</Box>
					</Box>

					{/* 3. 情绪基锚底模 Mood */}
					<Box justifyContent="space-between">
						<Text bold color={activeField === 'mood' ? colors.cyan : colors.text}>
							{activeField === 'mood' ? ' > ' : '   '}
							{t.customTheme?.fieldMood || '基底底模 (Mood)'}: {currentMood.toUpperCase()}
						</Text>
						<Text color={colors.lineNumber}>{moodProfile?.description}</Text>
					</Box>

					{/* 4. 底模明度偏置微调轴 Luminance Bias */}
					<Box justifyContent="space-between">
						<Text bold color={activeField === 'luminanceBias' ? colors.cyan : colors.text}>
							{activeField === 'luminanceBias' ? ' > ' : '   '}
							{t.customTheme?.fieldLuminanceBias || '明度偏置 (Bias)'}: {luminanceBias > 0 ? `+${luminanceBias.toFixed(2)}` : luminanceBias.toFixed(2)}
						</Text>
						<Box>
							<Text color={colors.lineNumber}>[</Text>
							<Text bold color={colors.cyan}>
								{'='.repeat(Math.round((luminanceBias + 0.06) * 200)).padEnd(24)}
							</Text>
							<Text color={colors.lineNumber}>]</Text>
						</Box>
					</Box>

					{/* 5. Diff 比对配色模式 */}
					<Box justifyContent="space-between">
						<Text bold color={activeField === 'diffHarmony' ? colors.cyan : colors.text}>
							{activeField === 'diffHarmony' ? ' > ' : '   '}
							{t.customTheme?.fieldDiffHarmony || '比对配色 (Diff Harmony)'}: {diffHarmonyLabels[currentDiffHarmony]}
						</Text>
						<Text color={colors.lineNumber}>
							[ {DIFF_HARMONIES.map(h => (h === currentDiffHarmony ? `*${h}` : h)).join(' | ')} ]
						</Text>
					</Box>

					{/* 6. Diff 浸润度 */}
					<Box justifyContent="space-between">
						<Text bold color={activeField === 'diffIntensity' ? colors.cyan : colors.text}>
							{activeField === 'diffIntensity' ? ' > ' : '   '}
							{t.customTheme?.fieldDiffIntensity || '比对浸润度 (Diff Intensity)'}: {diffIntensity}%
						</Text>
						<Box>
							<Text color={colors.lineNumber}>[</Text>
							<Text bold color={colors.diffAddedForeground}>
								{'='.repeat(Math.round((diffIntensity / 100) * 24)).padEnd(24)}
							</Text>
							<Text color={colors.lineNumber}>]</Text>
						</Box>
					</Box>

					{/* 12-Step 派生色阶带 */}
					<Box marginTop={0}>
						<Text color={colors.text}>【12-Step 色阶】: </Text>
						<Box>
							{steps.map((stHex, idx) => (
								<Text key={idx} backgroundColor={stHex}>
									{'  '}
								</Text>
							))}
						</Box>
						<Text color={colors.lineNumber} dimColor>
							{' '}Bg={colors.background} | Card={colors.userMessageBackground} | Accent={colors.cyan}
						</Text>
					</Box>
				</Box>
			) : (
				<Box flexDirection="column" marginTop={0}>
					<Menu
						options={menuOptions}
						maxHeight={4}
						onSelect={handleSelect}
						onSelectionChange={setInfoText}
					/>
					{infoText && (
						<Box paddingX={1}>
							<Text color={colors.lineNumber}>{infoText}</Text>
						</Box>
					)}
				</Box>
			)}

			{/* 原生拟真表现层: 100% 复用真实原生业务组件，杜绝手绘假字符与静态假造数据 */}
			<ThemeContext.Provider value={previewThemeContextValue}>
				<Box flexDirection="column" paddingX={1} marginTop={0}>
					<Box
						flexDirection="column"
						borderStyle="round"
						borderColor={colors.border}
						paddingX={1}
						marginTop={0}
					>
						{/* 真实 Profile 与 Model 上下文状态 */}
						<Box justifyContent="space-between">
							<Text bold color={colors.cyan}>
								[Profile: {activeProfileName}]
							</Text>
							<Text color={colors.text}>
								Model: <Text bold color={colors.diffAddedForeground}>{activeModelName}</Text>
								{' '}| Diff: <Text bold color={colors.menuSelected}>{currentDiffHarmony.toUpperCase()}</Text>
							</Text>
						</Box>

						{/* 真实原生 UserMessagePreview 气泡 */}
						<Box marginY={0}>
							<UserMessagePreview
								content={t.customTheme?.userMessageSample || '请基于 OKLCH 和 APCA 生成全域自适应主题！'}
							/>
						</Box>

						{/* 真实原生 DiffViewer 代码增删行 */}
						<Box marginY={0}>
							<DiffViewer
								oldContent={t.customTheme?.sampleOldCode || 'const diffBg = "#300000"; // 旧版写死常数'}
								newContent={
									t.customTheme?.sampleNewCode ||
									'const diffBg = deriveHarmonicDiff({ hue, diffHarmony }); // 全域自适应引力共振'
								}
								filename={t.customTheme?.sampleCodeFilename || 'themeEngine.ts'}
							/>
						</Box>
					</Box>
				</Box>
			</ThemeContext.Provider>
		</Box>
	);
}
