import React, {useState, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	listRoleSubagents,
	type RoleSubagentLocation,
	type RoleSubagentItem,
} from '../../../utils/commands/roleSubagent.js';

type Step = 'location' | 'selectRole' | 'confirm';

interface Props {
	onDelete: (
		agentName: string,
		location: RoleSubagentLocation,
	) => Promise<void>;
	onCancel: () => void;
	projectRoot?: string;
}

export const RoleSubagentDeletionPanel: React.FC<Props> = ({
	onDelete,
	onCancel,
	projectRoot,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<Step>('location');
	const [location, setLocation] = useState<RoleSubagentLocation>('global');
	const [selectedIndex, setSelectedIndex] = useState(0);

	const roleItems = useMemo(
		() => listRoleSubagents(location, projectRoot),
		[location, projectRoot],
	);

	const selectedItem: RoleSubagentItem | undefined = roleItems[selectedIndex];

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	const handleConfirm = useCallback(async () => {
		if (!selectedItem) return;
		await onDelete(selectedItem.agentName, location);
	}, [selectedItem, location, onDelete]);

	const keyHandlingActive =
		step === 'location' || step === 'selectRole' || step === 'confirm';

	useInput(
		(input, key) => {
			if (key.escape) {
				if (step === 'confirm') {
					setStep('selectRole');
				} else if (step === 'selectRole') {
					setStep('location');
				} else {
					handleCancel();
				}
				return;
			}

			if (step === 'location') {
				if (input.toLowerCase() === 'g') {
					setLocation('global');
					setSelectedIndex(0);
					setStep('selectRole');
				} else if (input.toLowerCase() === 'p') {
					setLocation('project');
					setSelectedIndex(0);
					setStep('selectRole');
				}
				return;
			}

			if (step === 'selectRole') {
				if (key.upArrow) {
					setSelectedIndex(prev => Math.max(0, prev - 1));
					return;
				}
				if (key.downArrow) {
					setSelectedIndex(prev =>
						Math.min(roleItems.length - 1, prev + 1),
					);
					return;
				}
				if (key.return && selectedItem) {
					setStep('confirm');
					return;
				}
				return;
			}

			if (step === 'confirm') {
				if (input.toLowerCase() === 'y') {
					handleConfirm();
				} else if (input.toLowerCase() === 'n') {
					setStep('selectRole');
				}
			}
		},
		{isActive: keyHandlingActive},
	);

	const rs = (t as any).roleSubagentDeletion || {};

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{rs.title || 'Delete Sub-Agent Role'}
				</Text>
			</Box>

			{step === 'location' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{rs.locationLabel || 'Select Location:'}
						</Text>
					</Box>
					<Box marginTop={1} flexDirection="column" gap={1}>
						<Box>
							<Text color={theme.colors.success} bold>
								[G]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{rs.locationGlobal || 'Global (~/.snow/)'}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text dimColor>
								{rs.locationGlobalInfo ||
									'Sub-agent role files for all projects'}
							</Text>
						</Box>
						<Box marginTop={1}>
							<Text color={theme.colors.menuSelected} bold>
								[P]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{rs.locationProject || 'Project (./.snow/)'}
							</Text>
						</Box>
						<Box marginLeft={4}>
							<Text dimColor>
								{rs.locationProjectInfo ||
									'Sub-agent role files for current project only'}
							</Text>
						</Box>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{rs.escCancel || 'Press ESC to cancel'}</Text>
					</Box>
				</Box>
			)}

			{step === 'selectRole' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{rs.selectRoleLabel || 'Select role file to delete:'}
						</Text>
					</Box>

					{roleItems.length === 0 ? (
						<Box marginBottom={1}>
							<Text color={theme.colors.warning}>
								{rs.noRoleFiles ||
									'No sub-agent role files found at this location.'}
							</Text>
						</Box>
					) : (
						<Box flexDirection="column" marginBottom={1}>
							{roleItems.map((item, index) => (
								<Box key={item.agentName}>
									<Text
										color={
											index === selectedIndex
												? theme.colors.menuSelected
												: theme.colors.menuNormal
										}
										bold={index === selectedIndex}
									>
										{index === selectedIndex ? '> ' : '  '}
										{item.filename} ({item.agentName})
									</Text>
								</Box>
							))}
						</Box>
					)}

					<Box marginTop={1}>
						<Text dimColor>
							{rs.selectRoleHint ||
								'↑↓: Navigate | Enter: Select | ESC: Back'}
						</Text>
					</Box>
				</Box>
			)}

			{step === 'confirm' && selectedItem && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{rs.locationLabel || 'Location:'}{' '}
							<Text bold color={theme.colors.menuSelected}>
								{location === 'global'
									? rs.locationGlobal || 'Global'
									: rs.locationProject || 'Project'}
							</Text>
						</Text>
					</Box>

					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{rs.fileLabel || 'File:'}{' '}
							<Text bold color={theme.colors.warning}>
								{selectedItem.filename}
							</Text>
						</Text>
					</Box>

					<Box marginTop={1}>
						<Text color={theme.colors.text}>
							{rs.confirmQuestion || 'Confirm deletion?'}
						</Text>
					</Box>
					<Box marginTop={1} gap={2}>
						<Box>
							<Text color={theme.colors.success} bold>
								[Y]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{rs.confirmYes || 'Yes, Delete'}
							</Text>
						</Box>
						<Box>
							<Text color={theme.colors.error} bold>
								[N]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{rs.confirmNo || 'No, Cancel'}
							</Text>
						</Box>
					</Box>
				</Box>
			)}
		</Box>
	);
};
