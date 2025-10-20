import React, {useState, useCallback, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import {
	getSubAgents,
	deleteSubAgent,
	type SubAgent,
} from '../../utils/subAgentConfig.js';

type Props = {
	onBack: () => void;
	onAdd: () => void;
	onEdit: (agentId: string) => void;
	inlineMode?: boolean;
};

export default function SubAgentListScreen({
	onBack,
	onAdd,
	onEdit,
	inlineMode = false,
}: Props) {
	const [agents, setAgents] = useState<SubAgent[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
	const [deleteSuccess, setDeleteSuccess] = useState(false);

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
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : agents.length - 1));
		} else if (key.downArrow) {
			setSelectedIndex(prev => (prev < agents.length - 1 ? prev + 1 : 0));
		} else if (key.return) {
			if (agents.length > 0) {
				const agent = agents[selectedIndex];
				if (agent) {
					onEdit(agent.id);
				}
			}
		} else if (input === 'a' || input === 'A') {
			onAdd();
		} else if (input === 'd' || input === 'D') {
			if (agents.length > 0) {
				setShowDeleteConfirm(true);
			}
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box marginBottom={1}>
					<Text bold color="cyan">
						❆ Sub-Agent Management
					</Text>
				</Box>
			)}

			{deleteSuccess && (
				<Box marginBottom={1}>
					<Alert variant="success">Sub-agent deleted successfully!</Alert>
				</Box>
			)}

			{showDeleteConfirm && agents[selectedIndex] && (
				<Box marginBottom={1}>
					<Alert variant="warning">
						Delete "{agents[selectedIndex].name}"? (Y/N)
					</Alert>
				</Box>
			)}

			<Box flexDirection="column">
				{agents.length === 0 ? (
					<Box flexDirection="column">
						<Text color="gray">No sub-agents configured yet.</Text>
						<Text color="gray">Press 'A' to add a new sub-agent.</Text>
					</Box>
				) : (
					<Box flexDirection="column">
						<Text bold color="cyan">
							Sub-Agents ({agents.length}):
						</Text>

						{agents.map((agent, index) => {
							const isSelected = index === selectedIndex;
							return (
								<Box key={agent.id} flexDirection="column">
									<Box>
										<Text
											color={isSelected ? 'green' : 'white'}
											bold={isSelected}
										>
											{isSelected ? '❯ ' : '  '}
											{agent.name}
										</Text>
									</Box>
									{isSelected && (
										<Box flexDirection="column" marginLeft={2}>
											<Text color="gray">{agent.description || 'No description'}</Text>
											<Text color="gray">
												Tools: {agent.tools.length} selected
											</Text>
											<Text color="gray" dimColor>
												Updated: {new Date(agent.updatedAt).toLocaleString()}
											</Text>
										</Box>
									)}
								</Box>
							);
						})}
					</Box>
				)}

				<Box marginTop={1}>
					<Text color="gray" dimColor>
						↑↓: Navigate | Enter: Edit | A: Add New | D: Delete | Esc: Back
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
