import React from 'react';
import {Text} from 'ink';
import {generateGradientColors} from './gradientColor.js';

interface GradientTextProps {
	text: string;
	gradient?: string[];
	color?: string;
	dimColor?: boolean;
	bold?: boolean;
}

/**
 * 渐变文本组件：将文本逐字符渲染为渐变色。
 *
 * 当 `gradient` 提供两个或更多颜色时，会按字符位置线性插值生成渐变。
 * 若 `gradient` 无效或未提供，则回退到单色 `color` 渲染，保持向后兼容。
 */
export function GradientText({
	text,
	gradient,
	color,
	dimColor,
	bold,
}: GradientTextProps) {
	const safeGradient = Array.isArray(gradient)
		? gradient.filter(
				(c): c is string => typeof c === 'string' && c.trim().length > 0,
		  )
		: undefined;

	if (!safeGradient || safeGradient.length < 2 || text.length === 0) {
		return (
			<Text color={color} dimColor={dimColor} bold={bold}>
				{text}
			</Text>
		);
	}

	const colors = generateGradientColors(safeGradient, text.length);

	if (colors.length !== text.length) {
		return (
			<Text color={color || safeGradient[0]} dimColor={dimColor} bold={bold}>
				{text}
			</Text>
		);
	}

	return (
		<Text dimColor={dimColor} bold={bold}>
			{Array.from(text).map((char, index) => (
				<Text key={index} color={colors[index]}>
					{char}
				</Text>
			))}
		</Text>
	);
}
