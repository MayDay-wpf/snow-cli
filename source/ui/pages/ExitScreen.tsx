import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import Gradient from 'ink-gradient';
import { useI18n } from '../../i18n/index.js';
import { useTheme } from '../contexts/ThemeContext.js';
import { useTerminalSize } from '../../hooks/ui/useTerminalSize.js';
import { gracefulExit } from '../../utils/core/processManager.js';

type Props = {
	version?: string;
};

function dotLine(width: number): string {
	const count = Math.max(0, Math.floor(width / 3));
	return Array.from({ length: count }, () => '·').join('  ');
}

export default function ExitScreen({ version = '1.0.0' }: Props) {
	const { t } = useI18n();
	const { theme } = useTheme();
	const { columns: terminalWidth } = useTerminalSize();

	useEffect(() => {
		gracefulExit();
	}, []);

	const versionText = t.exitScreen.version.replace('{version}', version);
	const dotWidth = Math.max(12, Math.min(terminalWidth - 8, 42));
	const dots = useMemo(() => dotLine(dotWidth), [dotWidth]);
	const colors = theme.colors;

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
