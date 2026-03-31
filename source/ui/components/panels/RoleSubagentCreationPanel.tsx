import React, {useState, useCallback, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	getAvailableSubAgents,
	checkRoleSubagentExists,
	type RoleSubagentLocation,
} from '../../../utils/commands/roleSubagent.js';

type Step = 'location' | 'selectAgent' | 'confirm';

interface Props {
	onSave: (agentName: string, location: RoleSubagentLocation) => Promise<void>;
	onCancel: () => void;
	projectRoot?: string;
}

export const RoleSubagentCreationPanel: React.FC<Props> = ({
	onSave,
	onCancel,
	projectRoot,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<Step>('location');
	const [location, setLocation] = useState<RoleSubagentLocation>('global');
	const [selectedIndex, setSelectedIndex] = useState(0);

	const allAgents = useMemo(() => getAvailableSubAgents(), []);

	const availableAgents = useMemo(() => {
		return allAgents.filter(
			a => !checkRoleSubagentExists(a.name, location, projectRoot),
		);
	}, [allAgents, location, projectRoot]);

	const selectedAgent = availableAgents[selectedIndex];

	const handleCancel = useCallback(() => {
		onCancel();
	}, [onCancel]);

	const handleConfirm = useCallback(async () => {
		if (!selectedAgent) return;
		await onSave(selectedAgent.name, location);
	}, [selectedAgent, location, onSave]);

	const keyHandlingActive =
		step === 'location' || step === 'selectAgent' || step === 'confirm';

	useInput(
		(input, key) => {
			if (key.escape) {
				if (step === 'confirm') {
					setStep('selectAgent');
				} else if (step === 'selectAgent') {
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
					setStep('selectAgent');
				} else if (input.toLowerCase() === 'p') {
					setLocation('project');
					setSelectedIndex(0);
					setStep('selectAgent');
				}
				return;
			}

			if (step === 'selectAgent') {
				if (key.upArrow) {
					setSelectedIndex(prev => Math.max(0, prev - 1));
					return;
				}
				if (key.downArrow) {
					setSelectedIndex(prev =>
						Math.min(availableAgents.length - 1, prev + 1),
					);
					return;
				}
				if (key.return && selectedAgent) {
					setStep('confirm');
					return;
				}
				return;
			}

			if (step === 'confirm') {
				if (input.toLowerCase() === 'y') {
					handleConfirm();
				} else if (input.toLowerCase() === 'n') {
					setStep('selectAgent');
				}
			}
		},
		{isActive: keyHandlingActive},
	);

	const rs = (t as any).roleSubagentCreation || {};

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{rs.title || 'Create Sub-Agent Role'}
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
								{rs.locationGlobalInfo || 'Available across all projects'}
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
								{rs.locationProjectInfo || 'Only available in this project'}
							</Text>
						</Box>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{rs.escCancel || 'Press ESC to cancel'}</Text>
					</Box>
				</Box>
			)}

			{step === 'selectAgent' && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={theme.colors.text}>
							{rs.selectAgentLabel || 'Select Sub-Agent:'}
						</Text>
					</Box>

					{availableAgents.length === 0 ? (
						<Box marginBottom={1}>
							<Text color={theme.colors.warning}>
								{rs.noAvailableAgents ||
									'All sub-agents already have role files at this location.'}
							</Text>
						</Box>
					) : (
						<Box flexDirection="column" marginBottom={1}>
							{availableAgents.map((agent, index) => (
								<Box key={agent.id}>
									<Text
										color={
											index === selectedIndex
												? theme.colors.menuSelected
												: theme.colors.menuNormal
										}
										bold={index === selectedIndex}
									>
										{index === selectedIndex ? '> ' : '  '}
										{agent.name}
									</Text>
								</Box>
							))}
						</Box>
					)}

					<Box marginTop={1}>
						<Text dimColor>
							{rs.selectAgentHint ||
								'↑↓: Navigate | Enter: Select | ESC: Back'}
						</Text>
					</Box>
				</Box>
			)}

			{step === 'confirm' && selectedAgent && (
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
							{rs.agentLabel || 'Sub-Agent:'}{' '}
							<Text bold color={theme.colors.menuSelected}>
								{selectedAgent.name}
							</Text>
						</Text>
					</Box>

					<Box marginBottom={1}>
						<Text dimColor>
							{rs.fileLabel || 'File:'} ROLE-{selectedAgent.name}.md
						</Text>
					</Box>

					<Box marginTop={1}>
						<Text color={theme.colors.text}>
							{rs.confirmQuestion || 'Create this role file?'}
						</Text>
					</Box>
					<Box marginTop={1} gap={2}>
						<Box>
							<Text color={theme.colors.success} bold>
								[Y]
							</Text>
							<Text color={theme.colors.text}>
								{' '}
								{rs.confirmYes || 'Yes, Create'}
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
