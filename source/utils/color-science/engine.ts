/**
 * 感知主题生成微内核 (Perceptual Theme Engine)
 * 整合 OKLCH、12-Step 阶梯派生、APCA 硬门禁、色相引力共振与 Chroma Capping 防疲劳软截断
 */

import {oklchToHex} from './oklch.js';
import {calcApca} from './apca.js';
import {ThemeColors} from '../../ui/themes/index.js';

export type MoodType = 'oled' | 'abyss' | 'charcoal' | 'slate' | 'matrix' | 'mist' | 'neon';
export type DiffHarmonyType = 'adaptive' | 'classic' | 'accessible';

export interface ThemeParams {
	hue: number;               // 0 ~ 360
	chroma: number;            // 0.00 ~ 0.35
	mood: MoodType;
	luminanceBias?: number;    // -0.06 ~ +0.06
	diffHarmony?: DiffHarmonyType;
	diffIntensity?: number;    // 20 ~ 100
	overrides?: Partial<ThemeColors>;
}

export interface MoodProfile {
	bgL: number;           // 背景基准明度 (0.04 ~ 0.20)
	bgChromaScale: number; // 背景彩度衰减 (0 ~ 0.3)
	contrastBoost: number; // 对比度补偿
	description: string;
}

export const MOOD_PROFILES: Record<MoodType, MoodProfile> = {
	oled: {
		bgL: 0.04,
		bgChromaScale: 0.0,
		contrastBoost: 1.15,
		description: '极致深黑 (OLED Pure Black) - 像素彻底关闭，无限对比',
	},
	abyss: {
		bgL: 0.08,
		bgChromaScale: 0.05,
		contrastBoost: 1.10,
		description: '深渊幽黑 (Abyss Dark) - 消除 OLED 拖影的最低安全暗黑',
	},
	charcoal: {
		bgL: 0.11,
		bgChromaScale: 0.10,
		contrastBoost: 1.05,
		description: '暖炭色调 (Warm Charcoal) - 偏暖保护，适合深夜编码',
	},
	slate: {
		bgL: 0.14,
		bgChromaScale: 0.08,
		contrastBoost: 1.0,
		description: '北欧冷灰 (Nordic Slate) - 低刺激，适合长时间沉浸',
	},
	matrix: {
		bgL: 0.09,
		bgChromaScale: 0.15,
		contrastBoost: 1.10,
		description: '复古黑客 (Matrix Terminal) - 磷光微光沉浸',
	},
	mist: {
		bgL: 0.20,
		bgChromaScale: 0.06,
		contrastBoost: 0.95,
		description: '浅雾低反差 (Slate Mist) - 针对高环境光与防反光',
	},
	neon: {
		bgL: 0.10,
		bgChromaScale: 0.25,
		contrastBoost: 1.1,
		description: '赛博霓虹 (Cyber Neon) - 饱满微光，状态高对比跃迁',
	},
};

/**
 * 软截断彩度，防止大面积文本发生视网膜疲劳 (Chroma Capping)
 */
function capChroma(c: number, maxC = 0.08): number {
	return Math.min(c, maxC);
}

/**
 * 环形色相最短距离插值
 */
export function lerpHueAngle(baseHue: number, targetHue: number, strength: number): number {
	let diff = (targetHue - baseHue) % 360;
	if (diff > 180) diff -= 360;
	if (diff < -180) diff += 360;
	const result = (baseHue + diff * strength + 360) % 360;
	return Math.round(result);
}

