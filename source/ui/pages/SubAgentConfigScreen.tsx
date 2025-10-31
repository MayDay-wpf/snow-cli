import React, {useState, useCallback, useMemo, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {Alert, Spinner} from '@inkjs/ui';
import {getMCPServicesInfo} from '../../utils/mcpToolsManager.js';
import type {MCPServiceTools} from '../../utils/mcpToolsManager.js';
import {
	createSubAgent,
	updateSubAgent,
	getSubAgent,
	validateSubAgent,
} from '../../utils/subAgentConfig.js';

// Focus event handling - prevent terminal focus events from appearing as input
const focusEventTokenRegex = /(?:\x1b)?\[[0-9;]*[IO]/g;

const isFocusEventInput = (value?: string) => {
	if (!value) {
		return false;
	}

	if (
		value === '\x1b[I' ||
		value === '\x1b[O' ||
		value === '[I' ||
		value === '[O'
	) {
		return true;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return false;
	}

	const tokens = trimmed.match(focusEventTokenRegex);
	if (!tokens) {
		return false;
	}

	const normalized = trimmed.replace(/\s+/g, '');
	const tokensCombined = tokens.join('');
	return tokensCombined === normalized;
};

const stripFocusArtifacts = (value: string) => {
	if (!value) {
		return '';
	}

	return value
		.replace(/\x1b\[[0-9;]*[IO]/g, '')
		.replace(/\[[0-9;]*[IO]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

type Props = {
	onBack: () => void;
	onSave: () => void;
	inlineMode?: boolean;
	agentId?: string; // If provided, edit mode; otherwise, create mode
};

type ToolCategory = {
	name: string;
	tools: string[];
};

const toolCategories: ToolCategory[] = [
	{
		name: 'Filesystem Tools',
		tools: [
			'filesystem-read',
			'filesystem-create',
			'filesystem-edit',
			'filesystem-edit_search',
			'filesystem-delete',
			'filesystem-list',
		],
	},
	{
		name: 'ACE Code Search Tools',
		tools: [
			'ace-search_symbols',
			'ace-find_definition',
			'ace-find_references',
			'ace-semantic_search',
			'ace-text_search',
			'ace-file_outline',
			'ace-index_stats',
			'ace-clear_cache',
		],
	},
	{
		name: 'Terminal Tools',
		tools: ['terminal-execute'],
	},
	{
		name: 'TODO Management Tools',
		tools: [
			'todo-create',
			'todo-get',
			'todo-update',
			'todo-add',
			'todo-delete',
		],
	},
	{
		name: 'Web Search Tools',
		tools: ['websearch-search', 'websearch-fetch'],
	},
	{
		name: 'IDE Diagnostics Tools',
		tools: ['ide-get_diagnostics'],
	},
];

type FormField = 'name' | 'description' | 'tools';

export default function SubAgentConfigScreen({
	onBack,
	onSave,
	inlineMode = false,
	agentId,
}: Props) {
	const [agentName, setAgentName] = useState('');
	const [description, setDescription] = useState('');
	const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
	const [currentField, setCurrentField] = useState<FormField>('name');
	const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0);
	const [selectedToolIndex, setSelectedToolIndex] = useState(0);
	const [showSuccess, setShowSuccess] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);
	const [isLoadingMCP, setIsLoadingMCP] = useState(true);
	const [mcpServices, setMcpServices] = useState<MCPServiceTools[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const isEditMode = !!agentId;

	// Load existing agent data in edit mode
	useEffect(() => {
		if (agentId) {
			const agent = getSubAgent(agentId);
			if (agent) {
				setAgentName(agent.name);
				setDescription(agent.description);
				setSelectedTools(new Set(agent.tools));
			}
		}
	}, [agentId]);

	// Load MCP services on mount
	useEffect(() => {
		const loadMCPServices = async () => {
			try {
				setIsLoadingMCP(true);
				setLoadError(null);
				const services = await getMCPServicesInfo();
				setMcpServices(services);
			} catch (error) {
				setLoadError(
					error instanceof Error
						? error.message
						: 'Failed to load MCP services',
				);
			} finally {
				setIsLoadingMCP(false);
			}
		};

		loadMCPServices();
	}, []);

	// Combine built-in and MCP tool categories
	const allToolCategories = useMemo(() => {
		const categories = [...toolCategories];

		// Add custom MCP services as separate categories
		for (const service of mcpServices) {
			if (!service.isBuiltIn && service.connected && service.tools.length > 0) {
				categories.push({
					name: `${service.serviceName} (MCP)`,
					tools: service.tools.map(t => t.name),
				});
			}
		}

		return categories;
	}, [mcpServices]);

	// Get all available tools
	const allTools = useMemo(
		() => allToolCategories.flatMap(cat => cat.tools),
		[allToolCategories],
	);

	const handleToggleTool = useCallback((tool: string) => {
		setSelectedTools(prev => {
			const newSet = new Set(prev);
			if (newSet.has(tool)) {
				newSet.delete(tool);
			} else {
				newSet.add(tool);
			}
			return newSet;
		});
	}, []);

	const handleToggleCategory = useCallback(() => {
		const category = allToolCategories[selectedCategoryIndex];
		if (!category) return;

		const allSelected = category.tools.every(tool => selectedTools.has(tool));

		setSelectedTools(prev => {
			const newSet = new Set(prev);
			if (allSelected) {
				// Deselect all in category
				category.tools.forEach(tool => newSet.delete(tool));
			} else {
				// Select all in category
				category.tools.forEach(tool => newSet.add(tool));
			}
			return newSet;
		});
	}, [selectedCategoryIndex, selectedTools, allToolCategories]);

	const handleToggleCurrentTool = useCallback(() => {
		const category = allToolCategories[selectedCategoryIndex];
		if (!category) return;

		const tool = category.tools[selectedToolIndex];
		if (tool) {
			handleToggleTool(tool);
		}
	}, [
		selectedCategoryIndex,
		selectedToolIndex,
		handleToggleTool,
		allToolCategories,
	]);

	const handleSave = useCallback(() => {
		setSaveError(null);

		// Validate
		const errors = validateSubAgent({
			name: agentName,
			description: description,
			tools: Array.from(selectedTools),
		});
		if (errors.length > 0) {
			setSaveError(errors[0] || 'Validation failed');
			return;
		}

		try {
			if (isEditMode && agentId) {
				// Update existing agent
				updateSubAgent(agentId, {
					name: agentName,
					description: description,
					tools: Array.from(selectedTools),
				});
			} else {
				// Create new agent
				createSubAgent(agentName, description, Array.from(selectedTools));
			}

			setShowSuccess(true);
			setTimeout(() => {
				setShowSuccess(false);
				onSave();
			}, 1500);
		} catch (error) {
			setSaveError(
				error instanceof Error ? error.message : 'Failed to save sub-agent',
			);
		}
	}, [agentName, description, selectedTools, onSave, isEditMode, agentId]);

	useInput((rawInput, key) => {
		const input = stripFocusArtifacts(rawInput);

		// Ignore focus events completely
		if (!input && isFocusEventInput(rawInput)) {
			return;
		}

		if (isFocusEventInput(rawInput)) {
			return;
		}

		if (key.escape) {
			onBack();
			return;
		}

		// Global navigation with up/down arrows
		if (key.upArrow) {
			if (currentField === 'name') {
				// At top, do nothing or cycle to bottom
				return;
			} else if (currentField === 'description') {
				setCurrentField('name');
				return;
			} else if (currentField === 'tools') {
				// Navigate within tools
				if (selectedToolIndex > 0) {
					setSelectedToolIndex(prev => prev - 1);
				} else if (selectedCategoryIndex > 0) {
					const prevCategory = allToolCategories[selectedCategoryIndex - 1];
					setSelectedCategoryIndex(prev => prev - 1);
					setSelectedToolIndex(
						prevCategory ? prevCategory.tools.length - 1 : 0,
					);
				} else {
					// At top of tools, go to description
					setCurrentField('description');
				}
				return;
			}
		}

		if (key.downArrow) {
			if (currentField === 'name') {
				setCurrentField('description');
				return;
			} else if (currentField === 'description') {
				setCurrentField('tools');
				setSelectedCategoryIndex(0);
				setSelectedToolIndex(0);
				return;
			} else if (currentField === 'tools') {
				// Navigate within tools
				const currentCategory = allToolCategories[selectedCategoryIndex];
				if (!currentCategory) return;

				if (selectedToolIndex < currentCategory.tools.length - 1) {
					setSelectedToolIndex(prev => prev + 1);
				} else if (selectedCategoryIndex < allToolCategories.length - 1) {
					setSelectedCategoryIndex(prev => prev + 1);
					setSelectedToolIndex(0);
				}
				// At bottom of tools, stay there
				return;
			}
		}

		// Tool-specific controls
		if (currentField === 'tools') {
			if (key.leftArrow) {
				// Navigate to previous category
				if (selectedCategoryIndex > 0) {
					setSelectedCategoryIndex(prev => prev - 1);
					setSelectedToolIndex(0);
				}
				return;
			}
			if (key.rightArrow) {
				// Navigate to next category
				if (selectedCategoryIndex < allToolCategories.length - 1) {
					setSelectedCategoryIndex(prev => prev + 1);
					setSelectedToolIndex(0);
				}
				return;
			}
			if (input === ' ') {
				// Toggle current tool
				handleToggleCurrentTool();
				return;
			}
			if (input === 'a' || input === 'A') {
				// Toggle all in category
				handleToggleCategory();
				return;
			}
		}

		// Save with Enter key
		if (key.return) {
			handleSave();
			return;
		}
	});

	const renderToolSelection = () => {
		return (
			<Box flexDirection="column">
				<Text bold color="cyan">
					Tool Selection:
				</Text>

				{isLoadingMCP && (
					<Box>
						<Spinner label="Loading MCP services..." />
					</Box>
				)}

				{loadError && (
					<Box>
						<Text color="yellow">⚠ {loadError}</Text>
					</Box>
				)}

				{allToolCategories.map((category, catIndex) => {
					const isCurrent = catIndex === selectedCategoryIndex;
					const selectedInCategory = category.tools.filter(tool =>
						selectedTools.has(tool),
					).length;

					return (
						<Box key={category.name} flexDirection="column">
							<Box>
								<Text
									color={
										isCurrent && currentField === 'tools' ? 'green' : 'white'
									}
									bold={isCurrent && currentField === 'tools'}
								>
									{isCurrent && currentField === 'tools' ? '▶ ' : '  '}
									{category.name} ({selectedInCategory}/{category.tools.length})
								</Text>
							</Box>

							{isCurrent && currentField === 'tools' && (
								<Box flexDirection="column" marginLeft={2}>
									{category.tools.map((tool, toolIndex) => {
										const isCurrentTool = toolIndex === selectedToolIndex;
										return (
											<Box key={tool}>
												<Text
													color={isCurrentTool ? 'cyan' : 'white'}
													bold={isCurrentTool}
												>
													{isCurrentTool ? '❯ ' : '  '}
													{selectedTools.has(tool) ? '[✓]' : '[ ]'} {tool}
												</Text>
											</Box>
										);
									})}
								</Box>
							)}
						</Box>
					);
				})}

				<Text color="gray" dimColor>
					Selected: {selectedTools.size} / {allTools.length} tools
				</Text>
			</Box>
		);
	};

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box marginBottom={1}>
					<Text bold color="cyan">
						❆ {isEditMode ? 'Edit' : 'New'} Sub-Agent
					</Text>
				</Box>
			)}

			{showSuccess && (
				<Box marginBottom={1}>
					<Alert variant="success">
						Sub-agent {isEditMode ? 'updated' : 'created'} successfully!
					</Alert>
				</Box>
			)}

			{saveError && (
				<Box marginBottom={1}>
					<Alert variant="error">{saveError}</Alert>
				</Box>
			)}

			<Box flexDirection="column">
				{/* Agent Name */}
				<Box flexDirection="column">
					<Text bold color={currentField === 'name' ? 'green' : 'white'}>
						Agent Name:
					</Text>
					<Box marginLeft={2}>
						<TextInput
							value={agentName}
							onChange={value => setAgentName(stripFocusArtifacts(value))}
							placeholder="Enter agent name..."
							focus={currentField === 'name'}
						/>
					</Box>
				</Box>

				{/* Description */}
				<Box flexDirection="column">
					<Text bold color={currentField === 'description' ? 'green' : 'white'}>
						Description:
					</Text>
					<Box marginLeft={2}>
						<TextInput
							value={description}
							onChange={value => setDescription(stripFocusArtifacts(value))}
							placeholder="Enter agent description..."
							focus={currentField === 'description'}
						/>
					</Box>
				</Box>

				{/* Tool Selection */}
				{renderToolSelection()}

				{/* Instructions */}
				<Box marginTop={1}>
					<Text color="gray" dimColor>
						↑↓: Navigate | ←→: Switch category | Space: Toggle | A: Toggle all |
						Enter: Save | Esc: Back
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
