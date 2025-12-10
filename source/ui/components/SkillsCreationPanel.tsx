import React, {useState, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {TextInput} from '@inkjs/ui';
import {useTheme} from '../contexts/ThemeContext.js';
import {useI18n} from '../../i18n/I18nContext.js';
import {
	validateSkillName,
	checkSkillExists,
	type SkillLocation,
} from '../../utils/commands/skills.js';

interface Props {
	onSave: (
		skillName: string,
		description: string,
		location: SkillLocation,
	) => Promise<void>;
	onCancel: () => void;
	projectRoot?: string;
}

export const SkillsCreationPanel: React.FC<Props> = ({
	onSave,
	onCancel,
	projectRoot,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<
		'name' | 'description' | 'location' | 'confirm'
	>('name');
	const [skillName, setSkillName] = useState('');
	const [description, setDescription] = useState('');
	const [location, setLocation] = useState<SkillLocation>('global');
	const [errorMessage, setErrorMessage] = useState<string>('');

	// Handle keyboard input for location and confirmation steps
	useInput(
		(input, key) => {
			if (key.escape) {
				handleCancel();
				return;
			}

			if (step === 'location') {
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
		{isActive: step === 'location' || step === 'confirm'},
	);

	const handleNameSubmit = useCallback(
		(value: string) => {
			if (value.trim()) {
				const trimmedName = value.trim();
				const validation = validateSkillName(trimmedName);

				if (!validation.valid) {
					setErrorMessage(
						validation.error || t.skillsCreation.errorInvalidName,
					);
					return;
				}

				// Check if skill name already exists in both locations
				const existsGlobal = checkSkillExists(trimmedName, 'global');
				const existsProject = checkSkillExists(
					trimmedName,
					'project',
					projectRoot,
				);

				if (existsGlobal && existsProject) {
					setErrorMessage(
						t.skillsCreation.errorExistsBoth.replace('{name}', trimmedName),
					);
					return;
				} else if (existsGlobal) {
					setErrorMessage(
						t.skillsCreation.errorExistsGlobal.replace('{name}', trimmedName),
					);
					return;
				} else if (existsProject) {
					setErrorMessage(
						t.skillsCreation.errorExistsProject.replace('{name}', trimmedName),
					);
					return;
				}

				setErrorMessage('');
				setSkillName(trimmedName);
				setStep('description');
			}
		},
		[projectRoot, t.skillsCreation],
	);

	const handleDescriptionSubmit = useCallback((value: string) => {
		if (value.trim()) {
			setDescription(value.trim());
			setStep('location');
		}
	}, []);

	const handleConfirm = useCallback(async () => {
		await onSave(skillName, description, location);
	}, [skillName, description, location, onSave]);

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
					{t.skillsCreation.title}
				</Text>
			</Box>

			{step === 'name' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>{t.skillsCreation.nameLabel}</Text>
					</Box>
					<Box marginBottom={1}>
						<Text dimColor>{t.skillsCreation.nameHint}</Text>
					</Box>
					<TextInput
						placeholder={t.skillsCreation.namePlaceholder}
						onSubmit={handleNameSubmit}
					/>
					{errorMessage && (
						<Box marginTop={1}>
							<Text color={theme.colors.error}>{errorMessage}</Text>
						</Box>
					)}
					<Box marginTop={1}>
						<Text dimColor>{t.skillsCreation.escCancel}</Text>
					</Box>
				</Box>
			)}

			{step === 'description' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.nameLabel}{' '}
							<Text bold color={theme.colors.success}>
								{skillName}
							</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.descriptionLabel}
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text dimColor>{t.skillsCreation.descriptionHint}</Text>
					</Box>
					<TextInput
						placeholder={t.skillsCreation.descriptionPlaceholder}
						onSubmit={handleDescriptionSubmit}
					/>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsCreation.escCancel}</Text>
					</Box>
				</Box>
			)}

			{step === 'location' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.nameLabel}{' '}
							<Text bold color={theme.colors.success}>
								{skillName}
							</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.descriptionLabel}{' '}
							<Text color={theme.colors.menuNormal}>{description}</Text>
						</Text>
					</Box>
					<Box marginBottom={1} marginTop={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.locationLabel}
						</Text>
					</Box>
					<Box marginTop={1} flexDirection="column" gap={1}>
						<Box>
							<Text color={theme.colors.success} bold>
								[G]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.skillsCreation.locationGlobal}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text dimColor>{t.skillsCreation.locationGlobalInfo}</Text>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSelected} bold>
								[P]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.skillsCreation.locationProject}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text dimColor>{t.skillsCreation.locationProjectInfo}</Text>
						</Box>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsCreation.escCancel}</Text>
					</Box>
				</Box>
			)}

			{step === 'confirm' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.nameLabel}{' '}
							<Text bold color={theme.colors.success}>
								{skillName}
							</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.descriptionLabel}{' '}
							<Text color={theme.colors.menuNormal}>{description}</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.locationLabel}{' '}
							<Text bold color={theme.colors.menuSelected}>
								{location === 'global'
									? t.skillsCreation.locationGlobal
									: t.skillsCreation.locationProject}
							</Text>
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.confirmQuestion}
						</Text>
					</Box>
					<Box marginTop={1} gap={2}>
						<Box>
							<Text color={theme.colors.success} bold>
								[Y]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.skillsCreation.confirmYes}
							</Text>
						</Box>
						<Box>
							<Text color={theme.colors.error} bold>
								[N]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.skillsCreation.confirmNo}
							</Text>
						</Box>
					</Box>
				</Box>
			)}
		</Box>
	);
};