export function generatePerceptualTheme(params: ThemeParams): {
	colors: ThemeColors;
	apcaScore: number;
	steps: string[];
} {
	const {
		hue,
		chroma,
		mood,
		luminanceBias = 0.0,
		diffHarmony = 'adaptive',
		diffIntensity = 75,
		overrides = {},
	} = params;
	const profile = MOOD_PROFILES[mood] || MOOD_PROFILES.slate;

	// 1. 基底背景派生 (合成有效明度并安全截断)
	const effectiveBgL = Math.max(0.03, Math.min(0.28, profile.bgL + luminanceBias));
	const bgC = chroma < 0.03 ? 0.00 : capChroma(chroma * profile.bgChromaScale, 0.03);
	const background = oklchToHex(effectiveBgL, bgC, hue);

	// 2. 正文与标题 (Step 11-12) - 强制高对比度守护
	const textC = chroma < 0.03 ? 0.00 : capChroma(chroma * 0.1, 0.04);
	let textL = Math.max(0.85, 0.88 * profile.contrastBoost);
	let text = oklchToHex(textL, textC, hue);

	// APCA 闭环校验与自动提升明度补偿
	let score = Math.abs(calcApca(text, background));
	while (score < 80 && textL < 0.98) {
		textL += 0.02;
		text = oklchToHex(textL, textC, hue);
		score = Math.abs(calcApca(text, background));
	}

	// 3. 12-Step 派生梯度 (全色阶实时计算)
	const lightLevels = [
		effectiveBgL,
		effectiveBgL + 0.04,
		effectiveBgL + 0.08,
		effectiveBgL + 0.13,
		effectiveBgL + 0.18,
		effectiveBgL + 0.25,
		effectiveBgL + 0.35,
		effectiveBgL + 0.45,
		0.70,
		0.80,
		0.86,
		0.96,
	];
	const steps = lightLevels.map((l, i) => {
		const c = (i >= 8 && i <= 9) ? chroma : chroma * 0.35;
		return oklchToHex(Math.min(0.98, l), c, hue);
	});

	const accent = steps[8] || '#2fd4ec';  // Step 8: 主强调色 (Accent)
	const border = steps[5] || '#3e3e3e';  // Step 5: 结构边框
	const dimText = steps[6] || '#858585'; // Step 6: 辅助次要文字
	const cardBg = steps[1] || '#1a1a1a';  // Step 1: 卡片微光背景

	// 4. Diff 色阶派生 (支持三大模式与浸润强度)
	let addedHue = 142;
	let removedHue = 25;
	if (diffHarmony === 'adaptive') {
		addedHue = lerpHueAngle(142, hue, 0.25);
		removedHue = lerpHueAngle(25, (hue + 180) % 360, 0.25);
	} else if (diffHarmony === 'accessible') {
		addedHue = 210; // 天蓝
		removedHue = 45; // 琥珀橙
	}

	const intensityRatio = Math.max(0.2, Math.min(1.0, diffIntensity / 100));
	const diffAddedBgL = Math.min(0.35, effectiveBgL + 0.08 * intensityRatio);
	const diffRemovedBgL = Math.min(0.35, effectiveBgL + 0.07 * intensityRatio);

	// 若全局 Chroma 极低（如水墨单色），Diff 底色彩度收敛为微阶暗灰，杜绝荧光割裂
	const diffBgC = chroma < 0.03 ? 0.01 : Math.min(0.12, 0.06 * intensityRatio * (chroma / 0.16));
	const diffAdded = oklchToHex(diffAddedBgL, diffBgC, addedHue);
	const diffRemoved = oklchToHex(diffRemovedBgL, diffBgC, removedHue);

	// Diff 前景色 APCA 闭环校验与自动提升明度补偿
	const diffFgC = chroma < 0.03 ? 0.02 : Math.min(0.20, 0.15 * (chroma / 0.16));
	let diffAddedFgL = 0.85;
	let diffAddedFg = oklchToHex(diffAddedFgL, diffFgC, addedHue);
	let addedScore = Math.abs(calcApca(diffAddedFg, diffAdded));
	while (addedScore < 75 && diffAddedFgL < 0.98) {
		diffAddedFgL += 0.02;
		diffAddedFg = oklchToHex(diffAddedFgL, diffFgC, addedHue);
		addedScore = Math.abs(calcApca(diffAddedFg, diffAdded));
	}

	let diffRemovedFgL = 0.86;
	let diffRemovedFg = oklchToHex(diffRemovedFgL, diffFgC, removedHue);
	let removedScore = Math.abs(calcApca(diffRemovedFg, diffRemoved));
	while (removedScore < 75 && diffRemovedFgL < 0.98) {
		diffRemovedFgL += 0.02;
		diffRemovedFg = oklchToHex(diffRemovedFgL, diffFgC, removedHue);
		removedScore = Math.abs(calcApca(diffRemovedFg, diffRemoved));
	}

	const diffModified = steps[9] || '#e0af68';

	// 5. 状态指示色
	const statusC = Math.max(0.04, Math.min(0.18, chroma * 0.8));
	const success = oklchToHex(0.78, statusC, addedHue);
	const warning = oklchToHex(0.78, statusC, 80);
	const error = oklchToHex(0.74, Math.min(0.20, statusC * 1.1), removedHue);
	const cyan = accent;

	// 徽标渐变与菜单文字
	const logoG1 = oklchToHex(0.76, chroma * 0.9, (hue - 30 + 360) % 360);
	const logoG2 = accent;
	const logoG3 = oklchToHex(0.76, chroma * 0.9, (hue + 30) % 360);

	const baseColors: ThemeColors = {
		background,
		text,
		border,
		diffAdded,
		diffRemoved,
		diffModified,
		diffAddedForeground: diffAddedFg,
		diffRemovedForeground: diffRemovedFg,
		lineNumber: dimText,
		lineNumberBorder: border,
		menuSelected: accent,
		menuNormal: text,
		menuInfo: accent,
		menuSecondary: dimText,
		error,
		warning,
		success,
		cyan,
		logoGradient: [logoG1, logoG2, logoG3],
		userMessageBackground: cardBg,
		userMessageText: text,
		diffOpacity: intensityRatio,
	};

	const finalColors: ThemeColors = {
		...baseColors,
		...overrides,
	};

	return {
		colors: finalColors,
		apcaScore: Math.round(score * 10) / 10,
		steps,
	};
}
