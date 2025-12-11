import React, {useState, useCallback, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import {
	getSubAgents,
	deleteSubAgent,
	type SubAgent,
} from '../../utils/config/subAgentConfig.js';
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useI18n} from '../../i18n/index.js';

type Props = {
	onBack: () => void;
	onAdd: () => void;
	onEdit: (agentId: string) => void;
	inlineMode?: boolean;
	defaultSelectedIndex?: number;
	onSelectionPersist?: (index: number) => void;
};

export default function SubAgentListScreen({
	onBack,
	onAdd,
	onEdit,
	inlineMode = false,
	defaultSelectedIndex = 0,
	onSelectionPersist,
}: Props) {
	const {theme} = useTheme();
	const {columns} = useTerminalSize();
	const {t} = useI18n();
	const [agents, setAgents] = useState<SubAgent[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(defaultSelectedIndex);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deleteSuccess, setDeleteSuccess] = useState(false);
	const [deleteFailed, setDeleteFailed] = useState(false);

	// Sync with parent's defaultSelectedIndex when it changes
	useEffect(() => {
		setSelectedIndex(defaultSelectedIndex);
	}, [defaultSelectedIndex]);

	// Truncate text based on terminal width
	const truncateText = useCallback(
		(text: string, prefixLength: number = 0): string => {
			if (!text) return text;
			// Reserve space for indentation (3), prefix text, padding (5), and ellipsis (3)
			const maxLength = Math.max(20, columns - prefixLength - 3 - 5 - 3);
			if (text.length <= maxLength) return text;
			return text.substring(0, maxLength) + '...';
		},
		[columns],
	);

	// Load agents on mount
	useEffect(() => {
		loadAgents();
	}, []);

	const loadAgents = useCallback(() => {
		const loadedAgents = getSubAgents();
		setAgents(loadedAgents);
		if (selectedIndex >= loadedAgents.length && loadedAgents.length > 0) {
			setSelectedIndex(loadedAgents.length - 1);
		}
	}, [selectedIndex]);

	const handleDelete = useCallback(() => {
		if (agents.length === 0) return;

		const agent = agents[selectedIndex];
		if (!agent) return;

		const success = deleteSubAgent(agent.id);
		if (success) {
			setDeleteSuccess(true);
			setTimeout(() => setDeleteSuccess(false), 2000);
			loadAgents();
		} else {
			setDeleteFailed(true);
			setTimeout(() => setDeleteFailed(false), 2000);
		}
		setShowDeleteConfirm(false);
	}, [agents, selectedIndex, loadAgents]);

	useInput((input, key) => {
		if (key.escape) {
			if (showDeleteConfirm) {
				setShowDeleteConfirm(false);
			} else {
				onBack();
			}
			return;
		}

		if (showDeleteConfirm) {
			if (input === 'y' || input === 'Y') {
				handleDelete();
			} else if (input === 'n' || input === 'N') {
				setShowDeleteConfirm(false);
			}
			return;
		}

		if (key.upArrow) {
			const newIndex = selectedIndex > 0 ? selectedIndex - 1 : agents.length - 1;
			setSelectedIndex(newIndex);
			onSelectionPersist?.(newIndex);
		} else if (key.downArrow) {
			const newIndex = selectedIndex < agents.length - 1 ? selectedIndex + 1 : 0;
			setSelectedIndex(newIndex);
			onSelectionPersist?.(newIndex);
		} else if (key.return) {
			if (agents.length > 0) {
				const agent = agents[selectedIndex];
				if (agent) {
					onSelectionPersist?.(selectedIndex);
					onEdit(agent.id);
				}
			}
		} else if (input === 'a' || input === 'A') {
			onSelectionPersist?.(selectedIndex);
			onAdd();
		} else if (input === 'd' || input === 'D') {
			if (agents.length > 0) {
				const agent = agents[selectedIndex];
				if (agent?.builtin) {
					// 系统内置子代理直接显示错误提示
					setDeleteFailed(true);
					setTimeout(() => setDeleteFailed(false), 2000);
				} else {
					setShowDeleteConfirm(true);
				}
			}
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box marginBottom={1}>
					<Text bold color={theme.colors.menuInfo}>
						❆ {t.subAgentList.title}
					</Text>
				</Box>
			)}

			{deleteSuccess && (
				<Box marginBottom={1}>
					<Alert variant="success">{t.subAgentList.deleteSuccess}</Alert>
				</Box>
			)}

			{deleteFailed && (
				<Box marginBottom={1}>
					<Alert variant="error">{t.subAgentList.deleteFailed}</Alert>
				</Box>
			)}

			{showDeleteConfirm && agents[selectedIndex] && (
				<Box marginBottom={1}>
					<Alert variant="warning">
						{t.subAgentList.deleteConfirm.replace(
							'{name}',
							agents[selectedIndex].name,
						)}
					</Alert>
				</Box>
			)}

			<Box flexDirection="column">
				{agents.length === 0 ? (
					<Box flexDirection="column">
						<Text color={theme.colors.menuSecondary}>
							{t.subAgentList.noAgents}
						</Text>
						<Text color={theme.colors.menuSecondary}>
							{t.subAgentList.noAgentsHint}
						</Text>
					</Box>
				) : (
					<Box flexDirection="column">
						<Text bold color={theme.colors.menuInfo}>
							{t.subAgentList.agentsCount.replace(
								'{count}',
								agents.length.toString(),
							)}
						</Text>

						{agents.map((agent, index) => {
							const isSelected = index === selectedIndex;
							return (
								<Box key={agent.id} flexDirection="column">
									<Box>
										<Text
											color={
												isSelected
													? theme.colors.menuSelected
													: theme.colors.menuNormal
											}
											bold={isSelected}
										>
											{isSelected ? '❯ ' : '  '}
											{agent.name}
										</Text>
									</Box>
									{isSelected && (
										<Box flexDirection="column" marginLeft={3}>
											<Text color={theme.colors.menuSecondary}>
												{t.subAgentList.description}{' '}
												{truncateText(
													agent.description || t.subAgentList.noDescription,
													t.subAgentList.description.length,
												)}
											</Text>
											<Text color={theme.colors.menuSecondary}>
												{t.subAgentList.toolsCount.replace(
													'{count}',
													(agent.tools?.length || 0).toString(),
												)}
											</Text>
											<Text color={theme.colors.menuSecondary} dimColor>
												{t.subAgentList.updated}{' '}
												{agent.updatedAt
													? new Date(agent.updatedAt).toLocaleString()
													: 'N/A'}
											</Text>
										</Box>
									)}
								</Box>
							);
						})}
					</Box>
				)}

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.subAgentList.navigationHint}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
