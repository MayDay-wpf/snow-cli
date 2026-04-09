import React, {useState, useCallback, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	listRoleSubagents,
	deleteRoleSubagentFile,
	type RoleSubagentLocation,
	type RoleSubagentItem,
} from '../../../utils/commands/roleSubagent.js';

type Tab = 'global' | 'project';

interface Props {
	onClose: () => void;
	projectRoot?: string;
}

export const RoleSubagentListPanel: React.FC<Props> = ({
	onClose,
	projectRoot,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [activeTab, setActiveTab] = useState<Tab>('global');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [globalRoles, setGlobalRoles] = useState<RoleSubagentItem[]>([]);
	const [projectRoles, setProjectRoles] = useState<RoleSubagentItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [message, setMessage] = useState<{
		type: 'success' | 'error';
		text: string;
	} | null>(null);
	const [pendingDeleteName, setPendingDeleteName] = useState<string | null>(
		null,
	);

	const loadRoles = useCallback(() => {
		setGlobalRoles(listRoleSubagents('global'));
		setProjectRoles(listRoleSubagents('project', projectRoot));
	}, [projectRoot]);

	useEffect(() => {
		loadRoles();
	}, [loadRoles]);

	const currentRoles = activeTab === 'global' ? globalRoles : projectRoles;
	const currentLocation: RoleSubagentLocation = activeTab;

	const handleDelete = useCallback(
		async (agentName: string) => {
			setIsLoading(true);
			setMessage(null);
			const result = await deleteRoleSubagentFile(
				agentName,
				currentLocation,
				projectRoot,
			);
			setIsLoading(false);
			setPendingDeleteName(null);

			if (result.success) {
				setMessage({
					type: 'success',
					text:
						(rs.deleteSuccess || 'Role file deleted successfully') +
						` (${agentName})`,
				});
				loadRoles();
				if (selectedIndex >= currentRoles.length - 1) {
					setSelectedIndex(Math.max(0, currentRoles.length - 2));
				}
			} else {
				setMessage({
					type: 'error',
					text: result.error || 'Failed to delete role file',
				});
			}
		},
		[currentLocation, projectRoot, loadRoles, selectedIndex, currentRoles],
	);

	const rs = (t as any).roleSubagentList || {};

	useInput((input, key) => {
		if (isLoading) return;

		if (pendingDeleteName) {
			if (input.toLowerCase() === 'y') {
				handleDelete(pendingDeleteName);
				return;
			}
			if (input.toLowerCase() === 'n' || key.escape) {
				setPendingDeleteName(null);
				setMessage(null);
				return;
			}
			return;
		}

		if (key.escape) {
			onClose();
			return;
		}

		if (key.tab || input === '\t') {
			setActiveTab(prev => (prev === 'global' ? 'project' : 'global'));
			setSelectedIndex(0);
			setMessage(null);
			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev => Math.max(0, prev - 1));
			return;
		}
		if (key.downArrow) {
			setSelectedIndex(prev => Math.min(currentRoles.length - 1, prev + 1));
			return;
		}

		if (input.toLowerCase() === 'd') {
			const role = currentRoles[selectedIndex];
			if (!role) return;
			setPendingDeleteName(role.agentName);
			setMessage(null);
			return;
		}
	});

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{rs.title || 'Sub-Agent Role Management'}
				</Text>
			</Box>

			{/* Tabs */}
			<Box marginBottom={1} gap={2}>
				<Box>
					<Text
						color={
							activeTab === 'global'
								? theme.colors.menuSelected
								: theme.colors.menuNormal
						}
						bold={activeTab === 'global'}
					>
						[{activeTab === 'global' ? '✓' : ' '}]{' '}
						{rs.tabGlobal || 'Global'}
					</Text>
				</Box>
				<Box>
					<Text
						color={
							activeTab === 'project'
								? theme.colors.menuSelected
								: theme.colors.menuNormal
						}
						bold={activeTab === 'project'}
					>
						[{activeTab === 'project' ? '✓' : ' '}]{' '}
						{rs.tabProject || 'Project'}
					</Text>
				</Box>
			</Box>

			{/* Role List */}
			<Box flexDirection="column" marginBottom={1}>
				{currentRoles.length === 0 ? (
					<Box>
						<Text dimColor>
							{rs.noRoles ||
								'No sub-agent role files found. Use /role-subagent to create one.'}
						</Text>
					</Box>
				) : (
					currentRoles.map((role, index) => (
						<Box key={role.agentName}>
							<Text
								color={
									index === selectedIndex
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={index === selectedIndex}
							>
								{index === selectedIndex ? '> ' : '  '}
								{role.filename}
								<Text dimColor> ({role.agentName})</Text>
							</Text>
						</Box>
					))
				)}
			</Box>

			{/* Confirm delete */}
			{pendingDeleteName && (
				<Box marginBottom={1} flexDirection="column">
					<Text color={theme.colors.warning}>
						{(rs.confirmDelete || 'Confirm delete role for "{name}"?').replace(
							'{name}',
							pendingDeleteName,
						)}
					</Text>
					<Text dimColor>
						{rs.confirmDeleteHint || 'Press Y to confirm, N to cancel'}
					</Text>
				</Box>
			)}

			{/* Message */}
			{message && (
				<Box marginBottom={1}>
					<Text
						color={
							message.type === 'success'
								? theme.colors.success
								: theme.colors.error
						}
					>
						{message.text}
					</Text>
				</Box>
			)}

			{/* Loading */}
			{isLoading && (
				<Box marginBottom={1}>
					<Text color={theme.colors.warning}>
						{rs.loading || 'Processing...'}
					</Text>
				</Box>
			)}

			{/* Hints */}
			<Box flexDirection="column">
				<Text dimColor>
					{pendingDeleteName
						? rs.confirmDeleteHint || 'Press Y to confirm, N to cancel'
						: rs.hints ||
							'Tab: Switch scope | D: Delete | ESC: Close'}
				</Text>
			</Box>
		</Box>
	);
};
