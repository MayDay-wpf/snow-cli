import React, {useState, useEffect, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import {useI18n} from '../../../i18n/index.js';
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

function applyCursorEffect(hex: string): string {
	const clean = hex.replace('#', '');
	const r = Number.parseInt(clean.slice(0, 2), 16);
	const g = Number.parseInt(clean.slice(2, 4), 16);
	const b = Number.parseInt(clean.slice(4, 6), 16);
	const brightness = (r + g + b) / 3;
	// If the color is already bright, darken it so the cursor remains visible
	if (brightness > 200) {
		const factor = 0.5;
		const nr = Math.round(r * factor);
		const ng = Math.round(g * factor);
		const nb = Math.round(b * factor);
		return `#${nr.toString(16).padStart(2, '0')}${ng
			.toString(16)
			.padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
	}
	return blendWithWhite(hex, 0.6);
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
	const {t} = useI18n();
	const te = t.pixelEditor;
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
		setMessage(te.canvasCleared);
		setConfirmClear(false);
	}, [canvasWidth, canvasHeight, te.canvasCleared]);

	useInput((input, key) => {
		if (confirmClear) {
			if (input === 'y' || input === 'Y') {
				clearCanvas();
			} else {
				setConfirmClear(false);
				setMessage(te.clearCancelled);
			}
			return;
		}

		if (isNamingSave) {
			if (key.escape) {
				setIsNamingSave(false);
				setSaveName('');
				setMessage(te.saveCancelled);
				return;
			}

			if (key.return) {
				const name = saveName.trim();
				if (!name) {
					setMessage(te.nameCannotBeEmpty);
					return;
				}

				onSave?.(grid, name);
				setCurrentName(name);
				setIsNamingSave(false);
				setSaveName('');
				setMessage(te.savedAs.replace('{name}', name));
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
				setMessage(te.savedAs.replace('{name}', currentName));
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

		if (input === ' ') {
			const currentPixelColor = grid[cursorY]![cursorX];
			if (currentPixelColor !== PALETTE[0]) {
				erasePixel();
			} else {
				drawPixel();
			}
			return;
		}

		if (key.return) {
			drawPixel();
			return;
		}

		if (input === '0') {
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
						topColor = applyCursorEffect(topColor);
					}

					if (cursorX === x && cursorY === bottomY) {
						bottomColor = applyCursorEffect(bottomColor);
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
						{te.title}
					</Text>
					<Text color="gray">
						{canvasWidth}x{canvasHeight}
					</Text>
					<Box marginTop={1} flexDirection="column">
						<Text bold>{te.palette}</Text>
						{PALETTE.map((color, idx) => (
							<Box key={idx} flexDirection="row">
								<Text>
									{idx === colorIndex ? '▶ ' : '  '}
									{chalk.bgHex(color).hex(color)('  ')}{' '}
									{idx === 0
										? te.eraser
										: te.colorNumber.replace('{n}', String(idx))}
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
							{te.controlsHint}
						</Text>
						<Text color="gray" dimColor>
							{te.controlsHintPosBrush
								.replace('{x}', String(cursorX))
								.replace('{y}', String(cursorY))}
							{chalk.bgHex(currentColor).hex(currentColor)('  ')}
						</Text>
					</>
				)}
				{isNamingSave && (
					<Box flexDirection="row">
						<Text color="cyan" bold>
							{te.saveDrawingLabel}
						</Text>
						<TextInput
							value={saveName}
							onChange={setSaveName}
							onSubmit={() => {
								const name = saveName.trim();
								if (!name) {
									setMessage(te.nameCannotBeEmpty);
									return;
								}

								onSave?.(grid, name);
								setCurrentName(name);
								setIsNamingSave(false);
								setSaveName('');
								setMessage(te.savedAs.replace('{name}', name));
							}}
							placeholder={te.namePlaceholder}
						/>
						<Text color="gray">{te.escCancelHint}</Text>
					</Box>
				)}
				{confirmClear ? (
					<Text color="yellow" bold>
						{te.confirmClearCanvas}
					</Text>
				) : (
					!isNamingSave && message && <Text color="yellow">{message}</Text>
				)}
			</Box>
		</Box>
	);
}
