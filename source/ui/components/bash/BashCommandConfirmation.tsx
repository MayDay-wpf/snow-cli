import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useI18n} from '../../../i18n/I18nContext.js';
import {isSensitiveCommand} from '../../../utils/execution/sensitiveCommandManager.js';
import {useTheme} from '../../contexts/ThemeContext.js';

interface BashCommandConfirmationProps {
	command: string;
	onConfirm: (proceed: boolean) => void;
	terminalWidth: number;
}

export function BashCommandConfirmation({
	command,
	terminalWidth,
}: BashCommandConfirmationProps) {
	const {t} = useI18n();
	const {theme} = useTheme();

	// Check if this is a sensitive command
	const sensitiveCheck = isSensitiveCommand(command);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.error}
			paddingX={2}
			paddingY={1}
			width={terminalWidth - 2}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.error}>
					{t.bash.sensitiveCommandDetected}
				</Text>
			</Box>
			<Box marginBottom={1} paddingLeft={2}>
				<Text color={theme.colors.menuInfo}>{command}</Text>
			</Box>
			{sensitiveCheck.isSensitive && sensitiveCheck.matchedCommand && (
				<>
					<Box marginBottom={1}>
						<Text color={theme.colors.warning}>{t.bash.sensitivePattern} </Text>
						<Text dimColor>{sensitiveCheck.matchedCommand.pattern}</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.warning}>{t.bash.sensitiveReason} </Text>
						<Text dimColor>{sensitiveCheck.matchedCommand.description}</Text>
					</Box>
				</>
			)}
			<Box marginBottom={1}>
				<Text color={theme.colors.warning}>{t.bash.executeConfirm}</Text>
			</Box>
			<Box>
				<Text dimColor>{t.bash.confirmHint}</Text>
			</Box>
		</Box>
	);
}

interface BashCommandExecutionStatusProps {
	command: string;
	timeout?: number;
	terminalWidth: number;
}

export function BashCommandExecutionStatus({
	command,
	timeout = 30000,
	terminalWidth,
}: BashCommandExecutionStatusProps) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const timeoutSeconds = Math.round(timeout / 1000);

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={2}
			paddingY={1}
			width={terminalWidth - 2}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuInfo}>
					<Spinner type="dots" /> {t.bash.executingCommand}
				</Text>
			</Box>
			<Box marginBottom={1} paddingLeft={2}>
				<Text dimColor>{command}</Text>
			</Box>
			<Box>
				<Text dimColor>
					{t.bash.timeout} {timeoutSeconds}s{' '}
					{timeout > 60000 && (
						<Text color={theme.colors.warning}>{t.bash.customTimeout}</Text>
					)}
				</Text>
			</Box>
		</Box>
	);
}
