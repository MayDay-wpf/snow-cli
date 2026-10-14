import React, {useState, useCallback, useEffect, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {Alert} from '@inkjs/ui';
import {
	getAllSensitiveCommands,
	toggleSensitiveCommand,
	addSensitiveCommand,
	removeSensitiveCommand,
	resetToDefaults,
	isDuplicatePattern,
	type SensitiveCommand,
	type SensitiveCommandScope,
} from '../../utils/execution/sensitiveCommandManager.js';
import {
	getDecisionModelsConfig,
	type DecisionModelItem,
} from '../../utils/config/decisionModelsConfig.js';
import {
	getSensitiveCommandAssistSettings,
	saveSensitiveCommandAssistSettings,
	type SensitiveCommandAssistSettings,
} from '../../utils/config/sensitiveCommandAssistConfig.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';

// Focus event handling
const focusEventTokenRegex = /(?:\x1b)?\[[0-9;]*[IO]/g;

const isFocusEventInput = (value?: string) => {
	if (!value) return false;
	if (
		value === '\x1b[I' ||
		value === '\x1b[O' ||
		value === '[I' ||
		value === '[O'
	) {
		return true;
	}
	const trimmed = value.trim();
	if (!trimmed) return false;
	const tokens = trimmed.match(focusEventTokenRegex);
	if (!tokens) return false;
	const normalized = trimmed.replace(/\s+/g, '');
	const tokensCombined = tokens.join('');
	return tokensCombined === normalized;
};

const stripFocusArtifacts = (value: string) => {
	if (!value) return '';
	return value
		.replace(/\x1b\[[0-9;]*[IO]/g, '')
		.replace(/\[[0-9;]*[IO]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

type Props = {
	onBack: () => void;
	inlineMode?: boolean;
};

type ViewMode = 'list' | 'scope-select' | 'add' | 'assist';
type ScopeSelectPurpose = 'add' | 'reset';

/** 决策模型辅助标签页内的可交互行。 */
type AssistRow = 'toggle' | 'model' | 'delegate';

const SCOPE_OPTIONS: SensitiveCommandScope[] = ['project', 'global'];

const ASSIST_ROWS: AssistRow[] = ['toggle', 'model', 'delegate'];

export default function SensitiveCommandConfigScreen({
	onBack,
	inlineMode = false,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();

	useTerminalTitle(`Snow CLI - ${t.sensitiveCommandConfig.title}`);
	const [commands, setCommands] = useState<SensitiveCommand[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [viewMode, setViewMode] = useState<ViewMode>('list');
	const [showSuccess, setShowSuccess] = useState(false);
	const [successMessage, setSuccessMessage] = useState('');

	// Confirmation states
	const [confirmDelete, setConfirmDelete] = useState(false);

	// Scope selection states
	const [scopeSelectIndex, setScopeSelectIndex] = useState(0);
	const [scopeSelectPurpose, setScopeSelectPurpose] =
		useState<ScopeSelectPurpose>('add');
	const [selectedScope, setSelectedScope] =
		useState<SensitiveCommandScope>('global');
	const [confirmResetScope, setConfirmResetScope] = useState(false);

	// Add custom command fields
	const [customPattern, setCustomPattern] = useState('');
	const [customDescription, setCustomDescription] = useState('');
	const [addField, setAddField] = useState<'pattern' | 'description'>(
		'pattern',
	);
	const [addError, setAddError] = useState('');

	// Decision model assist tab state
	const [assistSettings, setAssistSettings] =
		useState<SensitiveCommandAssistSettings>(() =>
			getSensitiveCommandAssistSettings(),
		);
	const [decisionModels, setDecisionModels] = useState<DecisionModelItem[]>([]);
	const [assistRowIndex, setAssistRowIndex] = useState(0);
	const [assistModelSelecting, setAssistModelSelecting] = useState(false);
	const [assistModelIndex, setAssistModelIndex] = useState(0);
	const [assistError, setAssistError] = useState('');

	const getScopeLabel = useCallback(
		(scope: SensitiveCommandScope) => {
			return scope === 'project'
				? t.sensitiveCommandConfig.scopeProject
				: t.sensitiveCommandConfig.scopeGlobal;
		},
		[t],
	);

	// 顶部标签栏：明确当前处于「命令规则」还是「决策模型辅助」标签页
	const renderTabs = (activeTab: 'rules' | 'assist') => (
		<Box marginBottom={1}>
			{[
				{key: 'rules' as const, label: t.sensitiveCommandConfig.rulesTab},
				{key: 'assist' as const, label: t.sensitiveCommandConfig.assistTab},
			].map(tab => {
				const isActive = tab.key === activeTab;
				return (
					<Box key={tab.key} marginRight={2}>
						<Text
							bold={isActive}
							color={
								isActive ? theme.colors.menuInfo : theme.colors.menuSecondary
							}
							dimColor={!isActive}
						>
							{isActive ? '▸ ' : '  '}
							{tab.label}
						</Text>
					</Box>
				);
			})}
		</Box>
	);

	// Load commands
	const loadCommands = useCallback(() => {
		const allCommands = getAllSensitiveCommands();
		setCommands(allCommands);
	}, []);

	useEffect(() => {
		loadCommands();
	}, [loadCommands]);

	// Load decision models whenever the assist tab becomes active.
	useEffect(() => {
		if (viewMode !== 'assist') {
			return;
		}
		const config = getDecisionModelsConfig();
		setDecisionModels(config?.models ?? []);
	}, [viewMode]);

	// Persist assist settings; only writes these fields.
	const saveAssistSettings = useCallback(
		(next: SensitiveCommandAssistSettings) => {
			try {
				saveSensitiveCommandAssistSettings(next);
				setAssistSettings(getSensitiveCommandAssistSettings());
				setAssistError('');
			} catch (error) {
				setAssistError(
					error instanceof Error
						? error.message
						: t.sensitiveCommandConfig.assistSaveError,
				);
			}
		},
		[t],
	);

	// 辅助标签页的模型下拉选项：未选择 + 已配置模型（含已被删除的悬空选项）。
	const assistModelOptions = useMemo<
		Array<{label: string; value: string}>
	>(() => {
		const options: Array<{label: string; value: string}> = [
			{label: t.sensitiveCommandConfig.assistModelNone, value: ''},
			...decisionModels.map(model => ({
				label: model.name.trim() || model.model.trim() || model.id,
				value: model.id,
			})),
		];

		const selected = assistSettings.modelId;
		if (selected && !decisionModels.some(model => model.id === selected)) {
			options.push({
				label: `${selected} · ${t.sensitiveCommandConfig.assistModelUnavailable}`,
				value: selected,
			});
		}

		return options;
	}, [decisionModels, assistSettings.modelId, t]);

	const activeAssistRow: AssistRow = ASSIST_ROWS[assistRowIndex] ?? 'toggle';

	// Handle assist tab input
	const handleAssistInput = useCallback(
		(input: string, key: any) => {
			if (key.escape) {
				if (assistModelSelecting) {
					setAssistModelSelecting(false);
					return;
				}
				setViewMode('list');
				return;
			}

			// 模型下拉选择模式：↑↓ 选择，Enter 确认
			if (assistModelSelecting) {
				if (key.upArrow) {
					setAssistModelIndex(prev =>
						prev > 0 ? prev - 1 : assistModelOptions.length - 1,
					);
				} else if (key.downArrow) {
					setAssistModelIndex(prev =>
						prev < assistModelOptions.length - 1 ? prev + 1 : 0,
					);
				} else if (key.return) {
					const option = assistModelOptions[assistModelIndex];
					if (option) {
						saveAssistSettings({...assistSettings, modelId: option.value});
					}
					setAssistModelSelecting(false);
				}
				return;
			}

			if (key.tab) {
				// 在命令规则 / 决策模型辅助两个标签页之间切换
				setViewMode(prev => (prev === 'assist' ? 'list' : 'assist'));
				return;
			}

			if (key.upArrow) {
				setAssistRowIndex(prev =>
					prev > 0 ? prev - 1 : ASSIST_ROWS.length - 1,
				);
				return;
			}
			if (key.downArrow) {
				setAssistRowIndex(prev =>
					prev < ASSIST_ROWS.length - 1 ? prev + 1 : 0,
				);
				return;
			}

			const isToggle = key.return || input === ' ';

			if (activeAssistRow === 'toggle' && isToggle) {
				const nextEnabled = !assistSettings.enabled;
				saveAssistSettings({
					...assistSettings,
					enabled: nextEnabled,
					// 辅助关闭后托管不再有意义，一并关闭以免留下悬空状态。
					delegate: nextEnabled ? assistSettings.delegate : false,
				});
			} else if (activeAssistRow === 'model' && key.return) {
				if (assistSettings.enabled) {
					const selectedIndex = assistModelOptions.findIndex(
						option => option.value === assistSettings.modelId,
					);
					setAssistModelIndex(selectedIndex >= 0 ? selectedIndex : 0);
					setAssistModelSelecting(true);
				}
			} else if (activeAssistRow === 'delegate' && isToggle) {
				if (assistSettings.enabled && assistSettings.modelId) {
					saveAssistSettings({
						...assistSettings,
						delegate: !assistSettings.delegate,
					});
				}
			}
		},
		[
			assistModelSelecting,
			assistModelOptions,
			assistModelIndex,
			assistSettings,
			activeAssistRow,
			saveAssistSettings,
		],
	);

	// Handle list view input
	const handleListInput = useCallback(
		(input: string, key: any) => {
			if (key.escape) {
				if (confirmDelete) {
					setConfirmDelete(false);
					return;
				}
				onBack();
				return;
			}

			if (key.upArrow) {
				if (commands.length === 0) return;
				setSelectedIndex(prev => (prev > 0 ? prev - 1 : commands.length - 1));
				setConfirmDelete(false);
			} else if (key.downArrow) {
				if (commands.length === 0) return;
				setSelectedIndex(prev => (prev < commands.length - 1 ? prev + 1 : 0));
				setConfirmDelete(false);
			} else if (input === ' ') {
				const cmd = commands[selectedIndex];
				if (cmd) {
					toggleSensitiveCommand(cmd.id, cmd.scope);
					loadCommands();
					const message = cmd.enabled
						? t.sensitiveCommandConfig.disabledMessage
						: t.sensitiveCommandConfig.enabledMessage;
					setSuccessMessage(message.replace('{pattern}', cmd.pattern));
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
				}
			} else if (input === 'a' || input === 'A') {
				setScopeSelectPurpose('add');
				setScopeSelectIndex(0);
				setConfirmResetScope(false);
				setViewMode('scope-select');
			} else if (input === 'd' || input === 'D') {
				const cmd = commands[selectedIndex];
				if (cmd && !cmd.isPreset) {
					if (!confirmDelete) {
						setConfirmDelete(true);
					} else {
						removeSensitiveCommand(cmd.id, cmd.scope);
						loadCommands();
						setSelectedIndex(prev => Math.min(prev, commands.length - 2));
						setSuccessMessage(
							t.sensitiveCommandConfig.deletedMessage.replace(
								'{pattern}',
								cmd.pattern,
							),
						);
						setShowSuccess(true);
						setTimeout(() => setShowSuccess(false), 2000);
						setConfirmDelete(false);
					}
				}
			} else if (input === 'r' || input === 'R') {
				setScopeSelectPurpose('reset');
				setScopeSelectIndex(0);
				setConfirmResetScope(false);
				setViewMode('scope-select');
			} else if (key.tab) {
				// 切换到决策模型辅助标签页
				setAssistRowIndex(0);
				setAssistModelSelecting(false);
				setAssistError('');
				setViewMode('assist');
			}
		},
		[commands, selectedIndex, onBack, loadCommands, confirmDelete, t],
	);

	// Handle scope selection input (shared for add & reset)
	const handleScopeSelectInput = useCallback(
		(_input: string, key: any) => {
			if (key.escape) {
				if (confirmResetScope) {
					setConfirmResetScope(false);
					return;
				}
				setViewMode('list');
				return;
			}

			if (confirmResetScope) {
				if (key.return) {
					const scope = SCOPE_OPTIONS[scopeSelectIndex]!;
					resetToDefaults(scope);
					loadCommands();
					setSelectedIndex(0);
					setSuccessMessage(t.sensitiveCommandConfig.resetMessage);
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
					setConfirmResetScope(false);
					setViewMode('list');
				}
				return;
			}

			if (key.upArrow) {
				setScopeSelectIndex(prev =>
					prev > 0 ? prev - 1 : SCOPE_OPTIONS.length - 1,
				);
			} else if (key.downArrow) {
				setScopeSelectIndex(prev =>
					prev < SCOPE_OPTIONS.length - 1 ? prev + 1 : 0,
				);
			} else if (key.return) {
				const scope = SCOPE_OPTIONS[scopeSelectIndex]!;
				if (scopeSelectPurpose === 'add') {
					setSelectedScope(scope);
					setViewMode('add');
					setCustomPattern('');
					setCustomDescription('');
					setAddField('pattern');
					setAddError('');
				} else {
					setConfirmResetScope(true);
				}
			}
		},
		[scopeSelectIndex, scopeSelectPurpose, confirmResetScope, loadCommands, t],
	);

	// Handle add view input — ESC returns to scope-select
	const handleAddInput = useCallback((_input: string, key: any) => {
		if (key.escape) {
			setViewMode('scope-select');
			setAddError('');
			return;
		}

		if (key.tab) {
			setAddField(prev => (prev === 'pattern' ? 'description' : 'pattern'));
		}
	}, []);

	// Use input hook
	useInput(
		(input, key) => {
			if (viewMode === 'list') {
				handleListInput(input, key);
			} else if (viewMode === 'scope-select') {
				handleScopeSelectInput(input, key);
			} else if (viewMode === 'assist') {
				handleAssistInput(input, key);
			} else {
				handleAddInput(input, key);
			}
		},
		{isActive: true},
	);

	// Handle pattern input change
	const handlePatternChange = useCallback((value: string) => {
		if (!isFocusEventInput(value)) {
			setCustomPattern(stripFocusArtifacts(value));
			setAddError('');
		}
	}, []);

	// Handle description input change
	const handleDescriptionChange = useCallback((value: string) => {
		if (!isFocusEventInput(value)) {
			setCustomDescription(stripFocusArtifacts(value));
		}
	}, []);

	// Handle add submit
	const handleAddSubmit = useCallback(() => {
		if (addField === 'pattern') {
			if (customPattern.trim()) {
				const {isDuplicate, existingScope} = isDuplicatePattern(
					customPattern.trim(),
				);
				if (isDuplicate) {
					setAddError(
						t.sensitiveCommandConfig.duplicatePattern
							.replace('{pattern}', customPattern.trim())
							.replace('{scope}', getScopeLabel(existingScope!)),
					);
					return;
				}
			}
			setAddField('description');
		} else {
			if (customPattern.trim() && customDescription.trim()) {
				try {
					addSensitiveCommand(
						customPattern.trim(),
						customDescription.trim(),
						selectedScope,
					);
					loadCommands();
					setViewMode('list');
					setSuccessMessage(
						t.sensitiveCommandConfig.addedMessage.replace(
							'{pattern}',
							customPattern,
						),
					);
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
					setAddError('');
				} catch (error: any) {
					if (
						typeof error?.message === 'string' &&
						error.message.startsWith('DUPLICATE:')
					) {
						const scope = error.message.split(':')[1] as SensitiveCommandScope;
						setAddError(
							t.sensitiveCommandConfig.duplicatePattern
								.replace('{pattern}', customPattern.trim())
								.replace('{scope}', getScopeLabel(scope)),
						);
					}
				}
			}
		}
	}, [
		addField,
		customPattern,
		customDescription,
		selectedScope,
		loadCommands,
		t,
		getScopeLabel,
	]);

	// Scope selection view (shared for add & reset)
	if (viewMode === 'scope-select') {
		const isReset = scopeSelectPurpose === 'reset';
		const title = isReset
			? t.sensitiveCommandConfig.resetScopeSelectTitle
			: t.sensitiveCommandConfig.scopeSelectTitle;

		const scopeItems: Array<{
			label: string;
			desc: string;
			scope: SensitiveCommandScope;
		}> = [
			{
				label: t.sensitiveCommandConfig.scopeProject,
				desc: isReset
					? t.sensitiveCommandConfig.resetProjectDesc
					: '.snow/settings.json (sensitiveCommands)',
				scope: 'project',
			},
			{
				label: t.sensitiveCommandConfig.scopeGlobal,
				desc: isReset
					? t.sensitiveCommandConfig.resetGlobalDesc
					: '~/.snow/settings.json (sensitiveCommands)',
				scope: 'global',
			},
		];

		return (
			<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
				<Text bold color={theme.colors.menuInfo}>
					{title}
				</Text>
				{renderTabs('rules')}

				<Box marginTop={1} flexDirection="column">
					{scopeItems.map((item, idx) => {
						const isSelected = idx === scopeSelectIndex;
						return (
							<Box key={item.scope} marginBottom={1} flexDirection="column">
								<Text
									color={
										isSelected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold={isSelected}
								>
									{isSelected ? '> ' : '  '}
									{item.label}
								</Text>
								<Box marginLeft={3}>
									<Text color={theme.colors.menuSecondary} dimColor>
										{item.desc}
									</Text>
								</Box>
							</Box>
						);
					})}
				</Box>

				{confirmResetScope && (
					<Box marginTop={1}>
						<Text bold color={theme.colors.warning}>
							{t.sensitiveCommandConfig.confirmResetScopeMessage.replace(
								'{scope}',
								getScopeLabel(SCOPE_OPTIONS[scopeSelectIndex]!),
							)}
						</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text dimColor>
						{confirmResetScope
							? t.sensitiveCommandConfig.confirmHint
							: t.sensitiveCommandConfig.scopeSelectHint}
					</Text>
				</Box>
			</Box>
		);
	}

	if (viewMode === 'assist') {
		const isEnabled = assistSettings.enabled;
		const selectedModel = decisionModels.find(
			model => model.id === assistSettings.modelId,
		);
		const isModelUnavailable = assistSettings.modelId !== '' && !selectedModel;

		const renderRowMarker = (row: AssistRow) =>
			assistRowIndex === ASSIST_ROWS.indexOf(row) ? '>' : ' ';

		return (
			<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
				<Text bold color={theme.colors.menuInfo}>
					{t.sensitiveCommandConfig.title}
				</Text>
				{renderTabs('assist')}
				<Text dimColor>{t.sensitiveCommandConfig.assistInfo}</Text>

				{showSuccess && (
					<Box marginTop={1}>
						<Alert variant="success">{successMessage}</Alert>
					</Box>
				)}

				{assistError && (
					<Box marginTop={1}>
						<Text color={theme.colors.warning}>⚠️ {assistError}</Text>
					</Box>
				)}

				<Box marginTop={1} flexDirection="column">
					<Text
						color={
							assistRowIndex === 0
								? theme.colors.menuInfo
								: theme.colors.menuNormal
						}
						bold={assistRowIndex === 0}
					>
						{renderRowMarker('toggle')} {t.sensitiveCommandConfig.assistToggle}:
						[{isEnabled ? '✓' : ' '}]
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.sensitiveCommandConfig.assistToggleInfo}
						</Text>
					</Box>

					<Box marginTop={1} flexDirection="column">
						<Text
							color={
								assistRowIndex === 1
									? theme.colors.menuInfo
									: theme.colors.menuNormal
							}
							bold={assistRowIndex === 1}
						>
							{renderRowMarker('model')} {t.sensitiveCommandConfig.assistModel}:{' '}
							{selectedModel
								? selectedModel.name.trim() ||
								  selectedModel.model.trim() ||
								  selectedModel.id
								: assistSettings.modelId ||
								  t.sensitiveCommandConfig.assistModelNone}
							{isModelUnavailable
								? ` (${t.sensitiveCommandConfig.assistModelUnavailable})`
								: ''}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{decisionModels.length === 0
									? t.sensitiveCommandConfig.assistModelEmpty
									: t.sensitiveCommandConfig.assistModelInfo}
							</Text>
						</Box>
					</Box>

					<Box marginTop={1} flexDirection="column">
						<Text
							color={
								assistRowIndex === 2
									? theme.colors.menuInfo
									: theme.colors.menuNormal
							}
							bold={assistRowIndex === 2}
						>
							{renderRowMarker('delegate')}{' '}
							{t.sensitiveCommandConfig.assistDelegate}: [
							{isEnabled && assistSettings.delegate ? '✓' : ' '}]
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.sensitiveCommandConfig.assistDelegateInfo}
							</Text>
						</Box>
					</Box>
				</Box>

				{isModelUnavailable && (
					<Box marginTop={1}>
						<Text color={theme.colors.warning}>
							{t.sensitiveCommandConfig.assistModelUnavailableInfo}
						</Text>
					</Box>
				)}

				{assistModelSelecting && (
					<Box marginTop={1} flexDirection="column">
						<Text bold color={theme.colors.menuInfo}>
							{t.sensitiveCommandConfig.assistModel}
						</Text>
						{assistModelOptions.map((option, idx) => {
							const isSelected = idx === assistModelIndex;
							return (
								<Text
									key={option.value || '__none__'}
									color={
										isSelected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold={isSelected}
								>
									{isSelected ? '> ' : '  '}
									{option.label}
								</Text>
							);
						})}
					</Box>
				)}

				<Box marginTop={1}>
					<Text dimColor>
						{assistModelSelecting
							? t.sensitiveCommandConfig.scopeSelectHint
							: t.sensitiveCommandConfig.assistTabHint}
					</Text>
				</Box>
			</Box>
		);
	}

	if (viewMode === 'add') {
		return (
			<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
				<Text bold color={theme.colors.menuInfo}>
					{t.sensitiveCommandConfig.addTitle.replace(
						'{scope}',
						getScopeLabel(selectedScope),
					)}
				</Text>
				{renderTabs('rules')}
				<Box marginTop={1} />

				<Text dimColor>{t.sensitiveCommandConfig.patternLabel}</Text>
				<Box>
					<Text
						color={
							addField === 'pattern'
								? theme.colors.menuInfo
								: theme.colors.menuSecondary
						}
					>
						❯{' '}
					</Text>
					<TextInput
						value={customPattern}
						onChange={handlePatternChange}
						onSubmit={handleAddSubmit}
						focus={addField === 'pattern'}
						placeholder={t.sensitiveCommandConfig.patternPlaceholder}
					/>
				</Box>

				{addError && (
					<Box marginTop={0}>
						<Text color={theme.colors.warning}>⚠️ {addError}</Text>
					</Box>
				)}

				<Box marginTop={1} />
				<Text dimColor>{t.sensitiveCommandConfig.descriptionLabel}</Text>
				<Box>
					<Text
						color={
							addField === 'description'
								? theme.colors.menuInfo
								: theme.colors.menuSecondary
						}
					>
						❯{' '}
					</Text>
					<TextInput
						value={customDescription}
						onChange={handleDescriptionChange}
						onSubmit={handleAddSubmit}
						focus={addField === 'description'}
					/>
				</Box>

				<Box marginTop={1} />
				<Text dimColor>{t.sensitiveCommandConfig.addEditingHint}</Text>
			</Box>
		);
	}

	// Calculate visible range for scrolling
	const viewportHeight = 13;
	const startIndex = Math.max(
		0,
		selectedIndex - Math.floor(viewportHeight / 2),
	);
	const endIndex = Math.min(commands.length, startIndex + viewportHeight);
	const adjustedStart = Math.max(0, endIndex - viewportHeight);

	const selectedCmd = commands[selectedIndex];

	return (
		<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
			<Text bold color={theme.colors.menuInfo}>
				{t.sensitiveCommandConfig.title}
			</Text>
			{renderTabs('rules')}
			<Text dimColor>{t.sensitiveCommandConfig.subtitle}</Text>

			{showSuccess && (
				<Box marginTop={1}>
					<Alert variant="success">{successMessage}</Alert>
				</Box>
			)}

			<Box marginTop={1} />

			{commands.length === 0 ? (
				<Text dimColor>{t.sensitiveCommandConfig.noCommands}</Text>
			) : (
				commands.map((cmd, index) => {
					if (index < adjustedStart || index >= endIndex) {
						return null;
					}

					const scopeTag = cmd.isPreset ? '' : ` · ${getScopeLabel(cmd.scope)}`;

					return (
						<Text
							key={`${cmd.scope}-${cmd.id}`}
							color={
								selectedIndex === index
									? theme.colors.menuInfo
									: cmd.enabled
									? theme.colors.menuNormal
									: theme.colors.menuSecondary
							}
							bold={selectedIndex === index}
							dimColor={!cmd.enabled}
						>
							{selectedIndex === index ? '❯ ' : '  '}[{cmd.enabled ? '✓' : ' '}]{' '}
							{cmd.pattern}
							{!cmd.isPreset && (
								<Text color={theme.colors.warning}>
									{' '}
									({t.sensitiveCommandConfig.custom}
									{scopeTag})
								</Text>
							)}
						</Text>
					);
				})
			)}

			<Box marginTop={1} />
			{selectedCmd && !confirmDelete && (
				<Text dimColor>
					{selectedCmd.description} (
					{selectedCmd.enabled
						? t.sensitiveCommandConfig.enabled
						: t.sensitiveCommandConfig.disabled}
					)
					{!selectedCmd.isPreset &&
						` [${t.sensitiveCommandConfig.customLabel}]`}
				</Text>
			)}

			{confirmDelete && selectedCmd && (
				<Text bold color={theme.colors.warning}>
					{t.sensitiveCommandConfig.confirmDeleteMessage.replace(
						'{pattern}',
						selectedCmd.pattern,
					)}
				</Text>
			)}

			<Box marginTop={1} />
			<Text dimColor>
				{confirmDelete
					? t.sensitiveCommandConfig.confirmHint
					: t.sensitiveCommandConfig.listNavigationHint}
			</Text>
		</Box>
	);
}
