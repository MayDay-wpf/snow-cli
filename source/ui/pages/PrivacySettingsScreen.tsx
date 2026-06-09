import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import Menu from '../components/common/Menu.js';
import {getMCPServicesInfo} from '../../utils/execution/mcpToolsManager.js';
import type {MCPServiceTools} from '../../utils/execution/mcpToolsManager.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import {
	getSettingsPath,
	readSettings,
	updateSettings,
	type SettingsScope,
} from '../../utils/config/unifiedSettings.js';

const DEFAULT_PRIVACY_MODEL = 'openai/privacy-filter';
const DEFAULT_TOOL_RESULT_TOOLS = [
	'filesystem-read',
	'ace-search',
	'terminal-execute',
];

type Props = {
	onBack: () => void;
	inlineMode?: boolean;
};

type View = 'menu' | 'api-form' | 'tool-results';
type ApiField = 'url' | 'apiKey' | 'model';
type PrivacyMode = 'api' | 'local';

type ApiDraft = {
	url: string;
	apiKey: string;
	model: string;
};

type ToolCategory = {
	name: string;
	tools: string[];
};

function loadApiDraft(scope: SettingsScope): ApiDraft {
	const settings = readSettings(scope);
	return {
		url: settings.privacy?.api?.url ?? '',
		apiKey: settings.privacy?.api?.apiKey ?? '',
		model: settings.privacy?.api?.model ?? DEFAULT_PRIVACY_MODEL,
	};
}

function loadEnabled(scope: SettingsScope): boolean {
	return readSettings(scope).privacy?.enabled ?? false;
}

function loadPrivacyMode(scope: SettingsScope): PrivacyMode {
	return readSettings(scope).privacy?.mode ?? 'api';
}

function loadToolResults(scope: SettingsScope): Set<string> {
	return new Set(
		readSettings(scope).privacy?.toolResults?.tools ??
			DEFAULT_TOOL_RESULT_TOOLS,
	);
}

