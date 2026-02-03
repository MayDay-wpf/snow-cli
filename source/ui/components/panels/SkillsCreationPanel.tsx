import React, {useState, useCallback, useEffect, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	validateSkillId,
	checkSkillExists,
	generateSkillDraftWithAI,
	type GeneratedSkillContent,
	type GeneratedSkillDraft,
	type SkillLocation,
} from '../../../utils/commands/skills.js';

type CreationMode = 'manual' | 'ai';

type Step =
	| 'mode'
	| 'name'
	| 'description'
	| 'location'
	| 'confirm'
	| 'ai-requirement'
	| 'ai-location'
	| 'ai-generating'
	| 'ai-preview'
	| 'ai-edit-name'
	| 'ai-error';

interface Props {
	onSave: (
		skillName: string,
		description: string,
		location: SkillLocation,
		generated?: GeneratedSkillContent,
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
	const [step, setStep] = useState<Step>('mode');
	const [mode, setMode] = useState<CreationMode>('manual');
	const [skillName, setSkillName] = useState('');
	const [description, setDescription] = useState('');
	const [location, setLocation] = useState<SkillLocation>('global');
	const [requirement, setRequirement] = useState('');
	const [generated, setGenerated] = useState<
		GeneratedSkillContent | undefined
	>();
	const [errorMessage, setErrorMessage] = useState<string>('');
	const abortControllerRef = useRef<AbortController | null>(null);

	const handleCancel = useCallback(() => {
		try {
			abortControllerRef.current?.abort();
		} catch {
			// Ignore abort errors
		}
		onCancel();
	}, [onCancel]);

	const handleNameSubmit = useCallback(
		(value: string) => {
			if (!value.trim()) {
				return;
			}

			const trimmedName = value.trim();
			const validation = validateSkillId(trimmedName);

			if (!validation.valid) {
				setErrorMessage(validation.error || t.skillsCreation.errorInvalidName);
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
			}

			if (existsGlobal) {
				setErrorMessage(
					t.skillsCreation.errorExistsGlobal.replace('{name}', trimmedName),
				);
				return;
			}

			if (existsProject) {
				setErrorMessage(
					t.skillsCreation.errorExistsProject.replace('{name}', trimmedName),
				);
				return;
			}

			setErrorMessage('');
			setSkillName(trimmedName);
			setStep('description');
		},
		[projectRoot, t.skillsCreation],
	);

	const handleDescriptionSubmit = useCallback((value: string) => {
		if (value.trim()) {
			setDescription(value.trim());
			setStep('location');
		}
	}, []);

	const handleRequirementSubmit = useCallback((value: string) => {
		if (value.trim()) {
			setRequirement(value.trim());
			setErrorMessage('');
			setStep('ai-location');
		}
	}, []);

	const handleConfirmManual = useCallback(async () => {
		await onSave(skillName, description, location);
	}, [skillName, description, location, onSave]);

	const handleConfirmAI = useCallback(async () => {
		if (!generated) {
			setErrorMessage(t.skillsCreation.errorNoGeneratedContent);
			return;
		}
		await onSave(skillName, description, location, generated);
	}, [generated, skillName, description, location, onSave, t.skillsCreation]);

	const handleEditNameSubmit = useCallback(
		(value: string) => {
			if (!value.trim()) {
				return;
			}
			const trimmedName = value.trim();
			const validation = validateSkillId(trimmedName);
			if (!validation.valid) {
				setErrorMessage(validation.error || t.skillsCreation.errorInvalidName);
				return;
			}

			const existsGlobal = checkSkillExists(trimmedName, 'global');
			const existsProject = checkSkillExists(
				trimmedName,
				'project',
				projectRoot,
			);
			if (existsGlobal || existsProject) {
				setErrorMessage(
					t.skillsCreation.errorExistsAny.replace('{name}', trimmedName),
				);
				return;
			}

			setErrorMessage('');
			setSkillName(trimmedName);
			setStep('ai-preview');
		},
		[projectRoot, t.skillsCreation],
	);

	// Start generation when entering ai-generating step
	useEffect(() => {
		if (step !== 'ai-generating') {
			return;
		}

		const controller = new AbortController();
		abortControllerRef.current = controller;
		setErrorMessage('');
		setGenerated(undefined);

		generateSkillDraftWithAI(requirement, projectRoot, controller.signal)
			.then((draft: GeneratedSkillDraft) => {
				setSkillName(draft.skillName);
				setDescription(draft.description);
				setGenerated(draft.generated);
				setStep('ai-preview');
			})
			.catch((error: unknown) => {
				if (controller.signal.aborted) {
					return;
				}
				const message =
					error instanceof Error
						? error.message
						: t.skillsCreation.errorGeneration;
				setErrorMessage(message);
				setStep('ai-error');
			})
			.finally(() => {
				abortControllerRef.current = null;
			});

		return () => {
			try {
				controller.abort();
			} catch {
				// Ignore abort errors
			}
		};
	}, [step, requirement, projectRoot, t.skillsCreation.errorGeneration]);

	useInput(
		(input, key) => {
			if (key.escape) {
				// Sequential back navigation based on current step and mode
				if (step === 'confirm') {
					setStep('location');
				} else if (step === 'location') {
					setStep('description');
				} else if (step === 'description') {
					setStep('name');
				} else if (step === 'name') {
					setStep('mode');
				} else if (step === 'ai-edit-name') {
					setStep('ai-preview');
				} else if (step === 'ai-preview') {
					setStep('ai-location');
				} else if (step === 'ai-location') {
					setStep('ai-requirement');
				} else if (step === 'ai-requirement') {
					setStep('mode');
				} else if (step === 'ai-error') {
					setStep('ai-location');
				} else if (step === 'ai-generating') {
					// Cancel generation and close panel
					handleCancel();
				} else if (step === 'mode') {
					handleCancel();
				}
				return;
			}

			if (step === 'mode') {
				if (input.toLowerCase() === 'm') {
					setMode('manual');
					setErrorMessage('');
					setStep('name');
				} else if (input.toLowerCase() === 'a') {
					setMode('ai');
					setErrorMessage('');
					setSkillName('');
					setDescription('');
					setGenerated(undefined);
					setStep('ai-requirement');
				}
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
				return;
			}

			if (step === 'confirm') {
				if (input.toLowerCase() === 'y') {
					handleConfirmManual();
				} else if (input.toLowerCase() === 'n') {
					setStep('location');
				}
				return;
			}

			if (step === 'ai-location') {
				if (input.toLowerCase() === 'g') {
					setLocation('global');
					setStep('ai-generating');
				} else if (input.toLowerCase() === 'p') {
					setLocation('project');
					setStep('ai-generating');
				}
				return;
			}

			if (step === 'ai-preview') {
				if (input.toLowerCase() === 'y') {
					handleConfirmAI();
				} else if (input.toLowerCase() === 'e') {
					setErrorMessage('');
					setStep('ai-edit-name');
				} else if (input.toLowerCase() === 'r') {
					setErrorMessage('');
					setStep('ai-generating');
				}
				return;
			}

			if (step === 'ai-error') {
				if (input.toLowerCase() === 'r') {
					setErrorMessage('');
					setStep('ai-generating');
				}
			}
		},
		{isActive: true},
	);

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

			{step === 'mode' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>{t.skillsCreation.modeLabel}</Text>
					</Box>
					<Box gap={2}>
						<Box>
							<Text color={theme.colors.success} bold>
								[A]
							</Text>
							<Text color={theme.colors.text}> {t.skillsCreation.modeAi}</Text>
						</Box>
						<Box>
							<Text color={theme.colors.menuSelected} bold>
								[M]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.skillsCreation.modeManual}
							</Text>
						</Box>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsCreation.escCancel}</Text>
					</Box>
				</Box>
			)}

			{mode === 'manual' && step === 'name' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>{t.skillsCreation.nameLabel}</Text>
					</Box>
					<Box marginBottom={1}>
						<Text dimColor>{t.skillsCreation.nameHint}</Text>
					</Box>
					<TextInput
						placeholder={t.skillsCreation.namePlaceholder}
						value={skillName}
						onChange={setSkillName}
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

			{mode === 'manual' && step === 'description' && (
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
						value={description}
						onChange={setDescription}
						onSubmit={handleDescriptionSubmit}
					/>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsCreation.escCancel}</Text>
					</Box>
				</Box>
			)}

			{mode === 'manual' && step === 'location' && (
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

			{mode === 'manual' && step === 'confirm' && (
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

			{mode === 'ai' && step === 'ai-requirement' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.requirementLabel}
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text dimColor>{t.skillsCreation.requirementHint}</Text>
					</Box>
					<TextInput
						placeholder={t.skillsCreation.requirementPlaceholder}
						value={requirement}
						onChange={setRequirement}
						onSubmit={handleRequirementSubmit}
					/>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsCreation.escCancel}</Text>
					</Box>
				</Box>
			)}

			{mode === 'ai' && step === 'ai-location' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.requirementLabel}{' '}
							<Text color={theme.colors.menuNormal}>{requirement}</Text>
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

			{mode === 'ai' && step === 'ai-generating' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.generatingLabel}
						</Text>
					</Box>
					<Box>
						<Text color={theme.colors.menuNormal}>
							<Spinner type="dots" /> {t.skillsCreation.generatingMessage}
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsCreation.escCancel}</Text>
					</Box>
				</Box>
			)}

			{mode === 'ai' && step === 'ai-error' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.error}>
							{t.skillsCreation.errorGeneration}
						</Text>
					</Box>
					{errorMessage && (
						<Box marginBottom={1}>
							<Text color={theme.colors.error}>{errorMessage}</Text>
						</Box>
					)}
					<Box marginTop={1} gap={2}>
						<Box>
							<Text color={theme.colors.menuSelected} bold>
								[R]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.skillsCreation.regenerate}
							</Text>
						</Box>
						<Box>
							<Text color={theme.colors.menuSecondary} dimColor>
								[ESC]
							</Text>
							<Text color={theme.colors.text}> {t.skillsCreation.cancel}</Text>
						</Box>
					</Box>
				</Box>
			)}

			{mode === 'ai' && step === 'ai-preview' && (
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

					<Box marginTop={1} flexDirection="column">
						<Text color={theme.colors.text}>{t.skillsCreation.filesLabel}</Text>
						<Box marginLeft={2} flexDirection="column">
							<Text dimColor>- SKILL.md</Text>
							<Text dimColor>- reference.md</Text>
							<Text dimColor>- examples.md</Text>
							<Text dimColor>- templates/template.txt</Text>
							<Text dimColor>- scripts/helper.py</Text>
						</Box>
					</Box>

					{errorMessage && (
						<Box marginTop={1}>
							<Text color={theme.colors.error}>{errorMessage}</Text>
						</Box>
					)}

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
							<Text color={theme.colors.menuSelected} bold>
								[E]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.skillsCreation.editName}
							</Text>
						</Box>
						<Box>
							<Text color={theme.colors.warning} bold>
								[R]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.skillsCreation.regenerate}
							</Text>
						</Box>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsCreation.escCancel}</Text>
					</Box>
				</Box>
			)}

			{mode === 'ai' && step === 'ai-edit-name' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.skillsCreation.editNameLabel}{' '}
							<Text color={theme.colors.menuNormal}>{skillName}</Text>
						</Text>
					</Box>
					<Box marginBottom={1}>
						<Text dimColor>{t.skillsCreation.editNameHint}</Text>
					</Box>
					<TextInput
						placeholder={t.skillsCreation.editNamePlaceholder}
						value={skillName}
						onChange={setSkillName}
						onSubmit={handleEditNameSubmit}
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
		</Box>
	);
};
