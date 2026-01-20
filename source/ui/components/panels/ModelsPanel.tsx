import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import ScrollableSelectInput from '../common/ScrollableSelectInput.js';
import {
	fetchAvailableModels,
	filterModels,
	type Model,
} from '../../../api/models.js';
import {
	getOpenAiConfig,
	updateOpenAiConfig,
	type RequestMethod,
} from '../../../utils/config/apiConfig.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';
import {configEvents} from '../../../utils/config/configEvents.js';

interface Props {
	advancedModel: string;
	basicModel: string;
	visible: boolean;
	onClose: () => void;
}

type Tab = 'advanced' | 'basic' | 'thinking';

type ThinkingInputMode =
	| null
	| 'anthropicBudgetTokens'
	| 'geminiThinkingBudget';

type ResponsesReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh';

export const ModelsPanel: React.FC<Props> = ({
	advancedModel,
	basicModel,
	visible,
	onClose,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();

	const [activeTab, setActiveTab] = useState<Tab>('advanced');

	// 判断当前是否在模型选择页（非思考页）
	const isModelTab = activeTab === 'advanced' || activeTab === 'basic';

	// Model settings
	const [localAdvancedModel, setLocalAdvancedModel] = useState(advancedModel);
	const [localBasicModel, setLocalBasicModel] = useState(basicModel);

	// Model list state
	const [models, setModels] = useState<Model[]>([]);
	const [loading, setLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState('');
	const [isSelecting, setIsSelecting] = useState(false);
	const [searchTerm, setSearchTerm] = useState('');
	const [manualInputMode, setManualInputMode] = useState(false);
	const [manualInputValue, setManualInputValue] = useState('');
	const [hasStartedLoading, setHasStartedLoading] = useState(false);

	// Thinking settings (aligned with ConfigScreen)
	const [requestMethod, setRequestMethod] = useState<RequestMethod>('chat');
	const [showThinking, setShowThinking] = useState(true);
	const [thinkingEnabled, setThinkingEnabled] = useState(false);
	const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState(10000);
	const [geminiThinkingEnabled, setGeminiThinkingEnabled] = useState(false);
	const [geminiThinkingBudget, setGeminiThinkingBudget] = useState(1024);
	const [responsesReasoningEnabled, setResponsesReasoningEnabled] =
		useState(false);
	const [responsesReasoningEffort, setResponsesReasoningEffort] =
		useState<ResponsesReasoningEffort>('high');

	// 思考页的聚焦索引：0=显示思考, 1=启用思考, 2=思考强度
	const [thinkingFocusIndex, setThinkingFocusIndex] = useState(0);
	const [thinkingInputMode, setThinkingInputMode] =
		useState<ThinkingInputMode>(null);
	const [thinkingInputValue, setThinkingInputValue] = useState('');
	const [isThinkingEffortSelecting, setIsThinkingEffortSelecting] =
		useState(false);

	useEffect(() => {
		if (!visible) {
			return;
		}

		setActiveTab('advanced');
		setLocalAdvancedModel(advancedModel);
		setLocalBasicModel(basicModel);

		// Reset transient UI state
		setIsSelecting(false);
		setSearchTerm('');
		setManualInputMode(false);
		setManualInputValue('');
		setHasStartedLoading(false);
		setThinkingFocusIndex(0);
		setThinkingInputMode(null);
		setThinkingInputValue('');
		setIsThinkingEffortSelecting(false);
		setErrorMessage('');

		// Load thinking-related config on open
		const cfg = getOpenAiConfig();
		setRequestMethod(cfg.requestMethod || 'chat');
		setShowThinking(cfg.showThinking !== false); // default true
		setThinkingEnabled(cfg.thinking?.type === 'enabled' || false);
		setThinkingBudgetTokens(cfg.thinking?.budget_tokens || 10000);
		setGeminiThinkingEnabled((cfg as any).geminiThinking?.enabled || false);
		setGeminiThinkingBudget((cfg as any).geminiThinking?.budget || 1024);
		setResponsesReasoningEnabled(
			(cfg as any).responsesReasoning?.enabled || false,
		);
		setResponsesReasoningEffort(
			(cfg as any).responsesReasoning?.effort || 'high',
		);
	}, [visible, advancedModel, basicModel]);

	const modelTarget: 'advanced' | 'basic' | 'thinking' =
		activeTab === 'basic'
			? 'basic'
			: activeTab === 'thinking'
			? 'thinking'
			: 'advanced';
	const currentModel =
		modelTarget === 'advanced'
			? localAdvancedModel
			: modelTarget === 'basic'
			? localBasicModel
			: '';
	const currentLabel =
		modelTarget === 'advanced'
			? t.modelsPanel.advancedModelLabel
			: modelTarget === 'basic'
			? t.modelsPanel.basicModelLabel
			: t.modelsPanel.thinkingLabel;

	const loadModels = useCallback(async () => {
		setLoading(true);
		setErrorMessage('');

		try {
			const fetchedModels = await fetchAvailableModels();
			setModels(fetchedModels);
			return fetchedModels;
		} catch (err) {
			const message =
				err instanceof Error ? err.message : t.modelsPanel.loadingModels;
			setErrorMessage(message);
			throw err;
		} finally {
			setLoading(false);
		}
	}, [t]);

	const applyModel = useCallback(
		async (value: string, target: 'advanced' | 'basic') => {
			setErrorMessage('');
			try {
				if (target === 'advanced') {
					await updateOpenAiConfig({advancedModel: value});
					setLocalAdvancedModel(value);
				} else {
					await updateOpenAiConfig({basicModel: value});
					setLocalBasicModel(value);
				}
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.modelSaveFailed;
				setErrorMessage(message);
			}
		},
		[],
	);

	const filteredModels = useMemo(
		() => filterModels(models, searchTerm),
		[models, searchTerm],
	);

	const currentOptions = useMemo(
		() => [
			{label: t.modelsPanel.manualInputOption, value: '__MANUAL_INPUT__'},
			...filteredModels.map(model => ({
				label: model.id,
				value: model.id,
			})),
		],
		[filteredModels, t],
	);

	const handleModelSelect = useCallback(
		(value: string) => {
			if (value === '__MANUAL_INPUT__') {
				setIsSelecting(false);
				setSearchTerm('');
				setManualInputMode(true);
				setManualInputValue(currentModel);
				return;
			}

			// 思考页不应该调用applyModel
			if (modelTarget !== 'thinking') {
				void applyModel(value, modelTarget);
			}
			setIsSelecting(false);
			setSearchTerm('');
		},
		[applyModel, currentModel, modelTarget],
	);

	const handleManualSave = useCallback(() => {
		const cleaned = manualInputValue.trim();
		if (cleaned && modelTarget !== 'thinking') {
			void applyModel(cleaned, modelTarget);
		}
		setManualInputMode(false);
		setManualInputValue('');
		setSearchTerm('');
	}, [applyModel, manualInputValue, modelTarget]);

	const thinkingEnabledValue = useMemo(() => {
		if (requestMethod === 'anthropic') {
			return thinkingEnabled;
		}
		if (requestMethod === 'gemini') {
			return geminiThinkingEnabled;
		}
		if (requestMethod === 'responses') {
			return responsesReasoningEnabled;
		}
		return false;
	}, [
		requestMethod,
		thinkingEnabled,
		geminiThinkingEnabled,
		responsesReasoningEnabled,
	]);

	const thinkingStrengthValue = useMemo(() => {
		if (requestMethod === 'anthropic') {
			return String(thinkingBudgetTokens);
		}
		if (requestMethod === 'gemini') {
			return String(geminiThinkingBudget);
		}
		if (requestMethod === 'responses') {
			return responsesReasoningEffort;
		}
		return t.modelsPanel.notSupported;
	}, [
		requestMethod,
		thinkingBudgetTokens,
		geminiThinkingBudget,
		responsesReasoningEffort,
		t,
	]);

	const applyShowThinking = useCallback(async (next: boolean) => {
		setErrorMessage('');
		try {
			setShowThinking(next);
			await updateOpenAiConfig({showThinking: next});
			// Emit config change event for real-time sync
			configEvents.emitConfigChange({
				type: 'showThinking',
				value: next,
			});
		} catch (err) {
			const message =
				err instanceof Error ? err.message : t.modelsPanel.saveFailed;
			setErrorMessage(message);
		}
	}, []);

	const applyThinkingEnabled = useCallback(
		async (next: boolean) => {
			setErrorMessage('');
			try {
				if (requestMethod === 'anthropic') {
					setThinkingEnabled(next);
					await updateOpenAiConfig({
						thinking: next
							? {type: 'enabled' as const, budget_tokens: thinkingBudgetTokens}
							: undefined,
					} as any);
					return;
				}
				if (requestMethod === 'gemini') {
					setGeminiThinkingEnabled(next);
					await updateOpenAiConfig({
						geminiThinking: next
							? {enabled: true, budget: geminiThinkingBudget}
							: undefined,
					} as any);
					return;
				}
				if (requestMethod === 'responses') {
					setResponsesReasoningEnabled(next);
					await updateOpenAiConfig({
						responsesReasoning: {
							enabled: next,
							effort: responsesReasoningEffort,
						},
					} as any);
					return;
				}

				setErrorMessage(
					t.modelsPanel.requestMethodNotSupportedForThinking.replace(
						'{requestMethod}',
						requestMethod,
					),
				);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[
			requestMethod,
			thinkingBudgetTokens,
			geminiThinkingBudget,
			responsesReasoningEffort,
		],
	);

	const applyAnthropicBudgetTokens = useCallback(
		async (next: number) => {
			setErrorMessage('');
			try {
				setThinkingBudgetTokens(next);
				await updateOpenAiConfig({
					thinking: thinkingEnabled
						? {type: 'enabled' as const, budget_tokens: next}
						: undefined,
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[thinkingEnabled],
	);

	const applyGeminiBudget = useCallback(
		async (next: number) => {
			setErrorMessage('');
			try {
				setGeminiThinkingBudget(next);
				await updateOpenAiConfig({
					geminiThinking: geminiThinkingEnabled
						? {enabled: true, budget: next}
						: undefined,
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[geminiThinkingEnabled],
	);

	const applyResponsesEffort = useCallback(
		async (effort: ResponsesReasoningEffort) => {
			setErrorMessage('');
			try {
				setResponsesReasoningEffort(effort);
				await updateOpenAiConfig({
					responsesReasoning: {
						enabled: responsesReasoningEnabled,
						effort,
					},
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[responsesReasoningEnabled],
	);

	// 思考页的配置项，不再需要thinkingMenuItems
	// 直接通过上下键切换聚焦索引，Enter键根据聚焦索引执行操作

	const selectedIndex = Math.max(
		0,
		currentOptions.findIndex(option => option.value === currentModel),
	);

	// Ink/Chalk 对 hex 颜色通常只支持 #RRGGBB，这里把 #RRGGBBAA 的 alpha 去掉作为背景色使用。
	const tabActiveBackground =
		theme.colors.menuSelected.startsWith('#') &&
		theme.colors.menuSelected.length === 9
			? theme.colors.menuSelected.slice(0, 7)
			: theme.colors.menuSelected;

	useInput(
		(input, key) => {
			if (!visible) {
				return;
			}

			if (key.escape) {
				// 子视图内 ESC 仅收起回到默认视图。
				if (thinkingInputMode) {
					setThinkingInputMode(null);
					setThinkingInputValue('');
					return;
				}
				if (isThinkingEffortSelecting) {
					setIsThinkingEffortSelecting(false);
					return;
				}
				if (manualInputMode) {
					setManualInputMode(false);
					setManualInputValue('');
					setSearchTerm('');
					setHasStartedLoading(false);
					return;
				}
				if (isSelecting) {
					setIsSelecting(false);
					setSearchTerm('');
					setHasStartedLoading(false);
					return;
				}
				// 如果正在加载或已经开始加载流程，ESC 取消加载返回主视图
				if (loading || hasStartedLoading) {
					setHasStartedLoading(false);
					return;
				}

				// 如果在主视图，ESC 才关闭面板
				onClose();
				return;
			}

			// Thinking numeric input
			if (thinkingInputMode) {
				if (key.return) {
					const parsed = Number.parseInt(thinkingInputValue.trim(), 10);
					if (!Number.isNaN(parsed) && parsed >= 0) {
						if (thinkingInputMode === 'anthropicBudgetTokens') {
							void applyAnthropicBudgetTokens(parsed);
						} else {
							void applyGeminiBudget(parsed);
						}
					}
					setThinkingInputMode(null);
					setThinkingInputValue('');
					return;
				}

				if (key.backspace || key.delete) {
					setThinkingInputValue(prev => prev.slice(0, -1));
					return;
				}

				if (input && /[0-9]/.test(input)) {
					setThinkingInputValue(prev => prev + input);
				}
				return;
			}

			// Model manual input
			if (manualInputMode) {
				if (key.return) {
					handleManualSave();
					return;
				}

				if (key.backspace || key.delete) {
					setManualInputValue(prev => prev.slice(0, -1));
					return;
				}

				if (input && /[a-zA-Z0-9-_./:]/.test(input)) {
					setManualInputValue(prev => prev + input);
				}
				return;
			}

			// Model selecting filter input
			if (isSelecting) {
				if (input && /[a-zA-Z0-9-_.]/.test(input)) {
					setSearchTerm(prev => prev + input);
					return;
				}
				if (key.backspace || key.delete) {
					setSearchTerm(prev => prev.slice(0, -1));
				}
				return;
			}

			// In list selection modes, avoid switching tabs or triggering other actions.
			if (isThinkingEffortSelecting) {
				return;
			}

			if (key.tab) {
				setActiveTab(prev =>
					prev === 'advanced'
						? 'basic'
						: prev === 'basic'
						? 'thinking'
						: 'advanced',
				);
				return;
			}

			// 思考页的上下键和Enter键处理
			if (activeTab === 'thinking') {
				if (key.upArrow) {
					// 向上切换配置项（循环）
					setThinkingFocusIndex(prev => (prev === 0 ? 2 : prev - 1));
					return;
				}
				if (key.downArrow) {
					// 向下切换配置项（循环）
					setThinkingFocusIndex(prev => (prev === 2 ? 0 : prev + 1));
					return;
				}
				if (key.return) {
					// Enter键根据聚焦项执行不同操作
					if (thinkingFocusIndex === 0) {
						// 切换显示思考
						void applyShowThinking(!showThinking);
					} else if (thinkingFocusIndex === 1) {
						// 切换启用思考
						void applyThinkingEnabled(!thinkingEnabledValue);
					} else if (thinkingFocusIndex === 2) {
						// 设置思考强度
						if (requestMethod === 'anthropic') {
							setThinkingInputMode('anthropicBudgetTokens');
							setThinkingInputValue(thinkingBudgetTokens.toString());
						} else if (requestMethod === 'gemini') {
							setThinkingInputMode('geminiThinkingBudget');
							setThinkingInputValue(geminiThinkingBudget.toString());
						} else if (requestMethod === 'responses') {
							setIsThinkingEffortSelecting(true);
						} else {
							setErrorMessage(
								t.modelsPanel.requestMethodNotSupportedForThinkingStrength.replace(
									'{requestMethod}',
									requestMethod,
								),
							);
						}
					}
					return;
				}
				return;
			}

			if (key.return) {
				setErrorMessage('');

				// 标记已开始加载流程
				setHasStartedLoading(true);
				void loadModels()
					.then(() => setIsSelecting(true))
					.catch(() => {
						setManualInputMode(true);
						setManualInputValue(currentModel);
					});
				return;
			}

			if ((input === 'm' || input === 'M') && isModelTab) {
				setManualInputMode(true);
				setManualInputValue(currentModel);
			}
		},
		{isActive: visible},
	);

	if (!visible) {
		return null;
	}

	return (
		<Box flexDirection="column" paddingX={1} paddingY={0}>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.warning}>
					{t.modelsPanel.title}
				</Text>
				<Text dimColor> - </Text>
				<Text color={theme.colors.menuInfo}>{t.modelsPanel.subtitle}</Text>
			</Box>

			<Box marginBottom={1}>
				<Text
					bold={activeTab === 'advanced'}
					color={
						activeTab === 'advanced'
							? theme.colors.menuNormal
							: theme.colors.menuSecondary
					}
					backgroundColor={
						activeTab === 'advanced' ? tabActiveBackground : undefined
					}
				>
					{t.modelsPanel.tabAdvanced}
				</Text>
				<Text> </Text>
				<Text
					bold={activeTab === 'basic'}
					color={
						activeTab === 'basic'
							? theme.colors.menuNormal
							: theme.colors.menuSecondary
					}
					backgroundColor={
						activeTab === 'basic' ? tabActiveBackground : undefined
					}
				>
					{t.modelsPanel.tabBasic}
				</Text>
				<Text> </Text>
				<Text
					bold={activeTab === 'thinking'}
					color={
						activeTab === 'thinking'
							? theme.colors.menuNormal
							: theme.colors.menuSecondary
					}
					backgroundColor={
						activeTab === 'thinking' ? tabActiveBackground : undefined
					}
				>
					{t.modelsPanel.tabThinking}
				</Text>
			</Box>

			{loading && activeTab !== 'thinking' && (
				<Box>
					<Spinner type="dots" />
					<Text color={theme.colors.menuInfo}>
						{' '}
						{t.modelsPanel.loadingModels}
					</Text>
				</Box>
			)}

			{errorMessage && !loading && (
				<Box flexDirection="column">
					<Text color={theme.colors.warning}>{t.modelsPanel.tipLabel}</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{errorMessage}
					</Text>
				</Box>
			)}

			{activeTab === 'thinking' ? (
				<Box flexDirection="column" paddingX={1} paddingY={0}>
					<Box>
						<Text color={theme.colors.menuInfo}>
							{t.modelsPanel.requestMethod}
						</Text>
						<Text color={theme.colors.menuSelected}> {requestMethod}</Text>
					</Box>
					<Box marginTop={1}>
						<Text
							color={
								thinkingFocusIndex === 0
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{thinkingFocusIndex === 0 ? '❯ ' : '  '}
							{t.modelsPanel.showThinkingProcess}
						</Text>
						<Text color={theme.colors.menuSelected}>
							{' '}
							{showThinking ? '[✓]' : '[ ]'}
						</Text>
					</Box>
					<Box>
						<Text
							color={
								thinkingFocusIndex === 1
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{thinkingFocusIndex === 1 ? '❯ ' : '  '}
							{t.modelsPanel.enableThinking}
						</Text>
						<Text color={theme.colors.menuSelected}>
							{' '}
							{thinkingEnabledValue ? '[✓]' : '[ ]'}
						</Text>
					</Box>
					<Box>
						<Text
							color={
								thinkingFocusIndex === 2
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{thinkingFocusIndex === 2 ? '❯ ' : '  '}
							{t.modelsPanel.thinkingStrength}
						</Text>
						<Text color={theme.colors.menuSelected}>
							{' '}
							{thinkingStrengthValue}
						</Text>
					</Box>

					{thinkingInputMode && (
						<Box flexDirection="column" marginTop={1}>
							<Text color={theme.colors.menuInfo}>
								{t.modelsPanel.inputNumberHint}
							</Text>
							<Box marginLeft={1}>
								<Text color={theme.colors.menuSelected}>
									{`❯ ${thinkingInputValue}`}
									<Text color={theme.colors.menuNormal}>_</Text>
								</Text>
							</Box>
							<Box>
								<Text dimColor color={theme.colors.menuSecondary}>
									{t.modelsPanel.escCancel}
								</Text>
							</Box>
						</Box>
					)}

					{isThinkingEffortSelecting && (
						<Box marginTop={1}>
							<ScrollableSelectInput
								items={(
									[
										{label: 'low', value: 'low'},
										{label: 'medium', value: 'medium'},
										{label: 'high', value: 'high'},
										{label: 'xhigh', value: 'xhigh'},
									] as Array<{label: string; value: ResponsesReasoningEffort}>
								).map(i => ({
									label: i.label,
									value: i.value,
								}))}
								limit={6}
								disableNumberShortcuts={true}
								initialIndex={Math.max(
									0,
									(['low', 'medium', 'high', 'xhigh'] as const).indexOf(
										responsesReasoningEffort,
									),
								)}
								isFocused={true}
								onSelect={item => {
									void applyResponsesEffort(
										item.value as ResponsesReasoningEffort,
									);
									setIsThinkingEffortSelecting(false);
								}}
							/>
						</Box>
					)}

					{!thinkingInputMode && !isThinkingEffortSelecting && (
						<Box marginTop={1}>
							<Text dimColor color={theme.colors.menuSecondary}>
								{t.modelsPanel.navigationHint}
							</Text>
						</Box>
					)}
				</Box>
			) : manualInputMode ? (
				<Box flexDirection="column" paddingX={1} paddingY={0}>
					<Text color={theme.colors.menuInfo}>
						{t.modelsPanel.manualInputTitle}
						{currentLabel}
					</Text>
					<Box marginLeft={1}>
						<Text color={theme.colors.menuSelected}>
							{`❯ ${manualInputValue}`}
							<Text color={theme.colors.menuNormal}>_</Text>
						</Text>
					</Box>
					<Box>
						<Text dimColor color={theme.colors.menuSecondary}>
							{t.modelsPanel.manualInputHint}
						</Text>
					</Box>
				</Box>
			) : isSelecting ? (
				<Box flexDirection="column" paddingX={1} paddingY={0}>
					{searchTerm && (
						<Text color={theme.colors.menuInfo}>
							{t.modelsPanel.filterLabel} {searchTerm}
						</Text>
					)}
					<ScrollableSelectInput
						items={currentOptions}
						limit={10}
						disableNumberShortcuts={true}
						initialIndex={selectedIndex}
						isFocused={true}
						onSelect={item => handleModelSelect(item.value)}
					/>
				</Box>
			) : (
				<Box flexDirection="column" paddingX={1} paddingY={0}>
					<Box>
						<Text color={theme.colors.menuInfo}>
							{t.modelsPanel.currentModel}
						</Text>
						<Text color={theme.colors.menuSelected}>
							{' '}
							{currentModel || t.modelsPanel.notSet}
						</Text>
					</Box>
					<Box>
						<Text dimColor color={theme.colors.menuSecondary}>
							{t.modelsPanel.hint}
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
};
