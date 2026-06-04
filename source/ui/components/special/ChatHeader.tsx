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
						<Text>• {t.chatScreen.headerExpandedView}</Text>
						<Text>• {t.chatScreen.headerSimpleHint}</Text>
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

// 将 LOGO 字符串按可见字符数遮罩：未显示的可见字符替换为空格，换行保留，
// 用于在保持布局稳定（行数/列宽不变）的前提下做"逐字显现"动画。
// 当 revealChars 未传入或 >= 可见字符总数时，直接返回原始字符串。
function maskRevealedChars(full: string, revealChars?: number): string {
	if (revealChars === undefined) return full;
	let visibleTotal = 0;
	for (const ch of full) {
		if (ch !== '\n') visibleTotal++;
	}
	if (revealChars >= visibleTotal) return full;
	let result = '';
	let revealed = 0;
	for (const ch of full) {
		if (ch === '\n') {
			result += ch;
		} else if (revealed < revealChars) {
			result += ch;
			revealed++;
		} else {
			result += ' ';
		}
	}
	return result;
}

// Responsive ASCII art logo component for simple mode
export function ChatHeaderLogo({
	terminalWidth,
	logoGradient,
	hideCompact = false,
	revealChars,
}: {
	terminalWidth: number;
	logoGradient: [string, string, string];
	// 当为 true 时，宽度过窄（< 20）不再回退到最小 LOGO，而是直接不渲染。
	// 用于 WelcomeScreen 这种"位置紧张时宁可隐藏也不要降级展示"的场景。
	hideCompact?: boolean;
	// 控制 LOGO 已显示的可见字符数（不计换行）。未传入则始终完整显示。
	// 用于 WelcomeScreen 入场时的一次性逐字符出现动画。
	revealChars?: number;
}) {
	if (terminalWidth >= 30) {
		// Full version: SNOW CLI with thin style (width >= 30)
		const fullLogo = `╔═╗╔╗╔╔═╗╦ ╦  ╔═╗╦  ╦
╚═╗║║║║ ║║║║  ║  ║  ║
╚═╝╝╚╝╚═╝╚╩╝  ╚═╝╩═╝╩`;
		return (
			<Box flexDirection="column" marginBottom={0}>
				<Gradient colors={logoGradient}>
					<Text>{maskRevealedChars(fullLogo, revealChars)}</Text>
				</Gradient>
			</Box>
		);
	}

	if (terminalWidth >= 20) {
		// Medium version: SNOW only (width 20-29)
		const mediumLogo = `╔═╗╔╗╔╔═╗╦ ╦
╚═╗║║║║ ║║║║
╚═╝╝╚╝╚═╝╚╩╝`;
		return (
			<Box flexDirection="column" marginBottom={0}>
				<Gradient colors={logoGradient}>
					<Text>{maskRevealedChars(mediumLogo, revealChars)}</Text>
				</Gradient>
			</Box>
		);
	}

	// Compact version: Normal text (width < 20)
	// 当 hideCompact=true 时，调用方明确要求"宽度不够就直接不渲染最小 LOGO"，
	// 避免在 WelcomeScreen 右半区被压缩时还塞一行 "❆ SNOW CLI" 文本。
	if (hideCompact) {
		return null;
	}
	return (
		<Box marginBottom={0}>
			<Text>
				<Text color="cyan">❆ </Text>
				<Gradient colors={logoGradient}>SNOW CLI</Gradient>
			</Text>
		</Box>
	);
}
