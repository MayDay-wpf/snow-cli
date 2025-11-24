import React, {useState, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {TextInput} from '@inkjs/ui';
import {useTheme} from '../contexts/ThemeContext.js';
import {useI18n} from '../../i18n/I18nContext.js';
import {isCommandNameConflict} from '../../utils/commands/custom.js';

interface Props {
	onSave: (
		name: string,
		command: string,
		type: 'execute' | 'prompt',
	) => Promise<void>;
	onCancel: () => void;
}

export const CustomCommandConfigPanel: React.FC<Props> = ({
	onSave,
	onCancel,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<'name' | 'command' | 'type' | 'confirm'>(
		'name',
	);
	const [commandName, setCommandName] = useState('');
	const [commandText, setCommandText] = useState('');
	const [commandType, setCommandType] = useState<'execute' | 'prompt'>(
		'execute',
	);
	const [errorMessage, setErrorMessage] = useState<string>('');

	// Handle keyboard input for type and confirmation steps
	useInput(
		(input, key) => {
			if (step === 'type') {
				if (input.toLowerCase() === 'e') {
					setCommandType('execute');
					setStep('confirm');
				} else if (input.toLowerCase() === 'p') {
					setCommandType('prompt');
					setStep('confirm');
				}
			} else if (step === 'confirm') {
				if (input.toLowerCase() === 'y') {
					handleConfirm();
				} else if (input.toLowerCase() === 'n' || key.escape) {
					handleCancel();
				}
			}
		},
		{isActive: step === 'type' || step === 'confirm'},
	);

	const handleNameSubmit = useCallback((value: string) => {
		if (value.trim()) {
			const trimmedName = value.trim();
			// Check for command name conflicts
			if (isCommandNameConflict(trimmedName)) {
				setErrorMessage(
					`Command name "${trimmedName}" conflicts with an existing built-in or custom command`,
				);
				return;
			}
			setErrorMessage('');
			setCommandName(trimmedName);
			setStep('command');
		}
	}, []);

	const handleCommandSubmit = useCallback((value: string) => {
		if (value.trim()) {
			setCommandText(value.trim());
			setStep('type');
		}
	}, []);

	const handleConfirm = useCallback(async () => {
		await onSave(commandName, commandText, commandType);
	}, [commandName, commandText, commandType, onSave]);

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{t.customCommand.title}
				</Text>
			</Box>

			{step === 'name' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>{t.customCommand.nameLabel}</Text>
					</Box>
					<TextInput
						placeholder={t.customCommand.namePlaceholder}
						onSubmit={handleNameSubmit}
					/>
					{errorMessage && (
						<Box marginTop={1}>
							<Text color={theme.colors.error}>{errorMessage}</Text>
						</Box>
					)}
					<Box marginTop={1}>
						<Text dimColor>{t.customCommand.escCancel}</Text>
					</Box>
				</Box>
			)}

			{step === 'command' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.customCommand.nameLabel}{' '}
							<Text bold color={theme.colors.success}>
								{commandName}
							</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.customCommand.commandLabel}
						</Text>
					</Box>
					<TextInput
						placeholder={t.customCommand.commandPlaceholder}
						onSubmit={handleCommandSubmit}
					/>
					<Box marginTop={1}>
						<Text dimColor>{t.customCommand.escCancel}</Text>
					</Box>
				</Box>
			)}

			{step === 'type' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							Command:{' '}
							<Text color={theme.colors.menuNormal}>{commandText}</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>{t.customCommand.typeLabel}</Text>
					</Box>
					<Box marginTop={1} gap={2}>
						<Box>
							<Text color={theme.colors.success} bold>
								[E]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.customCommand.typeExecute}
							</Text>
						</Box>
						<Box>
							<Text color={theme.colors.menuSelected} bold>
								[P]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.customCommand.typePrompt}
							</Text>
						</Box>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.customCommand.escCancel}</Text>
					</Box>
				</Box>
			)}

			{step === 'confirm' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.customCommand.nameLabel}{' '}
							<Text bold color={theme.colors.success}>
								{commandName}
							</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							Command:{' '}
							<Text color={theme.colors.menuNormal}>{commandText}</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							Type:{' '}
							<Text bold color={theme.colors.menuSelected}>
								{commandType === 'execute'
									? t.customCommand.typeExecute
									: t.customCommand.typePrompt}
							</Text>
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text color={theme.colors.text}>{t.customCommand.confirmSave}</Text>
					</Box>
					<Box marginTop={1} gap={2}>
						<Box>
							<Text color={theme.colors.success} bold>
								[Y]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.customCommand.confirmYes}
							</Text>
						</Box>
						<Box>
							<Text color={theme.colors.error} bold>
								[N]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.customCommand.confirmNo}
							</Text>
						</Box>
					</Box>
				</Box>
			)}
		</Box>
	);
};
