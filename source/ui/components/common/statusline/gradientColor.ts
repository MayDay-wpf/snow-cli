/**
 * StatusLine 渐变色工具：将多段十六进制 / 命名颜色插值为逐字符渐变色序列。
 */

const NAMED_COLORS: Readonly<Record<string, string>> = {
	black: '#000000',
	red: '#FF0000',
	green: '#00FF00',
	yellow: '#FFFF00',
	blue: '#0000FF',
	magenta: '#FF00FF',
	cyan: '#00FFFF',
	white: '#FFFFFF',
	gray: '#808080',
	grey: '#808080',
};

interface Rgb {
	r: number;
	g: number;
	b: number;
}

function hexToRgb(hex: string): Rgb | undefined {
	const normalized = hex.replace(/^#/, '').toLowerCase();
	if (/^[0-9a-f]{6}$/.test(normalized)) {
		return {
			r: Number.parseInt(normalized.slice(0, 2), 16),
			g: Number.parseInt(normalized.slice(2, 4), 16),
			b: Number.parseInt(normalized.slice(4, 6), 16),
		};
	}
	if (/^[0-9a-f]{3}$/.test(normalized)) {
		return {
			r: Number.parseInt(normalized[0]! + normalized[0]!, 16),
			g: Number.parseInt(normalized[1]! + normalized[1]!, 16),
			b: Number.parseInt(normalized[2]! + normalized[2]!, 16),
		};
	}
	return undefined;
}

function resolveColor(color: string): Rgb | undefined {
	const trimmed = color.trim().toLowerCase();
	const named = NAMED_COLORS[trimmed];
	if (named) {
		return hexToRgb(named);
	}
	return hexToRgb(trimmed);
}

function rgbToHex({r, g, b}: Rgb): string {
	const toHex = (value: number) =>
		Math.round(value).toString(16).padStart(2, '0');
	return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function interpolateRgb(start: Rgb, end: Rgb, t: number): Rgb {
	return {
		r: start.r + (end.r - start.r) * t,
		g: start.g + (end.g - start.g) * t,
		b: start.b + (end.b - start.b) * t,
	};
}

/**
 * 根据提供的颜色数组生成指定步数的渐变色序列。
 *
 * @param colors - 两个或更多十六进制颜色（如 `['#10B981', '#60A5FA']`），
 *                 也支持基础命名颜色（`red`、`cyan` 等）。
 * @param steps  - 需要生成的颜色数量，通常等于文本字符数。
 * @returns 长度为 `steps` 的十六进制颜色数组；若输入无效则返回空数组。
 */
export function generateGradientColors(
	colors: string[],
	steps: number,
): string[] {
	if (steps <= 0 || colors.length === 0) {
		return [];
	}

	const rgbs = colors.map(resolveColor).filter((c): c is Rgb => c !== undefined);

	if (rgbs.length === 0) {
		return [];
	}

	if (rgbs.length === 1 || steps === 1) {
		return Array.from({length: steps}, () => rgbToHex(rgbs[0]!));
	}

	const result: string[] = [];
	for (let i = 0; i < steps; i++) {
		const t = i / (steps - 1);
		const scaledT = t * (rgbs.length - 1);
		const segmentIndex = Math.floor(scaledT);
		const segmentT = scaledT - segmentIndex;

		if (segmentIndex >= rgbs.length - 1) {
			result.push(rgbToHex(rgbs[rgbs.length - 1]!));
		} else {
			result.push(
				rgbToHex(
					interpolateRgb(
						rgbs[segmentIndex]!,
						rgbs[segmentIndex + 1]!,
						segmentT,
					),
				),
			);
		}
	}

	return result;
}
