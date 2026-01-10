import React, {useState, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {TextInput} from '@inkjs/ui';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	isCommandNameConflict,
	checkCommandExists,
	type CommandLocation,
} from '../../../utils/commands/custom.js';

interface Props {
	onSave: (
		name: string,
		command: string,
		type: 'execute' | 'prompt',
		location: CommandLocation,
		description?: string,
	) => Promise<void>;
	onCancel: () => void;
	projectRoot?: string;
}

export const CustomCommandConfigPanel: React.FC<Props> = ({
	onSave,
	onCancel,
	projectRoot,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<
		'name' | 'command' | 'description' | 'type' | 'location' | 'confirm'
	>('name');
	const [commandName, setCommandName] = useState('');
	const [commandText, setCommandText] = useState('');
	const [commandDescription, setCommandDescription] = useState('');
	const [commandType, setCommandType] = useState<'execute' | 'prompt'>(
		'execute',
	);
	const [location, setLocation] = useState<CommandLocation>('global');
	const [errorMessage, setErrorMessage] = useState<string>('');

	// Handle keyboard input for type, location and confirmation steps
	useInput(
		(input, key) => {
			if (key.escape) {
				handleCancel();
				return;
			}

			if (step === 'type') {
				if (input.toLowerCase() === 'e') {
					setCommandType('execute');
					setStep('location');
				} else if (input.toLowerCase() === 'p') {
					setCommandType('prompt');
					setStep('location');
				}
			} else if (step === 'location') {
				if (input.toLowerCase() === 'g') {
					setLocation('global');
					setStep('confirm');
				} else if (input.toLowerCase() === 'p') {
					setLocation('project');
					setStep('confirm');
				}
			} else if (step === 'confirm') {
				if (input.toLowerCase() === 'y') {
					handleConfirm();
				} else if (input.toLowerCase() === 'n') {
					handleCancel();
				}
			}
		},
		{isActive: step === 'type' || step === 'location' || step === 'confirm'},
	);

	const handleNameSubmit = useCallback(
		(value: string) => {
			if (value.trim()) {
				const trimmedName = value.trim();
				// Check for command name conflicts with built-in commands
				if (isCommandNameConflict(trimmedName)) {
					setErrorMessage(
						`Command name "${trimmedName}" conflicts with an existing built-in or custom command`,
					);
					return;
				}

				// Check if command exists in either location
				const existsGlobal = checkCommandExists(trimmedName, 'global');
				const existsProject = checkCommandExists(
					trimmedName,
					'project',
					projectRoot,
				);

				if (existsGlobal && existsProject) {
					setErrorMessage(
						`Command "${trimmedName}" already exists in both global and project locations`,
					);
					return;
				} else if (existsGlobal) {
					setErrorMessage(
						`Command "${trimmedName}" already exists in global location`,
					);
					return;
				} else if (existsProject) {
					setErrorMessage(
						`Command "${trimmedName}" already exists in project location`,
					);
					return;
				}

				setErrorMessage('');
				setCommandName(trimmedName);
				setStep('command');
			}
		},
		[projectRoot],
	);

	const handleCommandSubmit = useCallback((value: string) => {
		if (value.trim()) {
			setCommandText(value.trim());
			setStep('description');
		}
	}, []);

	const handleDescriptionSubmit = useCallback((value: string) => {
		setCommandDescription(value.trim());
		setStep('type');
	}, []);

	const handleConfirm = useCallback(async () => {
		const trimmedDescription = commandDescription.trim();
		const description =
			trimmedDescription.length > 0 ? trimmedDescription : undefined;
		await onSave(commandName, commandText, commandType, location, description);
	}, [
		commandName,
		commandText,
		commandType,
		location,
		commandDescription,
		onSave,
	]);

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

			{step === 'description' && (
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
							{t.customCommand.commandLabel}{' '}
							<Text color={theme.colors.menuNormal}>{commandText}</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.customCommand.descriptionLabel}
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text dimColor>{t.customCommand.descriptionHint}</Text>
					</Box>
					<TextInput
						placeholder={t.customCommand.descriptionPlaceholder}
						onSubmit={handleDescriptionSubmit}
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

			{step === 'location' && (
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
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.customCommand.descriptionLabel}{' '}
							<Text color={theme.colors.menuNormal}>
								{commandDescription || t.customCommand.descriptionNotSet}
							</Text>
						</Text>
					</Box>
					<Box marginBottom={1} marginTop={1}>
						<Text color={theme.colors.text}>
							{t.customCommand.locationLabel}
						</Text>
					</Box>
					<Box marginTop={1} flexDirection="column" gap={1}>
						<Box>
							<Text color={theme.colors.success} bold>
								[G]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.customCommand.locationGlobal}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text dimColor>{t.customCommand.locationGlobalInfo}</Text>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSelected} bold>
								[P]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.customCommand.locationProject}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text dimColor>{t.customCommand.locationProjectInfo}</Text>
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
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.customCommand.descriptionLabel}{' '}
							<Text color={theme.colors.menuNormal}>
								{commandDescription || t.customCommand.descriptionNotSet}
							</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							Location:{' '}
							<Text bold color={theme.colors.menuSelected}>
								{location === 'global'
									? t.customCommand.locationGlobal
									: t.customCommand.locationProject}
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
