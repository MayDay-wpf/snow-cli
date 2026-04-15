import React, {useEffect, useMemo, useState} from 'react';
import {Box, Text} from 'ink';
import Gradient from 'ink-gradient';
import chalk from 'chalk';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {gracefulExit} from '../../utils/core/processManager.js';
import {readFile} from 'fs/promises';
import {homedir} from 'os';
import {join} from 'path';
import type {PixelGrid} from '../components/pixel-editor/types.js';

type Props = {
	version?: string;
};

function dotLine(width: number): string {
	const count = Math.max(0, Math.floor(width / 3));
	return Array.from({length: count}, () => '·').join('  ');
}

const EXIT_IMAGE_PATH = join(homedir(), '.snow', 'exit-image.json');
const BLOCK_CHAR = '\u2580';

export default function ExitScreen({version = '1.0.0'}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const {columns: terminalWidth} = useTerminalSize();

	const versionText = t.exitScreen.version.replace('{version}', version);
	const dotWidth = Math.max(12, Math.min(terminalWidth - 8, 42));
	const dots = useMemo(() => dotLine(dotWidth), [dotWidth]);
	const colors = theme.colors;

	const [exitImageGrid, setExitImageGrid] = useState<PixelGrid | undefined>(
		undefined,
	);
	const [isExitScreenReady, setIsExitScreenReady] = useState(false);

	useEffect(() => {
		let active = true;
		const loadExitImage = async () => {
			try {
				const content = await readFile(EXIT_IMAGE_PATH, 'utf8');
				const data = JSON.parse(content) as {
					grid?: PixelGrid;
					enabled?: boolean;
				};
				if (!active) return;
				if (data.grid && (data.enabled ?? true)) {
					setExitImageGrid(data.grid.map(row => [...row]));
				} else {
					setExitImageGrid(undefined);
				}
			} catch {
				if (active) {
					setExitImageGrid(undefined);
				}
			} finally {
				if (active) {
					// Mark screen ready only after async content decision finishes.
					setIsExitScreenReady(true);
				}
			}
		};

		loadExitImage();
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		if (!isExitScreenReady) return;
		gracefulExit();
	}, [isExitScreenReady]);

	const exitImageRows = useMemo(() => {
		if (!exitImageGrid) return [];
		const canvasHeight = exitImageGrid.length;
		const canvasWidth = exitImageGrid[0]?.length ?? 0;
		const rows: string[] = [];
		for (let charY = 0; charY < canvasHeight / 2; charY++) {
			let row = '';
			for (let x = 0; x < canvasWidth; x++) {
				const topY = charY * 2;
				const bottomY = topY + 1;
				const topColor = exitImageGrid[topY]?.[x] ?? '#000000';
				const bottomColor = exitImageGrid[bottomY]?.[x] ?? '#000000';
				row += chalk.bgHex(bottomColor).hex(topColor)(BLOCK_CHAR);
			}
			rows.push(row);
		}
		return rows;
	}, [exitImageGrid]);

	return (
		<Box
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			paddingY={1}
			width={terminalWidth}
		>
			<Box flexDirection="column" alignItems="center">
				<Text color={colors.border} dimColor>
					{dots}
				</Text>

				{exitImageRows.length > 0 && (
					<Box marginTop={1} flexDirection="column" alignItems="center">
						{exitImageRows.map((row, i) => (
							<Text key={i}>{row}</Text>
						))}
					</Box>
				)}

				<Box marginTop={1}>
					<Text>
						<Text color={colors.cyan}>❆ </Text>
						<Gradient colors={colors.logoGradient}>SNOW CLI</Gradient>
					</Text>
				</Box>

				<Box marginTop={1}>
					<Text color={colors.border} dimColor>
						{'── '}
					</Text>
					<Text color={colors.menuInfo} bold>
						{t.exitScreen.title}
					</Text>
					<Text color={colors.border} dimColor>
						{' ──'}
					</Text>
				</Box>

				<Box marginTop={1}>
					<Text color={colors.text}>{t.exitScreen.goodbye}</Text>
				</Box>

				<Text color={colors.menuSecondary}>{t.exitScreen.thankYou}</Text>

				<Box marginTop={1}>
					<Text color={colors.border} dimColor>
						{dots}
					</Text>
				</Box>

				<Text color={colors.menuSecondary} dimColor>
					{versionText}
				</Text>
			</Box>
		</Box>
	);
}
