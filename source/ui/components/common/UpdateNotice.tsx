import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import {useI18n} from '../../../i18n/index.js';

type UpdateNoticeProps = {
	currentVersion: string;
	latestVersion: string;
	terminalWidth: number;
};

export default function UpdateNotice({
	currentVersion,
	latestVersion,
	terminalWidth,
}: UpdateNoticeProps) {
	const {t} = useI18n();
	const [wavePosition, setWavePosition] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setWavePosition(prev => (prev + 1) % 12);
		}, 100);
		return () => clearInterval(interval);
	}, []);

	const waveChars = ['░', '▒', '▓', '█', '▓', '▒', '░'];
	const arrowHeight = 8;

	const arrowShapes = [
		'    █    ',
		'   ███   ',
		'  █████  ',
		' ███████ ',
		'   ███   ',
		'   ███   ',
		'   ███   ',
		'   ███   ',
	];

	const createWaveArrow = () => {
		const lines = [];
		for (let row = 0; row < arrowHeight; row++) {
			const shape = arrowShapes[row] || '';
			const waveOffset = (wavePosition + row) % 12;
			let waveChar = '░';

			if (waveOffset < waveChars.length) {
				waveChar = waveChars[waveOffset] || '░';
			}

			const line = shape.replace(/█/g, waveChar);
			lines.push(line);
		}
		return lines;
	};

	const arrowLines = createWaveArrow();

	return (
		<Box paddingX={1} marginBottom={1}>
			<Box
				borderStyle="double"
				borderColor="#FFD700"
				paddingX={2}
				paddingY={1}
				width={terminalWidth - 2}
				flexDirection="row"
			>
				<Box flexDirection="column" flexGrow={1}>
					<Text bold color="#FFD700">
						{t.welcome.updateNoticeTitle}
					</Text>
					<Text color="gray" dimColor>
						{t.welcome.updateNoticeCurrent}:{' '}
						<Text color="gray">{currentVersion}</Text>
					</Text>
					<Text color="gray" dimColor>
						{t.welcome.updateNoticeLatest}:{' '}
						<Text color="#FFD700" bold>
							{latestVersion}
						</Text>
					</Text>
					<Text color="gray" dimColor>
						{t.welcome.updateNoticeRun}:{' '}
						<Text color="#FFD700" bold>
							snow --update
						</Text>
					</Text>
					<Text color="gray" dimColor>
						{t.welcome.updateNoticeGithub}:{' '}
						https://github.com/MayDay-wpf/snow-cli
					</Text>
				</Box>
				<Box flexDirection="column" marginLeft={2} justifyContent="center">
					{arrowLines.map((line, index) => (
						<Text key={index} color="#FFD700">
							{line}
						</Text>
					))}
				</Box>
			</Box>
		</Box>
	);
}
