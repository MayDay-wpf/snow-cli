import React, {useState, useEffect} from 'react';
import {Text} from 'ink';
import chalk from 'chalk';

interface ShimmerTextProps {
	text: string;
	baseColor?: string;
	shimmerColor?: string;
}

const DEFAULT_SHIMMER_COLOR = '#00FFFF';
const DEFAULT_BASE_COLOR = '#1ACEB0';

/**
 * ShimmerText component that displays text with a shimmer effect flowing through base text
 */
export default function ShimmerText({
	text,
	baseColor = DEFAULT_BASE_COLOR,
	shimmerColor = DEFAULT_SHIMMER_COLOR,
}: ShimmerTextProps) {
	const [frame, setFrame] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrame(prev => (prev + 1) % (text.length + 5));
		}, 100); // Update every 100ms for smooth animation

		return () => clearInterval(interval);
	}, [text.length]);

	// Build the colored text with shimmer effect
	let output = '';
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const distance = Math.abs(i - frame);

		if (distance <= 1) {
			output += chalk.bold.hex(shimmerColor)(char);
		} else {
			output += chalk.bold.hex(baseColor)(char);
		}
	}

	return <Text>{output}</Text>;
}
