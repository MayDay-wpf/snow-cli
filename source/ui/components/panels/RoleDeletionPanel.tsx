import React, {useState, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	checkRoleExists,
	type RoleLocation,
} from '../../../utils/commands/role.js';

type Step = 'location' | 'confirm';

interface Props {
	onDelete: (location: RoleLocation) => Promise<void>;
	onCancel: () => void;
	projectRoot?: string;
}

export const RoleDeletionPanel: React.FC<Props> = ({
	onDelete,
	onCancel,
	projectRoot,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<Step>('location');
	const [location, setLocation] = useState<RoleLocation>('global');

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	const handleConfirm = useCallback(async () => {
		await onDelete(location);
	}, [location, onDelete]);

	const keyHandlingActive = step === 'location' || step === 'confirm';

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
				return;
			}

			if (step === 'confirm') {
				if (input.toLowerCase() === 'y') {
					handleConfirm();
				} else if (input.toLowerCase() === 'n') {
					handleCancel();
				}
			}
		},
		{isActive: keyHandlingActive},
	);

	// Check if ROLE exists at selected location
	const existsAtLocation = checkRoleExists(location, projectRoot);

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{t.roleDeletion.title}
				</Text>
			</Box>

			{step === 'location' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.roleDeletion.locationLabel}
						</Text>
					</Box>
					<Box marginTop={1} flexDirection="column" gap={1}>
						<Box>
							<Text color={theme.colors.success} bold>
								[G]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.roleDeletion.locationGlobal}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text dimColor>{t.roleDeletion.locationGlobalInfo}</Text>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSelected} bold>
								[P]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.roleDeletion.locationProject}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text dimColor>{t.roleDeletion.locationProjectInfo}</Text>
						</Box>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.roleDeletion.escCancel}</Text>
					</Box>
				</Box>
			)}

			{step === 'confirm' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{t.roleDeletion.locationLabel}{' '}
							<Text bold color={theme.colors.menuSelected}>
								{location === 'global'
									? t.roleDeletion.locationGlobal
									: t.roleDeletion.locationProject}
							</Text>
						</Text>
					</Box>

					{!existsAtLocation && (
						<Box marginBottom={1}>
							<Text color={theme.colors.warning}>
								{location === 'global'
									? t.roleDeletion.warningNotExistsGlobal
									: t.roleDeletion.warningNotExistsProject}
							</Text>
						</Box>
					)}

					<Box marginTop={1}>
						<Text color={theme.colors.text}>
							{t.roleDeletion.confirmQuestion}
						</Text>
					</Box>
					<Box marginTop={1} gap={2}>
						<Box>
							<Text color={theme.colors.success} bold>
								[Y]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{t.roleDeletion.confirmYes}
							</Text>
						</Box>
						<Box>
							<Text color={theme.colors.error} bold>
								[N]
							</Text>
							<Text color={theme.colors.text}> {t.roleDeletion.confirmNo}</Text>
						</Box>
					</Box>
				</Box>
			)}
		</Box>
	);
};
