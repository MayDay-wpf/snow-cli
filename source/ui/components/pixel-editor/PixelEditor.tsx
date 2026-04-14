import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import type {PixelGrid} from './types.js';

const PALETTE = [
	'#000000', // 0: black / eraser
	'#ffffff', // 1: white
	'#ff0000', // 2: red
	'#00ff00', // 3: green
	'#0000ff', // 4: blue
	'#ffff00', // 5: yellow
	'#ff00ff', // 6: magenta
	'#00ffff', // 7: cyan
	'#808080', // 8: gray
	'#ffa500', // 9: orange
];

const BLOCK_CHAR = '\u2580'; // Upper half block: foreground = top, background = bottom

function createEmptyGrid(width: number, height: number): PixelGrid {
	return Array.from({length: height}, () =>
		Array.from({length: width}, () => PALETTE[0]!),
	);
}

function blendWithWhite(hex: string, ratio: number): string {
	const clean = hex.replace('#', '');
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	const nr = Math.min(255, Math.round(r + (255 - r) * ratio));
	const ng = Math.min(255, Math.round(g + (255 - g) * ratio));
	const nb = Math.min(255, Math.round(b + (255 - b) * ratio));
	return `#${nr.toString(16).padStart(2, '0')}${ng
		.toString(16)
		.padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

type PixelEditorProps = {
	width?: number;
	height?: number;
	initialGrid?: PixelGrid;
	initialName?: string;
	onExit?: () => void;
	onSave?: (grid: PixelGrid, name: string) => void;
};

export default function PixelEditor({
	width = 32,
	height = 32,
	initialGrid,
	initialName,
	onExit,
	onSave,
}: PixelEditorProps) {
	// Ensure even height for dual-pixel rendering
	const canvasHeight = height % 2 === 0 ? height : height + 1;
	const canvasWidth = width;

	const [grid, setGrid] = useState<PixelGrid>(() => {
		if (
			initialGrid &&
			initialGrid.length === canvasHeight &&
			initialGrid[0]?.length === canvasWidth
		) {
			return initialGrid.map(row => [...row]);
		}
		return createEmptyGrid(canvasWidth, canvasHeight);
	});
	const [isNamingSave, setIsNamingSave] = useState(false);
	const [saveName, setSaveName] = useState('');
	const [currentName, setCurrentName] = useState(initialName ?? '');
	const [cursorX, setCursorX] = useState(Math.floor(canvasWidth / 2));
	const [cursorY, setCursorY] = useState(Math.floor(canvasHeight / 2));
	const [colorIndex, setColorIndex] = useState(1);
	const [cursorVisible, setCursorVisible] = useState(true);
	const [message, setMessage] = useState<string | null>(null);
	const [confirmClear, setConfirmClear] = useState(false);

	// Cursor blink
	useEffect(() => {
		const id = setInterval(() => {
			setCursorVisible(v => !v);
		}, 400);
		return () => clearInterval(id);
	}, []);

	// Auto-clear transient messages
	useEffect(() => {
		if (!message) return;
		const id = setTimeout(() => setMessage(null), 1500);
		return () => clearTimeout(id);
	}, [message]);

	const drawPixel = useCallback(() => {
		const color = PALETTE[colorIndex];
		if (!color) return;
		setGrid(prev => {
			const next = prev.map(row => [...row]);
			next[cursorY]![cursorX] = color;
			return next;
		});
	}, [cursorX, cursorY, colorIndex]);

	const erasePixel = useCallback(() => {
		setGrid(prev => {
			const next = prev.map(row => [...row]);
			next[cursorY]![cursorX] = PALETTE[0]!;
			return next;
		});
	}, [cursorX, cursorY]);

	const clearCanvas = useCallback(() => {
		setGrid(createEmptyGrid(canvasWidth, canvasHeight));
		setMessage('Canvas cleared');
		setConfirmClear(false);
	}, [canvasWidth, canvasHeight]);

	useInput((input, key) => {
		if (confirmClear) {
			if (input === 'y' || input === 'Y') {
				clearCanvas();
			} else {
				setConfirmClear(false);
				setMessage('Clear cancelled');
			}
			return;
		}

		if (isNamingSave) {
			if (key.escape) {
				setIsNamingSave(false);
				setSaveName('');
				setMessage('Save cancelled');
				return;
			}

			if (key.return) {
				const name = saveName.trim();
				if (!name) {
					setMessage('Name cannot be empty');
					return;
				}

				onSave?.(grid, name);
				setCurrentName(name);
				setIsNamingSave(false);
				setSaveName('');
				setMessage(`Saved as ${name}`);
				return;
			}

			// Let TextInput consume normal characters; ignore control keys
			return;
		}

		if (key.escape || input === 'q' || input === 'Q') {
			onExit?.();
			return;
		}

		if (key.ctrl && input === 's') {
			if (currentName) {
				onSave?.(grid, currentName);
				setMessage(`Saved as ${currentName}`);
			} else {
				setIsNamingSave(true);
				setSaveName('');
			}
			return;
		}

		if (key.upArrow) {
			setCursorY(y => Math.max(0, y - 1));
			return;
		}

		if (key.downArrow) {
			setCursorY(y => Math.min(canvasHeight - 1, y + 1));
			return;
		}

		if (key.leftArrow) {
			setCursorX(x => Math.max(0, x - 1));
			return;
		}

		if (key.rightArrow) {
			setCursorX(x => Math.min(canvasWidth - 1, x + 1));
			return;
		}

		if (key.return || input === ' ') {
			drawPixel();
			return;
		}

		if (input === 'e' || input === 'E' || input === '0') {
			erasePixel();
			return;
		}
		if (!key.ctrl && (input === 'c' || input === 'C')) {
			setConfirmClear(true);
			return;
		}

		if (input >= '1' && input <= '9') {
			const idx = Number.parseInt(input, 10);
			if (idx < PALETTE.length) {
				setColorIndex(idx);
			}
			return;
		}
	});

	const renderedRows = useMemo(() => {
		const rows: string[] = [];
		for (let charY = 0; charY < canvasHeight / 2; charY++) {
			let row = '';
			for (let x = 0; x < canvasWidth; x++) {
				const topY = charY * 2;
				const bottomY = topY + 1;
				let topColor = grid[topY]![x]!;
				let bottomColor = grid[bottomY]![x]!;

				// Cursor highlight
				if (cursorVisible) {
					if (cursorX === x && cursorY === topY) {
						topColor = blendWithWhite(topColor, 0.6);
					}

					if (cursorX === x && cursorY === bottomY) {
						bottomColor = blendWithWhite(bottomColor, 0.6);
					}
				}

				row += chalk.bgHex(bottomColor).hex(topColor)(BLOCK_CHAR);
			}

			rows.push(row);
		}

		return rows;
	}, [grid, cursorX, cursorY, cursorVisible, canvasWidth, canvasHeight]);

	const currentColor = PALETTE[colorIndex] ?? PALETTE[0] ?? '#000000';

	return (
		<Box flexDirection="column">
			<Box flexDirection="row">
				<Box flexDirection="column" marginRight={1}>
					{renderedRows.map((row, i) => (
						<Text key={i}>{row}</Text>
					))}
				</Box>

				<Box flexDirection="column">
					<Text bold underline color="cyan">
						Pixel Editor
					</Text>
					<Text color="gray">
						{canvasWidth}x{canvasHeight}
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Text bold>Palette</Text>
						{PALETTE.map((color, idx) => (
							<Box key={idx} flexDirection="row">
								<Text>
									{idx === colorIndex ? '▶ ' : '  '}
									{chalk.bgHex(color).hex(color)('  ')}{' '}
									{idx === 0 ? 'Eraser' : `Color ${idx}`}
								</Text>
							</Box>
						))}
					</Box>
				</Box>
			</Box>

			<Box marginTop={1} flexDirection="column">
				{!isNamingSave && (
					<>
						<Text color="gray" dimColor>
							Arrows: move • Space/Enter: draw • 1-9: color • E/0: erase • C:
							clear
						</Text>
						<Text color="gray" dimColor>
							ESC/Q: back • Ctrl+S: save • Pos: ({cursorX}, {cursorY}) • Brush:{' '}
							{chalk.bgHex(currentColor).hex(currentColor)('  ')}
						</Text>
					</>
				)}
				{isNamingSave && (
					<Box flexDirection="row">
						<Text color="cyan" bold>
							Save drawing:{' '}
						</Text>
						<TextInput
							value={saveName}
							onChange={setSaveName}
							onSubmit={() => {
								const name = saveName.trim();
								if (!name) {
									setMessage('Name cannot be empty');
									return;
								}

								onSave?.(grid, name);
								setCurrentName(name);
								setIsNamingSave(false);
								setSaveName('');
								setMessage(`Saved as ${name}`);
							}}
							placeholder="Enter name..."
						/>
						<Text color="gray">{'  '}ESC cancel</Text>
					</Box>
				)}
				{confirmClear ? (
					<Text color="yellow" bold>
						Clear canvas? Press Y to confirm, any other key to cancel.
					</Text>
				) : (
					!isNamingSave && message && <Text color="yellow">{message}</Text>
				)}
			</Box>
		</Box>
	);
}
