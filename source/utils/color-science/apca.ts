/**
 * APCA (Accessible Perceptual Contrast Algorithm) 极性对比度数学
 * WCAG 3.0 候选感知对比算法（零第三方依赖轻量实现）
 */

import {hexToRgb} from './oklch.js';

function sRGBtoY(r: number, g: number, b: number): number {
	// APCA 专用主观亮度权重曲线
	const mainTRC = 2.4;
	const rL = Math.pow(r / 255, mainTRC);
	const gL = Math.pow(g / 255, mainTRC);
	const bL = Math.pow(b / 255, mainTRC);
	return 0.2126729 * rL + 0.7151522 * gL + 0.0721750 * bL;
}

export function calcApca(txtHex: string, bgHex: string): number {
	const txt = hexToRgb(txtHex);
	const bg = hexToRgb(bgHex);

	const yTxt = sRGBtoY(txt.r, txt.g, txt.b);
	const yBg = sRGBtoY(bg.r, bg.g, bg.b);

	// APCA 极性对比度公式常数
	const normBG = 0.56;
	const normTXT = 0.57;
	const revTXT = 0.62;
	const revBG = 0.65;
	const scaleBoW = 1.14;
	const scaleWoB = 1.14;

	// 黑底白字 (Dark Mode: yTxt > yBg)
	if (yTxt >= yBg) {
		const c = (Math.pow(yTxt, revTXT) - Math.pow(yBg, revBG)) * scaleWoB;
		return c < 0.001 ? 0 : c * 100;
	}

	// 白底黑字 (Light Mode: yTxt < yBg)
	const c = (Math.pow(yTxt, normTXT) - Math.pow(yBg, normBG)) * scaleBoW;
	return c > -0.001 ? 0 : c * 100;
}

export function isReadable(txtHex: string, bgHex: string, minLc = 75): boolean {
	const lc = Math.abs(calcApca(txtHex, bgHex));
	return lc >= minLc;
}
