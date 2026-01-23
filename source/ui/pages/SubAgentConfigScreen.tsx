import React, {useState, useCallback, useMemo, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {Alert, Spinner} from '@inkjs/ui';
import {getMCPServicesInfo} from '../../utils/execution/mcpToolsManager.js';
import type {MCPServiceTools} from '../../utils/execution/mcpToolsManager.js';
import {
	createSubAgent,
	updateSubAgent,
	getSubAgent,
	validateSubAgent,
} from '../../utils/config/subAgentConfig.js';
import {
	getAllProfiles,
	getActiveProfileName,
} from '../../utils/config/configManager.js';

import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';

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

type FormField = 'name' | 'description' | 'role' | 'configProfile' | 'tools';

export default function SubAgentConfigScreen({
	onBack,
	onSave,
	inlineMode = false,
	agentId,
}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [agentName, setAgentName] = useState('');
	const [description, setDescription] = useState('');
	const [role, setRole] = useState('');
	const [roleExpanded, setRoleExpanded] = useState(false);
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
	const [isBuiltinAgent, setIsBuiltinAgent] = useState(false);

	// 选择器状态（索引）- 用于键盘导航
	const [selectedConfigProfileIndex, setSelectedConfigProfileIndex] =
		useState(0);

	// 已确认选中的索引（用于显示勾选标记）
	const [confirmedConfigProfileIndex, setConfirmedConfigProfileIndex] =
		useState(-1);

	// Tool categories with translations
	const toolCategories: ToolCategory[] = [
		{
			name: t.subAgentConfig.filesystemTools,
			tools: [
				'filesystem-read',
				'filesystem-create',
				'filesystem-edit',
				'filesystem-edit_search',
			],
		},
		{
			name: t.subAgentConfig.aceTools,
			tools: [
				'ace-find_definition',
				'ace-find_references',
				'ace-semantic_search',
				'ace-text_search',
				'ace-file_outline',
			],
		},
		{
			name: t.subAgentConfig.codebaseTools,
			tools: ['codebase-search'],
		},
		{
			name: t.subAgentConfig.terminalTools,
			tools: ['terminal-execute'],
		},
		{
			name: t.subAgentConfig.todoTools,
			tools: ['todo-get', 'todo-update', 'todo-add', 'todo-delete'],
		},
		{
			name: t.subAgentConfig.webSearchTools,
			tools: ['websearch-search', 'websearch-fetch'],
		},
		{
			name: t.subAgentConfig.ideTools,
			tools: ['ide-get_diagnostics'],
		},
		{
			name: t.subAgentConfig.userInteractionTools || 'User Interaction',
			tools: ['askuser-ask_question'],
		},
		{
			name: t.subAgentConfig.skillTools || 'Skills',
			tools: ['skill-execute'],
		},
	];

	// 获取可用的配置文件列表
	const availableProfiles = useMemo(() => {
		const profiles = getAllProfiles();
		return profiles.map(p => p.name);
	}, []);

	// Initialize with current active configurations (non-edit mode)
	useEffect(() => {
		if (!agentId) {
			const activeProfile = getActiveProfileName();

			// 设置配置文件索引（同时设置光标和确认索引）
			if (activeProfile && availableProfiles.length > 0) {
				const profileIndex = availableProfiles.findIndex(
					p => p === activeProfile,
				);
				if (profileIndex >= 0) {
					setSelectedConfigProfileIndex(profileIndex);
					setConfirmedConfigProfileIndex(profileIndex);
				}
			}
		}
	}, [availableProfiles, agentId]);

	useEffect(() => {
		if (!agentId) {
			return;
		}

		const agent = getSubAgent(agentId);
		if (!agent) {
			return;
		}

		const isBuiltin = ['agent_explore', 'agent_plan', 'agent_general'].includes(
			agentId,
		);
		setIsBuiltinAgent(isBuiltin);

		setAgentName(agent.name);
		setDescription(agent.description);
		setRole(agent.role || '');
		setSelectedTools(new Set(agent.tools || []));

		// 加载配置文件索引
		if (agent.configProfile) {
			const profileIndex = availableProfiles.findIndex(
				p => p === agent.configProfile,
			);
			if (profileIndex >= 0) {
				setSelectedConfigProfileIndex(profileIndex);
				setConfirmedConfigProfileIndex(profileIndex);
			}
		} else if (agent.builtin) {
			// 第一次编辑内置代理（创建副本），使用全局配置作为默认值
			const activeProfile = getActiveProfileName();
			if (activeProfile && availableProfiles.length > 0) {
				const profileIndex = availableProfiles.findIndex(
					p => p === activeProfile,
				);
				if (profileIndex >= 0) {
					setSelectedConfigProfileIndex(profileIndex);
					setConfirmedConfigProfileIndex(profileIndex);
				}
			}
		}
		// 编辑已有副本时，如果副本没有设置配置，不自动使用全局配置
		// 保持 confirmedConfigProfileIndex 为 -1
	}, [agentId, availableProfiles]);

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
					name: `${service.serviceName} ${t.subAgentConfig.categoryMCP}`,
					tools: service.tools.map(
						tool => `${service.serviceName}-${tool.name}`,
					),
				});
			}
		}

		return categories;
	}, [mcpServices, toolCategories, t]);

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
			setSaveError(errors[0] || t.subAgentConfig.validationFailed);
			return;
		}

		try {
			// 使用 confirmedIndex，确保保存用户通过Space键确认的选择
			const selectedProfile =
				confirmedConfigProfileIndex >= 0
					? availableProfiles[confirmedConfigProfileIndex]
					: undefined;

			if (isEditMode && agentId) {
				// Update existing agent
				updateSubAgent(agentId, {
					name: agentName,
					description: description,
					role: role || undefined,
					tools: Array.from(selectedTools),
					configProfile: selectedProfile || undefined,
				});
			} else {
				// Create new agent
				createSubAgent(
					agentName,
					description,
					Array.from(selectedTools),
					role || undefined,
					selectedProfile || undefined,
				);
			}

			setShowSuccess(true);
			setTimeout(() => {
				setShowSuccess(false);
				onSave();
			}, 1500);
		} catch (error) {
			setSaveError(
				error instanceof Error ? error.message : t.subAgentConfig.saveError,
			);
		}
	}, [
		agentName,
		description,
		role,
		selectedTools,
		confirmedConfigProfileIndex,
		availableProfiles,

		isEditMode,
		agentId,
		t,
	]);

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
		// ========================================
		// 导航逻辑说明:
		// ↑↓键: 在主字段间导航 (name → description → role → configProfile → tools)

		//       在配置列表字段内导航，到达边界时跳到相邻主字段
		//       在 tools 字段内导航工具列表，到达边界时跳到相邻主字段
		// ←→键: 在所有主字段之间切换 (除了 tools 字段中用于切换工具分类)
		// Space: 切换选中状态
		// ========================================

		// 定义主字段顺序（用于导航）
		const mainFields: FormField[] = [
			'name',
			'description',
			'role',
			'configProfile',
			'tools',
		];
		const currentFieldIndex = mainFields.indexOf(currentField);

		if (key.upArrow) {
			// 配置列表字段：在列表内导航，到达顶部时跳到上一个主字段
			if (currentField === 'configProfile') {
				if (
					availableProfiles.length === 0 ||
					selectedConfigProfileIndex === 0
				) {
					// 跳到上一个主字段
					setCurrentField('role');
				} else {
					setSelectedConfigProfileIndex(prev => prev - 1);
				}
				return;
			} else if (currentField === 'tools') {
				if (selectedToolIndex > 0) {
					setSelectedToolIndex(prev => prev - 1);
				} else if (selectedCategoryIndex > 0) {
					const prevCategory = allToolCategories[selectedCategoryIndex - 1];
					setSelectedCategoryIndex(prev => prev - 1);
					setSelectedToolIndex(
						prevCategory ? prevCategory.tools.length - 1 : 0,
					);
				} else {
					// 在 tools 顶部时跳到上一个主字段
					setCurrentField('configProfile');
				}
				return;
			} else {
				const prevIndex =
					currentFieldIndex > 0 ? currentFieldIndex - 1 : mainFields.length - 1;
				setCurrentField(mainFields[prevIndex]!);
				return;
			}
		}

		if (key.downArrow) {
			// 配置列表字段：在列表内导航，到达底部时跳到下一个主字段
			if (currentField === 'configProfile') {
				if (
					availableProfiles.length === 0 ||
					selectedConfigProfileIndex >= availableProfiles.length - 1
				) {
					// 跳到下一个主字段
					setCurrentField('tools');
					setSelectedCategoryIndex(0);
					setSelectedToolIndex(0);
				} else {
					setSelectedConfigProfileIndex(prev => prev + 1);
				}
				return;
			}

			if (currentField === 'tools') {
				const currentCategory = allToolCategories[selectedCategoryIndex];
				if (!currentCategory) return;

				if (selectedToolIndex < currentCategory.tools.length - 1) {
					setSelectedToolIndex(prev => prev + 1);
				} else if (selectedCategoryIndex < allToolCategories.length - 1) {
					setSelectedCategoryIndex(prev => prev + 1);
					setSelectedToolIndex(0);
				} else {
					// 在 tools 底部时跳到第一个主字段（循环）
					setCurrentField('name');
				}
				return;
			}

			// 普通字段：跳到下一个主字段
			const nextIndex =
				currentFieldIndex < mainFields.length - 1 ? currentFieldIndex + 1 : 0;
			setCurrentField(mainFields[nextIndex]!);
			return;
		}

		// Role field controls - Space to toggle expansion
		if (currentField === 'role' && input === ' ') {
			setRoleExpanded(prev => !prev);
			return;
		}

		// Config field controls - Space to toggle selection
		if (currentField === 'configProfile') {
			if (input === ' ') {
				setConfirmedConfigProfileIndex(prev =>
					prev === selectedConfigProfileIndex ? -1 : selectedConfigProfileIndex,
				);
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

		// Global left/right arrow navigation between main fields (except tools field which uses it for categories)
		if (key.leftArrow && currentField !== 'tools') {
			// Navigate to previous main field
			const prevIndex =
				currentFieldIndex > 0 ? currentFieldIndex - 1 : mainFields.length - 1;
			setCurrentField(mainFields[prevIndex]!);
			return;
		}

		if (key.rightArrow && currentField !== 'tools') {
			// Navigate to next main field
			const nextIndex =
				currentFieldIndex < mainFields.length - 1 ? currentFieldIndex + 1 : 0;
			setCurrentField(mainFields[nextIndex]!);
			return;
		}

		// Save with Enter key
		if (key.return) {
			handleSave();
			return;
		}
	});

	// 滚动列表渲染辅助函数（支持字符串数组和对象数组）
	const renderScrollableList = <T extends string | {name: string}>(
		items: T[],
		selectedIndex: number,
		confirmedIndex: number, // 已确认选中的索引
		isActive: boolean,
		maxVisible = 5,
		keyPrefix: string,
	) => {
		const totalItems = items.length;

		// 如果没有可用项，显示提示信息
		if (totalItems === 0) {
			return (
				<Box flexDirection="column">
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.subAgentConfig.noItems}
					</Text>
				</Box>
			);
		}

		// 计算可见范围
		let startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
		let endIndex = Math.min(totalItems, startIndex + maxVisible);

		// 调整起始位置确保显示maxVisible个项目
		if (endIndex - startIndex < maxVisible) {
			startIndex = Math.max(0, endIndex - maxVisible);
		}

		const visibleItems = items.slice(startIndex, endIndex);
		const hasMore = totalItems > maxVisible;

		return (
			<Box flexDirection="column">
				{startIndex > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
						↑{' '}
						{t.subAgentConfig.moreAbove.replace('{count}', String(startIndex))}
					</Text>
				)}
				{visibleItems.map((item, relativeIndex) => {
					const actualIndex = startIndex + relativeIndex;
					const isHighlighted = actualIndex === selectedIndex;
					const isConfirmed = actualIndex === confirmedIndex;
					const displayText = typeof item === 'string' ? item : item.name;
					return (
						<Box key={`${keyPrefix}-${actualIndex}`} marginY={0}>
							<Text
								color={
									isActive && isHighlighted
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={isHighlighted}
							>
								{isActive && isHighlighted ? '❯ ' : '  '}
								{isConfirmed ? '[✓] ' : '[ ] '}
								{displayText}
							</Text>
						</Box>
					);
				})}
				{endIndex < totalItems && (
					<Text color={theme.colors.menuSecondary} dimColor>
						↓{' '}
						{t.subAgentConfig.moreBelow.replace(
							'{count}',
							String(totalItems - endIndex),
						)}
					</Text>
				)}
				{isActive && hasMore && totalItems > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
						{' '}
						{t.subAgentConfig.scrollToggleHint}
					</Text>
				)}
				{isActive && !hasMore && totalItems > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
						{' '}
						{t.subAgentConfig.spaceToggleHint}
					</Text>
				)}
			</Box>
		);
	};

	// 滚动工具列表渲染辅助函数
	const renderScrollableTools = (
		tools: string[],
		selectedIndex: number,
		maxVisible = 5,
	) => {
		const totalTools = tools.length;

		// 计算可见范围
		let startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
		let endIndex = Math.min(totalTools, startIndex + maxVisible);

		// 调整起始位置确保显示maxVisible个项目
		if (endIndex - startIndex < maxVisible) {
			startIndex = Math.max(0, endIndex - maxVisible);
		}

		const visibleTools = tools.slice(startIndex, endIndex);
		const hasMore = totalTools > maxVisible;

		return (
			<Box flexDirection="column" marginLeft={2}>
				{startIndex > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
						↑{' '}
						{t.subAgentConfig.moreTools.replace('{count}', String(startIndex))}
					</Text>
				)}
				{visibleTools.map((tool, relativeIndex) => {
					const actualIndex = startIndex + relativeIndex;
					const isCurrentTool = actualIndex === selectedIndex;
					return (
						<Box key={tool}>
							<Text
								color={
									isCurrentTool
										? theme.colors.menuInfo
										: theme.colors.menuNormal
								}
								bold={isCurrentTool}
							>
								{isCurrentTool ? '❯ ' : '  '}
								{selectedTools.has(tool) ? '[✓]' : '[ ]'} {tool}
							</Text>
						</Box>
					);
				})}
				{endIndex < totalTools && (
					<Text color={theme.colors.menuSecondary} dimColor>
						↓{' '}
						{t.subAgentConfig.moreTools.replace(
							'{count}',
							String(totalTools - endIndex),
						)}
					</Text>
				)}
				{hasMore && (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.subAgentConfig.scrollToolsHint}
					</Text>
				)}
			</Box>
		);
	};

	const renderToolSelection = () => {
		return (
			<Box flexDirection="column">
				<Text bold color={theme.colors.menuInfo}>
					{t.subAgentConfig.toolSelection}
				</Text>

				{isLoadingMCP && (
					<Box>
						<Spinner label={t.subAgentConfig.loadingMCP} />
					</Box>
				)}

				{loadError && (
					<Box>
						<Text color={theme.colors.warning}>
							{t.subAgentConfig.mcpLoadError} {loadError}
						</Text>
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
										isCurrent && currentField === 'tools'
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold={isCurrent && currentField === 'tools'}
								>
									{isCurrent && currentField === 'tools' ? '▶ ' : '  '}
									{category.name} ({selectedInCategory}/{category.tools.length})
								</Text>
							</Box>

							{isCurrent &&
								currentField === 'tools' &&
								renderScrollableTools(category.tools, selectedToolIndex, 5)}
						</Box>
					);
				})}

				<Text color={theme.colors.menuSecondary} dimColor>
					{t.subAgentConfig.selectedTools} {selectedTools.size} /{' '}
					{allTools.length} {t.subAgentConfig.toolsCount}
				</Text>
			</Box>
		);
	};

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box marginBottom={1}>
					<Text bold color={theme.colors.menuInfo}>
						❆{' '}
						{isEditMode
							? t.subAgentConfig.titleEdit
							: t.subAgentConfig.titleNew}{' '}
						{t.subAgentConfig.title}
					</Text>
				</Box>
			)}

			{showSuccess && (
				<Box marginBottom={1}>
					<Alert variant="success">
						Sub-agent{' '}
						{isEditMode
							? t.subAgentConfig.saveSuccessEdit
							: t.subAgentConfig.saveSuccessCreate}{' '}
						successfully!
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
					<Text
						bold
						color={
							currentField === 'name'
								? theme.colors.menuSelected
								: theme.colors.menuNormal
						}
					>
						{t.subAgentConfig.agentName}
						{isBuiltinAgent && (
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.subAgentConfig.builtinReadonly}
							</Text>
						)}
					</Text>
					<Box marginLeft={2}>
						{isBuiltinAgent ? (
							<Text color={theme.colors.menuNormal}>{agentName}</Text>
						) : (
							<TextInput
								value={agentName}
								onChange={value => setAgentName(stripFocusArtifacts(value))}
								placeholder={t.subAgentConfig.agentNamePlaceholder}
								focus={currentField === 'name'}
							/>
						)}
					</Box>
				</Box>

				{/* Description */}
				<Box flexDirection="column">
					<Text
						bold
						color={
							currentField === 'description'
								? theme.colors.menuSelected
								: theme.colors.menuNormal
						}
					>
						{t.subAgentConfig.description}
						{isBuiltinAgent && (
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.subAgentConfig.builtinReadonly}
							</Text>
						)}
					</Text>
					<Box marginLeft={2}>
						{isBuiltinAgent ? (
							<Text color={theme.colors.menuNormal}>{description}</Text>
						) : (
							<TextInput
								value={description}
								onChange={value => setDescription(stripFocusArtifacts(value))}
								placeholder={t.subAgentConfig.descriptionPlaceholder}
								focus={currentField === 'description'}
							/>
						)}
					</Box>
				</Box>

				{/* Role */}
				<Box flexDirection="column">
					<Text
						bold
						color={
							currentField === 'role'
								? theme.colors.menuSelected
								: theme.colors.menuNormal
						}
					>
						{t.subAgentConfig.roleOptional}
						{isBuiltinAgent && (
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.subAgentConfig.builtinReadonly}
							</Text>
						)}
						{!isBuiltinAgent && role && role.length > 100 && (
							<Text color={theme.colors.menuSecondary} dimColor>
								{' '}
								{t.subAgentConfig.roleExpandHint.replace(
									'{status}',
									roleExpanded
										? t.subAgentConfig.roleExpanded
										: t.subAgentConfig.roleCollapsed,
								)}
							</Text>
						)}
					</Text>
					<Box marginLeft={2} flexDirection="column">
						{isBuiltinAgent ? (
							role && role.length > 100 && !roleExpanded ? (
								<Text color={theme.colors.menuNormal}>
									{role.substring(0, 100)}...
									<Text color={theme.colors.menuSecondary} dimColor>
										{' '}
										{t.subAgentConfig.roleViewFull}
									</Text>
								</Text>
							) : (
								<Text color={theme.colors.menuNormal}>{role}</Text>
							)
						) : role && role.length > 100 && !roleExpanded ? (
							<Text color={theme.colors.menuNormal}>
								{role.substring(0, 100)}...
							</Text>
						) : (
							<TextInput
								value={role}
								onChange={value => setRole(stripFocusArtifacts(value))}
								placeholder={t.subAgentConfig.rolePlaceholder}
								focus={currentField === 'role'}
							/>
						)}
					</Box>
				</Box>

				{/* Config Profile (Optional) */}
				<Box flexDirection="column">
					<Text bold color={theme.colors.menuInfo}>
						{t.subAgentConfig.configProfile}
					</Text>
					<Box marginLeft={2}>
						{renderScrollableList(
							availableProfiles,
							selectedConfigProfileIndex,
							confirmedConfigProfileIndex, // 确认选中的项
							currentField === 'configProfile',
							5,
							'profile',
						)}
					</Box>
				</Box>

				{/* Tool Selection */}
				{renderToolSelection()}

				{/* Instructions */}
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.subAgentConfig.navigationHint}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}
