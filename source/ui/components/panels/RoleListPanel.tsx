import React, {useState, useCallback, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	listRoles,
	switchActiveRole,
	createInactiveRole,
	deleteRole,
	type RoleLocation,
	type RoleItem,
} from '../../../utils/commands/role.js';

type Tab = 'global' | 'project';

interface Props {
	onClose: () => void;
	projectRoot?: string;
}

export const RoleListPanel: React.FC<Props> = ({onClose, projectRoot}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [activeTab, setActiveTab] = useState<Tab>('global');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [globalRoles, setGlobalRoles] = useState<RoleItem[]>([]);
	const [projectRoles, setProjectRoles] = useState<RoleItem[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [message, setMessage] = useState<{
		type: 'success' | 'error';
		text: string;
	} | null>(null);
	const [pendingDeleteRoleId, setPendingDeleteRoleId] = useState<string | null>(
		null,
	);

	// Load roles
	const loadRoles = useCallback(() => {
		setGlobalRoles(listRoles('global'));
		setProjectRoles(listRoles('project', projectRoot));
	}, [projectRoot]);

	useEffect(() => {
		loadRoles();
	}, [loadRoles]);

	// Get current roles based on active tab
	const currentRoles = activeTab === 'global' ? globalRoles : projectRoles;
	const currentLocation: RoleLocation = activeTab;

	// Handle role switch
	const handleSwitch = useCallback(async () => {
		const role = currentRoles[selectedIndex];
		if (!role || role.isActive) return;

		setIsLoading(true);
		setMessage(null);
		const result = await switchActiveRole(
			role.id,
			currentLocation,
			projectRoot,
		);
		setIsLoading(false);

		if (result.success) {
			setMessage({
				type: 'success',
				text:
					(t.roleList?.switchSuccess || 'Role switched successfully') +
					` (${role.filename})`,
			});
			loadRoles();
		} else {
			setMessage({
				type: 'error',
				text: result.error || 'Failed to switch role',
			});
		}
	}, [currentRoles, selectedIndex, currentLocation, projectRoot, loadRoles, t]);

	// Handle create new role
	const handleCreate = useCallback(async () => {
		setIsLoading(true);
		setMessage(null);
		const result = await createInactiveRole(currentLocation, projectRoot);
		setIsLoading(false);

		if (result.success) {
			setMessage({
				type: 'success',
				text: t.roleList?.createSuccess || 'Role created successfully',
			});
			loadRoles();
		} else {
			setMessage({
				type: 'error',
				text: result.error || 'Failed to create role',
			});
		}
	}, [currentLocation, projectRoot, loadRoles, t]);

	// Handle delete role
	const handleDelete = useCallback(
		async (roleId: string) => {
			const role = currentRoles.find(r => r.id === roleId);
			if (!role || role.isActive) return;

			setIsLoading(true);
			setMessage(null);
			const result = await deleteRole(role.id, currentLocation, projectRoot);
			setIsLoading(false);
			setPendingDeleteRoleId(null);

			if (result.success) {
				setMessage({
					type: 'success',
					text: t.roleList?.deleteSuccess || 'Role deleted successfully',
				});
				loadRoles();
				// Adjust selected index if needed
				if (selectedIndex >= currentRoles.length - 1) {
					setSelectedIndex(Math.max(0, currentRoles.length - 2));
				}
			} else {
				setMessage({
					type: 'error',
					text: result.error || 'Failed to delete role',
				});
			}
		},
		[currentRoles, currentLocation, projectRoot, loadRoles, selectedIndex, t],
	);

	useInput((input, key) => {
		if (isLoading) return;

		// Confirm delete flow
		if (pendingDeleteRoleId) {
			if (input.toLowerCase() === 'y') {
				handleDelete(pendingDeleteRoleId);
				return;
			}
			if (input.toLowerCase() === 'n' || key.escape) {
				setPendingDeleteRoleId(null);
				setMessage(null);
				return;
			}
			return;
		}

		if (key.escape) {
			onClose();
			return;
		}

		// Tab switching
		if (key.tab || input === '\t') {
			setActiveTab(prev => (prev === 'global' ? 'project' : 'global'));
			setSelectedIndex(0);
			setMessage(null);
			return;
		}

		// Navigation
		if (key.upArrow) {
			setSelectedIndex(prev => Math.max(0, prev - 1));
			return;
		}
		if (key.downArrow) {
			setSelectedIndex(prev => Math.min(currentRoles.length - 1, prev + 1));
			return;
		}

		// Actions
		if (key.return) {
			handleSwitch();
			return;
		}
		if (input.toLowerCase() === 'n') {
			handleCreate();
			return;
		}
		if (input.toLowerCase() === 'd') {
			const role = currentRoles[selectedIndex];
			if (!role) return;
			if (role.isActive) {
				setMessage({
					type: 'error',
					text: t.roleList?.cannotDeleteActive || 'Cannot delete active role',
				});
				return;
			}
			setPendingDeleteRoleId(role.id);
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
			{/* Title */}
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{t.roleList?.title || 'ROLE Management'}
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
						{t.roleList?.tabGlobal || 'Global'}
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
						{t.roleList?.tabProject || 'Project'}
					</Text>
				</Box>
			</Box>

			{/* Role List */}
			<Box flexDirection="column" marginBottom={1}>
				{currentRoles.length === 0 ? (
					<Box>
						<Text dimColor>
							{t.roleList?.noRoles || 'No roles found. Press N to create one.'}
						</Text>
					</Box>
				) : (
					currentRoles.map((role, index) => (
						<Box key={role.id}>
							<Text
								color={
									index === selectedIndex
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={index === selectedIndex}
							>
								{index === selectedIndex ? '✓ ' : '  '}
								{role.isActive ? '[✓] ' : '[ ] '}
								{role.filename}
								{role.isActive ? ` (${t.roleList?.active || 'Active'})` : ''}
							</Text>
						</Box>
					))
				)}
			</Box>

			{/* Confirm delete */}
			{pendingDeleteRoleId && (
				<Box marginBottom={1} flexDirection="column">
					<Text color={theme.colors.warning}>
						{t.roleList?.confirmDelete || 'Confirm delete this role?'}
					</Text>
					<Text dimColor>
						{t.roleList?.confirmDeleteHint || 'Press Y to confirm, N to cancel'}
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
						{t.roleList?.loading || 'Processing...'}
					</Text>
				</Box>
			)}

			{/* Hints */}
			<Box flexDirection="column">
				<Text dimColor>
					{pendingDeleteRoleId
						? t.roleList?.confirmDeleteHint || 'Press Y to confirm, N to cancel'
						: t.roleList?.hints ||
						  'Tab: Switch scope | Enter: Activate | N: New | D: Delete | ESC: Close'}
				</Text>
			</Box>
		</Box>
	);
};
