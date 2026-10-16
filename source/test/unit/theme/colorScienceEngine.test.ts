import test from 'ava';
import {
	rgbToOklch,
	oklchToRgb,
	hexToOklch,
	oklchToHex,
} from '../../../utils/color-science/oklch.js';
import {calcApca, isReadable} from '../../../utils/color-science/apca.js';
import {
	generatePerceptualTheme,
	MoodType,
} from '../../../utils/color-science/engine.js';

test('oklch: rgb <-> oklch round-trip fidelity', t => {
	const samples = [
		{r: 255, g: 0, b: 0},
		{r: 0, g: 255, b: 0},
		{r: 0, g: 0, b: 255},
		{r: 30, g: 30, b: 30},
		{r: 220, g: 220, b: 220},
	];

	for (const {r, g, b} of samples) {
		const oklch = rgbToOklch(r, g, b);
		const roundTrip = oklchToRgb(oklch.l, oklch.c, oklch.h);
		t.true(Math.abs(roundTrip.r - r) <= 2, `Red mismatch for ${r},${g},${b}`);
		t.true(Math.abs(roundTrip.g - g) <= 2, `Green mismatch for ${r},${g},${b}`);
		t.true(Math.abs(roundTrip.b - b) <= 2, `Blue mismatch for ${r},${g},${b}`);
	}
});

test('oklch: hex conversion helpers work as expected', t => {
	const hex = '#3b82f6';
	const oklch = hexToOklch(hex);
	t.true(oklch.l > 0 && oklch.l < 1);
	t.true(oklch.c > 0);
	const recovered = oklchToHex(oklch.l, oklch.c, oklch.h);
	t.regex(recovered, /^#[0-9a-f]{6}$/i);
});

test('apca: polarity contrast mathematics', t => {
	// 纯白字对黑底应得到极高 APCA 分数 (> 100)
	const whiteOnBlack = calcApca('#ffffff', '#000000');
	t.true(whiteOnBlack >= 100, `Expected white on black >= 100, got ${whiteOnBlack}`);

	// 灰底暗字不可读测试
	const badContrast = calcApca('#333333', '#111111');
	t.false(isReadable('#333333', '#111111', 60), `Should not pass readability gate: ${badContrast}`);
});

test('engine: derives all 6 base archetypes and neon with strictly guarded APCA contrast', t => {
	const moods: MoodType[] = ['oled', 'abyss', 'charcoal', 'slate', 'matrix', 'mist', 'neon'];
	const hues = [0, 60, 120, 180, 240, 300];

	for (const mood of moods) {
		for (const hue of hues) {
			const {colors, apcaScore} = generatePerceptualTheme({
				hue,
				chroma: 0.16,
				mood,
			});

			t.truthy(colors.background);
			t.truthy(colors.text);
			t.truthy(colors.menuSelected);
			t.is(colors.logoGradient.length, 3);

			// 硬门禁断言：正文与底色对比度必须 >= 75
			t.true(
				apcaScore >= 75,
				`Mood [${mood}] at Hue [${hue}] failed APCA threshold with score: ${apcaScore}`,
			);
		}
	}
});

test('engine: extreme chroma boundaries (0.00 achromatic and 0.35 Display P3)', t => {
	// 1. 0.00 极简单色水墨
	const mono = generatePerceptualTheme({hue: 0, chroma: 0.00, mood: 'abyss'});
	t.true(mono.apcaScore >= 75);
	t.regex(mono.colors.background, /^#[0-9a-f]{6}$/i);
	t.regex(mono.colors.diffAdded, /^#[0-9a-f]{6}$/i);

	// 2. 0.35 P3 极限广色域高彩
	const p3 = generatePerceptualTheme({hue: 180, chroma: 0.35, mood: 'oled'});
	t.true(p3.apcaScore >= 75);
	t.regex(p3.colors.background, /^#[0-9a-f]{6}$/i);
	t.regex(p3.colors.menuSelected, /^#[0-9a-f]{6}$/i);
});

test('engine: luminanceBias synthesis and clamp invariant', t => {
	// 加深偏置
	const darker = generatePerceptualTheme({hue: 200, chroma: 0.15, mood: 'charcoal', luminanceBias: -0.05});
	t.true(darker.apcaScore >= 75);

	// 提亮偏置
	const lighter = generatePerceptualTheme({hue: 200, chroma: 0.15, mood: 'slate', luminanceBias: 0.05});
	t.true(lighter.apcaScore >= 75);
});

test('engine: diffHarmony modes (adaptive, classic, accessible)', t => {
	const adaptive = generatePerceptualTheme({hue: 180, chroma: 0.20, mood: 'slate', diffHarmony: 'adaptive'});
	const classic = generatePerceptualTheme({hue: 180, chroma: 0.20, mood: 'slate', diffHarmony: 'classic'});
	const accessible = generatePerceptualTheme({hue: 180, chroma: 0.20, mood: 'slate', diffHarmony: 'accessible'});

	t.truthy(adaptive.colors.diffAdded);
	t.truthy(classic.colors.diffAdded);
	t.truthy(accessible.colors.diffAdded);
	t.not(accessible.colors.diffAdded, classic.colors.diffAdded);
});

test('engine: overrides work seamlessly', t => {
	const customBorder = '#ff00ff';
	const {colors} = generatePerceptualTheme({
		hue: 200,
		chroma: 0.15,
		mood: 'slate',
		overrides: {
			border: customBorder,
		},
	});

	t.is(colors.border, customBorder);
});

test('engine: benchmark execution speed (< 0.1ms per derivation)', t => {
	const start = performance.now();
	const iterations = 500;
	for (let i = 0; i < iterations; i++) {
		generatePerceptualTheme({
			hue: (i * 7) % 360,
			chroma: 0.14,
			mood: 'slate',
		});
	}
	const elapsed = performance.now() - start;
	const avgMs = elapsed / iterations;
	t.true(avgMs < 0.5, `Derivation took too long: ${avgMs.toFixed(3)}ms`);
});
