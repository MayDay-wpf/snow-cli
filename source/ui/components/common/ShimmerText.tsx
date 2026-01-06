import React, {useState, useEffect} from 'react';
import {Text} from 'ink';
import chalk from 'chalk';

interface ShimmerTextProps {
	text: string;
}

/**
 * ShimmerText component that displays text with a white shimmer effect flowing through yellow text
 */
export default function ShimmerText({text}: ShimmerTextProps) {
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

		// Bright cyan shimmer in the center (distance 0-1)
		if (distance <= 1) {
			output += chalk.bold.hex('#00FFFF')(char); // Bright cyan/aqua
		}
		// Deep blue for the rest (base color)
		else {
			output += chalk.bold.hex('#1ACEB0')(char); // Steel blue
		}
	}

	return <Text>{output}</Text>;
}