export default function PrivacySettingsScreen({
	onBack,
	inlineMode = false,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [view, setView] = useState<View>('menu');
	const [scope, setScope] = useState<SettingsScope>('project');
	const [enabled, setEnabled] = useState(() => loadEnabled('project'));
	const [privacyMode, setPrivacyMode] = useState<PrivacyMode>(() =>
		loadPrivacyMode('project'),
	);
	const [apiDraft, setApiDraft] = useState<ApiDraft>(() =>
		loadApiDraft('project'),
	);
	const [selectedTools, setSelectedTools] = useState<Set<string>>(() =>
		loadToolResults('project'),
	);
	const [selectedCategoryIndex, setSelectedCategoryIndex] = useState(0);
	const [selectedToolIndex, setSelectedToolIndex] = useState(0);
	const [isLoadingMCP, setIsLoadingMCP] = useState(true);
	const [mcpServices, setMcpServices] = useState<MCPServiceTools[]>([]);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [editingField, setEditingField] = useState<ApiField | undefined>();
	const [editingInitialValue, setEditingInitialValue] = useState('');
	const [privacyMenuIndex, setPrivacyMenuIndex] = useState(0);
	const [infoText, setInfoText] = useState(t.privacySettings.apiConfigInfo);
	const settingsPath = getSettingsPath(scope);

	useTerminalTitle(`Snow CLI - ${t.privacySettings.title}`);

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

	const toolCategories: ToolCategory[] = useMemo(
		() => [
			{
				name: t.subAgentConfig.filesystemTools,
				tools: [
					'filesystem-read',
					'filesystem-create',
					'filesystem-replaceedit',
					'filesystem-edit',
				],
			},
			{
				name: t.subAgentConfig.aceTools,
				tools: ['ace-search'],
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
				tools: ['todo-manage'],
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
				name: t.subAgentConfig.userInteractionTools,
				tools: ['askuser-ask_question'],
			},
			{
				name: t.subAgentConfig.skillTools,
				tools: ['skill-execute'],
			},
		],
		[t.subAgentConfig],
	);

	const allToolCategories = useMemo(() => {
		const categories = [...toolCategories];

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
	}, [mcpServices, t.subAgentConfig.categoryMCP, toolCategories]);

	const allTools = useMemo(
		() => allToolCategories.flatMap(category => category.tools),
		[allToolCategories],
	);

	const saveEnabled = useCallback(
		(nextEnabled: boolean) => {
			updateSettings(scope, settings => {
				settings.privacy = {
					...settings.privacy,
					enabled: nextEnabled,
				};
			});
			setEnabled(nextEnabled);
			setInfoText(t.privacySettings.savedInfo);
		},
		[scope, t.privacySettings.savedInfo],
	);

	const savePrivacyMode = useCallback(
		(nextMode: PrivacyMode) => {
			updateSettings(scope, settings => {
				settings.privacy = {
					...settings.privacy,
					mode: nextMode,
				};
			});
			setPrivacyMode(nextMode);
			setInfoText(t.privacySettings.savedInfo);
		},
		[scope, t.privacySettings.savedInfo],
	);

	const openApiForm = useCallback(() => {
		setApiDraft(loadApiDraft(scope));
		setEditingField(undefined);
		setView('api-form');
	}, [scope]);

	const openToolResults = useCallback(() => {
		setSelectedTools(loadToolResults(scope));
		setSelectedCategoryIndex(0);
		setSelectedToolIndex(0);
		setView('tool-results');
	}, [scope]);

	const saveApiConfig = useCallback(() => {
		updateSettings(scope, settings => {
			settings.privacy = {
				...settings.privacy,
				api: {
					url: apiDraft.url.trim(),
					apiKey: apiDraft.apiKey.trim() || undefined,
					model: apiDraft.model.trim() || DEFAULT_PRIVACY_MODEL,
				},
			};
		});
		setApiDraft(current => ({
			...current,
			model: current.model.trim() || DEFAULT_PRIVACY_MODEL,
		}));
		setInfoText(t.privacySettings.savedInfo);
		setView('menu');
	}, [apiDraft, scope, t.privacySettings.savedInfo]);

	const saveToolResults = useCallback(() => {
		updateSettings(scope, settings => {
			settings.privacy = {
				...settings.privacy,
				toolResults: {
					tools: Array.from(selectedTools),
				},
			};
		});
		setInfoText(t.privacySettings.savedInfo);
		setView('menu');
	}, [scope, selectedTools, t.privacySettings.savedInfo]);

	const privacyOptions = useMemo(() => {
		const options: Array<{
			label: string;
			value: string;
			infoText: string;
			color?: string;
		}> = [
			{
				label: `${t.privacySettings.configLocation}: ${
					scope === 'project'
						? t.privacySettings.projectLocation
						: t.privacySettings.globalLocation
				}`,
				value: 'toggle-scope',
				infoText: settingsPath,
			},
			{
				label: `${t.privacySettings.enablePrivacy}: ${
					enabled ? t.privacySettings.enabled : t.privacySettings.disabled
				}`,
				value: 'toggle-enabled',
				infoText: t.privacySettings.enablePrivacyInfo,
			},
			{
				label: `${t.privacySettings.modeLabel}: ${
					privacyMode === 'api'
						? t.privacySettings.modeApi
						: t.privacySettings.modeLocalRules
				}`,
				value: 'toggle-mode',
				infoText:
					privacyMode === 'api'
						? t.privacySettings.modeApiInfo
						: t.privacySettings.modeLocalRulesInfo,
			},
		];

		if (privacyMode === 'api') {
			options.push({
				label: t.privacySettings.apiConfig,
				value: 'api-config',
				infoText: t.privacySettings.apiConfigInfo,
			});
		}

		options.push(
			{
				label: t.privacySettings.toolResultsConfig,
				value: 'tool-results-config',
				infoText: t.privacySettings.toolResultsConfigInfo,
			},
			{
				label: t.privacySettings.back,
				value: 'back',
				color: theme.colors.menuSecondary,
				infoText: t.privacySettings.backInfo,
			},
		);

		return options;
	}, [
		enabled,
		privacyMode,
		scope,
		settingsPath,
		t.privacySettings,
		theme.colors.menuSecondary,
	]);

	const apiFormOptions = useMemo(
		() => [
			{
				label: `${t.privacySettings.urlLabel}: ${
					apiDraft.url || t.privacySettings.notSet
				}`,
				value: 'url',
				infoText: t.privacySettings.urlInfo,
			},
			{
				label: `${t.privacySettings.apiKeyLabel}: ${
					apiDraft.apiKey
						? t.privacySettings.configured
						: t.privacySettings.optional
				}`,
				value: 'apiKey',
				infoText: t.privacySettings.apiKeyInfo,
			},
			{
				label: `${t.privacySettings.modelLabel}: ${
					apiDraft.model || DEFAULT_PRIVACY_MODEL
				}`,
				value: 'model',
				infoText: t.privacySettings.modelInfo,
			},
			{
				label: t.privacySettings.back,
				value: 'back',
				color: theme.colors.menuSecondary,
				infoText: t.privacySettings.backInfo,
			},
		],
		[apiDraft, t.privacySettings, theme.colors.menuSecondary],
	);

	const handleToggleTool = useCallback((tool: string) => {
		setSelectedTools(previous => {
			const next = new Set(previous);
			if (next.has(tool)) {
				next.delete(tool);
			} else {
				next.add(tool);
			}
			return next;
		});
	}, []);

	const handleToggleCategory = useCallback(() => {
		const category = allToolCategories[selectedCategoryIndex];
		if (!category) return;

		const allSelected = category.tools.every(tool => selectedTools.has(tool));
		setSelectedTools(previous => {
			const next = new Set(previous);
			if (allSelected) {
				category.tools.forEach(tool => next.delete(tool));
			} else {
				category.tools.forEach(tool => next.add(tool));
			}
			return next;
		});
	}, [allToolCategories, selectedCategoryIndex, selectedTools]);

	const handleToggleCurrentTool = useCallback(() => {
		const category = allToolCategories[selectedCategoryIndex];
		if (!category) return;

		const tool = category.tools[selectedToolIndex];
		if (tool) {
			handleToggleTool(tool);
		}
	}, [
		allToolCategories,
		handleToggleTool,
		selectedCategoryIndex,
		selectedToolIndex,
	]);

	const handleMenuSelect = useCallback(
		(value: string) => {
			if (value === 'back') {
				onBack();
			} else if (value === 'toggle-scope') {
				const nextScope = scope === 'project' ? 'global' : 'project';
				setScope(nextScope);
				setEnabled(loadEnabled(nextScope));
				setPrivacyMode(loadPrivacyMode(nextScope));
				setApiDraft(loadApiDraft(nextScope));
				setSelectedTools(loadToolResults(nextScope));
				setInfoText(getSettingsPath(nextScope));
			} else if (value === 'toggle-enabled') {
				saveEnabled(!enabled);
			} else if (value === 'toggle-mode') {
				savePrivacyMode(privacyMode === 'api' ? 'local' : 'api');
			} else if (value === 'api-config') {
				openApiForm();
			} else if (value === 'tool-results-config') {
				openToolResults();
			}
		},
		[
			enabled,
			onBack,
			openApiForm,
			openToolResults,
			privacyMode,
			saveEnabled,
			savePrivacyMode,
			scope,
		],
	);

	const returnToMenuFromApiForm = useCallback(() => {
		saveApiConfig();
		setEditingField(undefined);
		setPrivacyMenuIndex(3);
	}, [saveApiConfig]);

	const returnToMenuFromToolResults = useCallback(() => {
		saveToolResults();
		setPrivacyMenuIndex(privacyMode === 'api' ? 4 : 3);
	}, [privacyMode, saveToolResults]);

	const handleApiFormSelect = useCallback(
		(value: string) => {
			if (value === 'back') {
				returnToMenuFromApiForm();
			} else {
				const field = value as ApiField;
				setEditingInitialValue(apiDraft[field]);
				setEditingField(field);
			}
		},
		[apiDraft, returnToMenuFromApiForm],
	);

	const handleApiFieldSubmit = useCallback(() => {
		setEditingField(undefined);
		setEditingInitialValue('');
	}, []);

	const handleSelectionChange = useCallback((newInfoText: string) => {
		setInfoText(newInfoText);
	}, []);

	useInput((input, key) => {
		if (view === 'tool-results') {
			if (key.escape) {
				returnToMenuFromToolResults();
				return;
			}

			if (key.upArrow) {
				if (selectedToolIndex > 0) {
					setSelectedToolIndex(previous => previous - 1);
				} else if (selectedCategoryIndex > 0) {
					const previousCategory = allToolCategories[selectedCategoryIndex - 1];
					setSelectedCategoryIndex(previous => previous - 1);
					setSelectedToolIndex(
						previousCategory ? previousCategory.tools.length - 1 : 0,
					);
				}
				return;
			}

			if (key.downArrow) {
				const currentCategory = allToolCategories[selectedCategoryIndex];
				if (!currentCategory) return;

				if (selectedToolIndex < currentCategory.tools.length - 1) {
					setSelectedToolIndex(previous => previous + 1);
				} else if (selectedCategoryIndex < allToolCategories.length - 1) {
					setSelectedCategoryIndex(previous => previous + 1);
					setSelectedToolIndex(0);
				}
				return;
			}

			if (key.leftArrow) {
				if (selectedCategoryIndex > 0) {
					setSelectedCategoryIndex(previous => previous - 1);
					setSelectedToolIndex(0);
				}
				return;
			}

			if (key.rightArrow) {
				if (selectedCategoryIndex < allToolCategories.length - 1) {
					setSelectedCategoryIndex(previous => previous + 1);
					setSelectedToolIndex(0);
				}
				return;
			}

			if (input === ' ') {
				handleToggleCurrentTool();
				return;
			}

			if (input === 'a' || input === 'A') {
				handleToggleCategory();
				return;
			}

			if (key.return) {
				returnToMenuFromToolResults();
			}
			return;
		}

		if (!key.escape) return;

		if (editingField) {
			const field = editingField;
			setApiDraft(current => ({
				...current,
				[field]: editingInitialValue,
			}));
			setEditingField(undefined);
			setEditingInitialValue('');
			return;
		}

		if (view === 'menu') {
			onBack();
		} else {
			returnToMenuFromApiForm();
		}
	});

	const renderScrollableTools = (
		tools: string[],
		selectedIndex: number,
		maxVisible = 5,
	) => {
		const totalTools = tools.length;
		let startIndex = Math.max(0, selectedIndex - Math.floor(maxVisible / 2));
		const endIndex = Math.min(totalTools, startIndex + maxVisible);

		if (endIndex - startIndex < maxVisible) {
			startIndex = Math.max(0, endIndex - maxVisible);
		}

		const visibleTools = tools.slice(startIndex, endIndex);
		const hasMore = totalTools > maxVisible;

		return (
			<Box flexDirection="column" marginLeft={2}>
				{startIndex > 0 && (
					<Text color={theme.colors.menuSecondary} dimColor>
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
								{isCurrentTool ? '> ' : '  '}
								{selectedTools.has(tool) ? '[✓]' : '[ ]'} {tool}
							</Text>
						</Box>
					);
				})}
				{endIndex < totalTools && (
					<Text color={theme.colors.menuSecondary} dimColor>
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

	const renderToolResults = () => {
		return (
			<Box flexDirection="column">
				<Box paddingX={1} marginBottom={1}>
					<Text color={theme.colors.menuSecondary}>
						{t.privacySettings.configLocation}:{' '}
						{scope === 'project'
							? t.privacySettings.projectLocation
							: t.privacySettings.globalLocation}
					</Text>
				</Box>
				<Text bold color={theme.colors.menuInfo}>
					{t.subAgentConfig.toolSelection}
				</Text>
				{isLoadingMCP && (
					<Text color={theme.colors.menuSecondary}>
						{t.subAgentConfig.loadingMCP}
					</Text>
				)}
				{loadError && (
					<Text color={theme.colors.warning}>
						{t.subAgentConfig.mcpLoadError} {loadError}
					</Text>
				)}
				{allToolCategories.map((category, categoryIndex) => {
					const isCurrent = categoryIndex === selectedCategoryIndex;
					const selectedInCategory = category.tools.filter(tool =>
						selectedTools.has(tool),
					).length;

					return (
						<Box key={category.name} flexDirection="column">
							<Text
								color={
									isCurrent
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={isCurrent}
							>
								{isCurrent ? '> ' : '  '}
								{category.name} ({selectedInCategory}/{category.tools.length})
							</Text>
							{isCurrent &&
								renderScrollableTools(category.tools, selectedToolIndex, 5)}
						</Box>
					);
				})}
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.subAgentConfig.selectedTools} {selectedTools.size} /{' '}
					{allTools.length} {t.subAgentConfig.toolsCount}
				</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.subAgentConfig.scrollToolsHint}
				</Text>
			</Box>
		);
	};

	return (
		<Box flexDirection="column" paddingX={1}>
			{!inlineMode && (
				<Box
					borderStyle="round"
					borderColor={theme.colors.menuInfo}
					paddingX={1}
					marginBottom={1}
				>
					<Box flexDirection="column">
						<Text bold color={theme.colors.menuInfo}>
							{t.privacySettings.title}
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column">
				<Box paddingX={1} marginBottom={1}>
					<Text color={theme.colors.menuSecondary}>{infoText}</Text>
				</Box>

				{view === 'menu' && (
					<Menu
						options={privacyOptions}
						onSelect={handleMenuSelect}
						onSelectionChange={handleSelectionChange}
						defaultIndex={privacyMenuIndex}
					/>
				)}

				{view === 'api-form' && (
					<Box flexDirection="column">
						<Box paddingX={1} marginBottom={1}>
							<Text color={theme.colors.menuSecondary}>
								{t.privacySettings.configLocation}:{' '}
								{scope === 'project'
									? t.privacySettings.projectLocation
									: t.privacySettings.globalLocation}
							</Text>
						</Box>
						{editingField ? (
							<Box paddingX={1}>
								<Text color={theme.colors.menuInfo}>
									{editingField === 'url'
										? t.privacySettings.urlLabel
										: editingField === 'apiKey'
										? t.privacySettings.apiKeyLabel
										: t.privacySettings.modelLabel}
									:{' '}
								</Text>
								<TextInput
									value={apiDraft[editingField]}
									onChange={value =>
										setApiDraft(current => ({
											...current,
											[editingField]: value,
										}))
									}
									onSubmit={handleApiFieldSubmit}
								/>
							</Box>
						) : (
							<Menu
								options={apiFormOptions}
								onSelect={handleApiFormSelect}
								onSelectionChange={handleSelectionChange}
							/>
						)}
					</Box>
				)}

				{view === 'tool-results' && renderToolResults()}
			</Box>
		</Box>
	);
}
