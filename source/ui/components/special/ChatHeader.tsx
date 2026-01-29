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
			{simpleMode ? (
				// Simple mode: No border, smaller logo
				<Box paddingX={1} paddingY={1}>
					<Box flexDirection="column">
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
					</Box>
				</Box>
			) : (
				// Normal mode: With border and tips
				<Box
					borderColor={'cyan'}
					borderStyle="round"
					paddingX={1}
					paddingY={1}
					width={terminalWidth - 2}
				>
					<Box flexDirection="column">
						<Text color="white" bold>
							<Text color="cyan">❆ </Text>
							<Gradient colors={theme.colors.logoGradient}>SNOW CLI</Gradient>
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
						{process.platform === 'win32' && (
							<Text>• Ctrl+G (Notepad edit)</Text>
						)}
						<Text color={theme.colors.menuSecondary} dimColor>
							•{' '}
							{t.chatScreen.headerWorkingDirectory.replace(
								'{directory}',
								workingDirectory,
							)}
						</Text>
					</Box>
				</Box>
			)}
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
	if (terminalWidth >= 30) {
		// Full version: SNOW CLI with thin style (width >= 30)
		return (
			<Box flexDirection="column" marginBottom={0}>
				<Gradient colors={logoGradient}>
					<Text>
						{`╔═╗╔╗╔╔═╗╦ ╦  ╔═╗╦  ╦
╚═╗║║║║ ║║║║  ║  ║  ║
╚═╝╝╚╝╚═╝╚╩╝  ╚═╝╩═╝╩`}
					</Text>
				</Gradient>
			</Box>
		);
	}

	if (terminalWidth >= 20) {
		// Medium version: SNOW only (width 20-29)
		return (
			<Box flexDirection="column" marginBottom={0}>
				<Gradient colors={logoGradient}>
					<Text>
						{`╔═╗╔╗╔╔═╗╦ ╦
╚═╗║║║║ ║║║║
╚═╝╝╚╝╚═╝╚╩╝`}
					</Text>
				</Gradient>
			</Box>
		);
	}

	// Compact version: Normal text (width < 20)
	return (
		<Box marginBottom={0}>
			<Text>
				<Text color="cyan">❆ </Text>
				<Gradient colors={logoGradient}>SNOW CLI</Gradient>
			</Text>
		</Box>
	);
}
