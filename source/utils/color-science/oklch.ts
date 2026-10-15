/**
 * 零依赖 OKLCH 感知色彩数学微内核
 * 采用 Björn Ottosson 提出的 OKLab/OKLCH 极简闭式代数公式
 */

export interface OKLCH {
	l: number; // 0 ~ 1 (Lightness)
	c: number; // 0 ~ 0.4+ (Chroma)
	h: number; // 0 ~ 360 (Hue in degrees)
}

export interface RGB {
	r: number; // 0 ~ 255
	g: number; // 0 ~ 255
	b: number; // 0 ~ 255
}

function srgbToLinear(c: number): number {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
	const clamped = Math.max(0, Math.min(1, c));
	const v = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
	return Math.round(Math.max(0, Math.min(255, v * 255)));
}

export function rgbToOklch(r: number, g: number, b: number): OKLCH {
	const lr = srgbToLinear(r);
	const lg = srgbToLinear(g);
	const lb = srgbToLinear(b);

	const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

	const L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
	const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
	const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

	const C = Math.sqrt(a * a + b_ * b_);
	let h = (Math.atan2(b_, a) * 180) / Math.PI;
	if (h < 0) h += 360;

	return {
		l: Math.max(0, Math.min(1, L)),
		c: Math.max(0, C),
		h: Number.isFinite(h) ? h : 0,
	};
}

export function oklchToRgb(l: number, c: number, h: number): RGB {
	const hRad = (h * Math.PI) / 180;
	const a = c * Math.cos(hRad);
	const b = c * Math.sin(hRad);

	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

	const l3 = l_ * l_ * l_;
	const m3 = m_ * m_ * m_;
	const s3 = s_ * s_ * s_;

	const lr = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
	const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
	const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

	return {
		r: linearToSrgb(lr),
		g: linearToSrgb(lg),
		b: linearToSrgb(lb),
	};
}

export function hexToRgb(hex: string): RGB {
	let clean = hex.replace(/^#/, '');
	if (clean.length === 3) {
		clean = clean.split('').map(c => c + c).join('');
	}
	const num = parseInt(clean, 16);
	if (Number.isNaN(num)) return {r: 0, g: 0, b: 0};
	return {
		r: (num >> 16) & 255,
		g: (num >> 8) & 255,
		b: num & 255,
	};
}

export function rgbToHex(r: number, g: number, b: number): string {
	const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToOklch(hex: string): OKLCH {
	const rgb = hexToRgb(hex);
	return rgbToOklch(rgb.r, rgb.g, rgb.b);
}

export function oklchToHex(l: number, c: number, h: number): string {
	const rgb = oklchToRgb(l, c, h);
	return rgbToHex(rgb.r, rgb.g, rgb.b);
}
