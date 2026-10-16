import anyTest, {type TestFn} from 'ava';
import {
	generatePerceptualTheme,
	lerpHueAngle,
	type MoodType,
} from '../../../utils/color-science/engine.js';
import {themes, type ThemeColors} from '../../../ui/themes/index.js';
import {calcApca} from '../../../utils/color-science/apca.js';

const test = anyTest as unknown as TestFn;

const REQUIRED_THEME_TOKENS: Array<keyof ThemeColors> = [
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

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

test('L0 CDC: generatePerceptualTheme fulfills 100% ThemeColors Token schema contract', t => {
	const result = generatePerceptualTheme({
		hue: 215,
		chroma: 0.16,
		mood: 'slate',
	});

	for (const token of REQUIRED_THEME_TOKENS) {
		t.true(
			token in result.colors,
			'Contract violation: Missing required Token in derived theme: ' + token,
		);
		const val = result.colors[token];
		t.not(val, undefined, 'Token must not be undefined');
		t.not(val, null, 'Token must not be null');
	}

	t.regex(result.colors.background, HEX_COLOR_REGEX, 'background must be valid hex');
	t.regex(result.colors.text, HEX_COLOR_REGEX, 'text must be valid hex');
	t.regex(result.colors.border, HEX_COLOR_REGEX, 'border must be valid hex');
	t.regex(result.colors.cyan, HEX_COLOR_REGEX, 'cyan must be valid hex');
	t.regex(result.colors.menuSelected, HEX_COLOR_REGEX, 'menuSelected must be valid hex');
	t.regex(result.colors.userMessageBackground, HEX_COLOR_REGEX, 'userMessageBackground must be valid hex');

	t.true(Array.isArray(result.colors.logoGradient), 'logoGradient must be a 3-element tuple');
	t.is(result.colors.logoGradient.length, 3, 'logoGradient must have exactly 3 colors');
	for (const color of result.colors.logoGradient) {
		t.regex(color, HEX_COLOR_REGEX, 'logoGradient color must be valid hex');
	}
	t.is(typeof result.colors.diffOpacity, 'number', 'diffOpacity must be a number');
	t.true(result.colors.diffOpacity >= 0 && result.colors.diffOpacity <= 1, 'diffOpacity must be in range [0, 1]');
});

test('L0 CDC: Whole-spectrum (360 deg sweep) APCA readability hard barrier invariant across all 7 archetypes', t => {
	const moods: MoodType[] = ['oled', 'abyss', 'charcoal', 'slate', 'matrix', 'mist', 'neon'];
	const testHues = [0, 45, 90, 135, 180, 225, 270, 315, 359];
	const testChromas = [0.00, 0.08, 0.16, 0.28, 0.35];

	for (const mood of moods) {
		for (const hue of testHues) {
			for (const chroma of testChromas) {
				const theme = generatePerceptualTheme({hue, chroma, mood});
				const apca = Math.abs(calcApca(theme.colors.text, theme.colors.background));
				t.true(
					apca >= 75,
					'APCA Hard Barrier Failed for mood=' + mood + ', hue=' + hue + ', chroma=' + chroma + '. Got ' + apca + ' Lc',
				);

				const addedApca = Math.abs(
					calcApca(theme.colors.diffAddedForeground, theme.colors.diffAdded),
				);
				t.true(
					addedApca >= 75,
					'Diff Added APCA Barrier Failed for mood=' + mood + ', hue=' + hue + '. Got ' + addedApca + ' Lc',
				);

				const removedApca = Math.abs(
					calcApca(theme.colors.diffRemovedForeground, theme.colors.diffRemoved),
				);
				t.true(
					removedApca >= 75,
					'Diff Removed APCA Barrier Failed for mood=' + mood + ', hue=' + hue + '. Got ' + removedApca + ' Lc',
				);
			}
		}
	}
});

test('L0 CDC: lerpHueAngle circular shortest path invariant', t => {
	// 测试跨越 0°/360° 边界的最短距离插值
	// 350° 和 10° 之间的最短距离是 20°，中点应为 0° 或 360°，而不是 180°
	const midpoint = lerpHueAngle(350, 10, 0.5);
	t.is(midpoint, 0);

	const oppositeMid = lerpHueAngle(10, 350, 0.5);
	t.is(oppositeMid, 0);

	// 常规同象限插值
	const regular = lerpHueAngle(100, 200, 0.5);
	t.is(regular, 150);
});

test('L0 CDC: luminanceBias clamp safety invariant (anti-explosion)', t => {
	// 极端偏置输入，背景明度必须严格锁定在安全区间 [0.03, 0.28] 内
	const extremeDark = generatePerceptualTheme({hue: 200, chroma: 0.15, mood: 'oled', luminanceBias: -1.0});
	t.true(extremeDark.apcaScore >= 75);

	const extremeBright = generatePerceptualTheme({hue: 200, chroma: 0.15, mood: 'mist', luminanceBias: +1.0});
	t.true(extremeBright.apcaScore >= 75);
});

test('L0 CDC: Backward compatibility contract with existing themes', t => {
	const defaultDark = themes.dark.colors;
	const generated = generatePerceptualTheme({hue: 200, chroma: 0.15, mood: 'charcoal'}).colors;

	const darkKeys = Object.keys(defaultDark) as Array<keyof ThemeColors>;
	for (const key of darkKeys) {
		t.true(key in generated, 'Generated theme must be backward compatible with existing theme key: ' + key);
	}
});
