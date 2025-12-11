import React from 'react';
import {Box, Text} from 'ink';
import Gradient from 'ink-gradient';
import {useI18n} from '../../../i18n/I18nContext.js';
import {useTheme} from '../../contexts/ThemeContext.js';

type ChatHeaderProps = {
	terminalWidth: number;
	simpleMode: boolean;
	workingDirectory: string;
};

export default function ChatHeader({
	terminalWidth,
	simpleMode,
	workingDirectory,
}: ChatHeaderProps) {
	const {t} = useI18n();
	const {theme} = useTheme();

	return (
		<Box paddingX={1} width={terminalWidth}>
			<Box
				borderColor={'cyan'}
				borderStyle="round"
				paddingX={2}
				paddingY={1}
				width={terminalWidth - 2}
			>
				<Box flexDirection="column">
					{simpleMode ? (
						<>
							{/* Simple mode: Show responsive ASCII art title */}
							<ChatHeaderLogo
								terminalWidth={terminalWidth}
								logoGradient={theme.colors.logoGradient}
							/>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.chatScreen.headerWorkingDirectory.replace(
									'{directory}',
									workingDirectory,
								)}
							</Text>
						</>
					) : (
						<>
							{/* Normal mode: Show compact title with gradient and tips */}
							<Text color="white" bold>
								<Text color="cyan">❆ </Text>
								<Gradient name="rainbow">
									{t.chatScreen.headerTitle}
								</Gradient>
								<Text color="white"> ⛇</Text>
							</Text>
							<Text>• {t.chatScreen.headerExplanations}</Text>
							<Text>• {t.chatScreen.headerInterrupt}</Text>
							<Text>• {t.chatScreen.headerYolo}</Text>
							<Text>
								{(() => {
									const pasteKey =
										process.platform === 'darwin' ? 'Ctrl+V' : 'Alt+V';
									return `• ${t.chatScreen.headerShortcuts.replace(
										'{pasteKey}',
										pasteKey,
									)}`;
								})()}
							</Text>
							<Text color={theme.colors.menuSecondary} dimColor>
								•{' '}
								{t.chatScreen.headerWorkingDirectory.replace(
									'{directory}',
									workingDirectory,
								)}
							</Text>
						</>
					)}
				</Box>
			</Box>
		</Box>
	);
}

// Responsive ASCII art logo component for simple mode
function ChatHeaderLogo({
	terminalWidth,
	logoGradient,
}: {
	terminalWidth: number;
	logoGradient: [string, string, string];
}) {
	if (terminalWidth >= 68) {
		// Full version: SNOW CLI (width >= 68)
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Gradient colors={logoGradient}>
					<Text bold>
						{`███████╗███╗   ██╗ ██████╗ ██╗    ██╗     ██████╗██╗     ██╗
██╔════╝████╗  ██║██╔═══██╗██║    ██║    ██╔════╝██║     ██║
███████╗██╔██╗ ██║██║   ██║██║ █╗ ██║    ██║     ██║     ██║
╚════██║██║╚██╗██║██║   ██║██║███╗██║    ██║     ██║     ██║
███████║██║ ╚████║╚██████╔╝╚███╔███╔╝    ╚██████╗███████╗██║
╚══════╝╚═╝  ╚═══╝ ╚═════╝  ╚══╝╚══╝      ╚═════╝╚══════╝╚═╝`}
					</Text>
				</Gradient>
			</Box>
		);
	}

	if (terminalWidth >= 45) {
		// Medium version: SNOW only (width 45-67)
		return (
			<Box flexDirection="column" marginBottom={1}>
				<Gradient colors={logoGradient}>
					<Text bold>
						{`███████╗███╗   ██╗ ██████╗ ██╗    ██╗
██╔════╝████╗  ██║██╔═══██╗██║    ██║
███████╗██╔██╗ ██║██║   ██║██║ █╗ ██║
╚════██║██║╚██╗██║██║   ██║██║███╗██║
███████║██║ ╚████║╚██████╔╝╚███╔███╔╝
╚══════╝╚═╝  ╚═══╝ ╚═════╝  ╚══╝╚══╝`}
					</Text>
				</Gradient>
			</Box>
		);
	}

	// Compact version: Normal text (width < 45)
	return (
		<Box marginBottom={1}>
			<Text color="white" bold>
				<Text color="cyan">❆ </Text>
				<Gradient colors={logoGradient}>SNOW CLI</Gradient>
			</Text>
		</Box>
	);
}
