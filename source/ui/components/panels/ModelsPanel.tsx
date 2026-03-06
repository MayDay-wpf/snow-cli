import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {Alert} from '@inkjs/ui';
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

type ResponsesReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
type ResponsesVerbosity = 'low' | 'medium' | 'high';

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

	// 使用 ref 同步追踪选择状态，解决 ESC 键需要按两次的问题
	const isSelectingRef = useRef(false);
	const manualInputModeRef = useRef(false);

	// Thinking settings (aligned with ConfigScreen)
	const [requestMethod, setRequestMethod] = useState<RequestMethod>('chat');
	const [showThinking, setShowThinking] = useState(true);
	const [thinkingEnabled, setThinkingEnabled] = useState(false);
	const [thinkingMode, setThinkingMode] = useState<'tokens' | 'adaptive'>(
		'tokens',
	);
	const [thinkingBudgetTokens, setThinkingBudgetTokens] = useState(10000);
	const [thinkingEffort, setThinkingEffort] = useState<
		'low' | 'medium' | 'high' | 'max'
	>('high');
	const [geminiThinkingEnabled, setGeminiThinkingEnabled] = useState(false);
	const [geminiThinkingBudget, setGeminiThinkingBudget] = useState(1024);
	const [responsesReasoningEnabled, setResponsesReasoningEnabled] =
		useState(false);
	const [responsesReasoningEffort, setResponsesReasoningEffort] =
		useState<ResponsesReasoningEffort>('high');
	const [responsesFastMode, setResponsesFastMode] = useState(false);
	const [responsesVerbosity, setResponsesVerbosity] =
		useState<ResponsesVerbosity>('medium');

	// 思考页的聚焦索引，每种请求方案有独立的索引体系
	const [thinkingFocusIndex, setThinkingFocusIndex] = useState(0);
	const [thinkingInputMode, setThinkingInputMode] =
		useState<ThinkingInputMode>(null);
	const [thinkingInputValue, setThinkingInputValue] = useState('');
	const [isThinkingModeSelecting, setIsThinkingModeSelecting] = useState(false);
	const [isThinkingEffortSelecting, setIsThinkingEffortSelecting] =
		useState(false);
	const [isVerbositySelecting, setIsVerbositySelecting] = useState(false);

	useEffect(() => {
		if (!visible) {
			return;
		}

		setActiveTab('advanced');
		setLocalAdvancedModel(advancedModel);
		setLocalBasicModel(basicModel);

		// Reset transient UI state
		setIsSelecting(false);
		isSelectingRef.current = false;
		setSearchTerm('');
		setManualInputMode(false);
		manualInputModeRef.current = false;
		setManualInputValue('');
		setHasStartedLoading(false);
		setThinkingFocusIndex(0);
		setThinkingInputMode(null);
		setThinkingInputValue('');
		setIsThinkingEffortSelecting(false);
		setIsVerbositySelecting(false);
		setErrorMessage('');

		// Load thinking-related config on open
		const cfg = getOpenAiConfig();
		setRequestMethod(cfg.requestMethod || 'chat');
		setShowThinking(cfg.showThinking !== false); // default true
		setThinkingEnabled(
			cfg.thinking?.type === 'enabled' ||
				cfg.thinking?.type === 'adaptive' ||
				false,
		);
		setThinkingMode(cfg.thinking?.type === 'adaptive' ? 'adaptive' : 'tokens');
		setThinkingBudgetTokens(cfg.thinking?.budget_tokens || 10000);
		setThinkingEffort(cfg.thinking?.effort || 'high');
		setGeminiThinkingEnabled((cfg as any).geminiThinking?.enabled || false);
		setGeminiThinkingBudget((cfg as any).geminiThinking?.budget || 1024);
		setResponsesReasoningEnabled(
			(cfg as any).responsesReasoning?.enabled || false,
		);
		setResponsesReasoningEffort(
			(cfg as any).responsesReasoning?.effort || 'high',
		);
		setResponsesFastMode((cfg as any).responsesFastMode || false);
		setResponsesVerbosity((cfg as any).responsesVerbosity || 'medium');
	}, [visible, advancedModel, basicModel]);

	// Auto-hide error message after 3 seconds
	useEffect(() => {
		if (errorMessage) {
			const timer = setTimeout(() => {
				setErrorMessage('');
			}, 3000);
			return () => clearTimeout(timer);
		}
		return undefined;
	}, [errorMessage]);

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
				isSelectingRef.current = false;
				setIsSelecting(false);
				setSearchTerm('');
				manualInputModeRef.current = true;
				setManualInputMode(true);
				setManualInputValue(currentModel);
				setHasStartedLoading(false);
				return;
			}

			// 思考页不应该调用applyModel
			if (modelTarget !== 'thinking') {
				void applyModel(value, modelTarget);
			}
			isSelectingRef.current = false;
			setIsSelecting(false);
			setSearchTerm('');
			setHasStartedLoading(false);
		},
		[applyModel, currentModel, modelTarget],
	);

	const handleManualSave = useCallback(() => {
		const cleaned = manualInputValue.trim();
		if (cleaned && modelTarget !== 'thinking') {
			void applyModel(cleaned, modelTarget);
		}
		manualInputModeRef.current = false;
		setManualInputMode(false);
		setManualInputValue('');
		setSearchTerm('');
		setHasStartedLoading(false);
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
			return thinkingMode === 'adaptive'
				? thinkingEffort
				: String(thinkingBudgetTokens);
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
		thinkingMode,
		thinkingBudgetTokens,
		thinkingEffort,
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
							? thinkingMode === 'adaptive'
								? {type: 'adaptive' as const, effort: thinkingEffort}
								: {
										type: 'enabled' as const,
										budget_tokens: thinkingBudgetTokens,
								  }
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
			thinkingMode,
			thinkingBudgetTokens,
			thinkingEffort,
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
						? thinkingMode === 'adaptive'
							? {type: 'adaptive' as const, effort: thinkingEffort}
							: {type: 'enabled' as const, budget_tokens: next}
						: undefined,
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[thinkingEnabled, thinkingMode, thinkingEffort],
	);

	const applyThinkingMode = useCallback(
		async (next: 'tokens' | 'adaptive') => {
			setErrorMessage('');
			try {
				setThinkingMode(next);
				await updateOpenAiConfig({
					thinking: thinkingEnabled
						? next === 'adaptive'
							? {type: 'adaptive' as const, effort: thinkingEffort}
							: {type: 'enabled' as const, budget_tokens: thinkingBudgetTokens}
						: undefined,
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[thinkingEnabled, thinkingEffort, thinkingBudgetTokens],
	);

	const applyThinkingEffort = useCallback(
		async (next: 'low' | 'medium' | 'high' | 'max') => {
			setErrorMessage('');
			try {
				setThinkingEffort(next);
				await updateOpenAiConfig({
					thinking: thinkingEnabled
						? {type: 'adaptive' as const, effort: next}
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

	const applyResponsesVerbosity = useCallback(
		async (verbosity: ResponsesVerbosity) => {
			setErrorMessage('');
			try {
				setResponsesVerbosity(verbosity);
				await updateOpenAiConfig({
					responsesVerbosity: verbosity,
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[],
	);

	const applyResponsesFastMode = useCallback(async (next: boolean) => {
		setErrorMessage('');
		try {
			setResponsesFastMode(next);
			await updateOpenAiConfig({
				responsesFastMode: next,
			} as any);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : t.modelsPanel.saveFailed;
			setErrorMessage(message);
		}
	}, []);

	// 每种请求方案的最大聚焦索引（各自独立）
	// anthropic: 0=showThinking, 1=enableThinking, 2=thinkingMode, 3=thinkingStrength
	// gemini:    0=showThinking, 1=enableThinking, 2=thinkingStrength
	// responses: 0=showThinking, 1=enableThinking, 2=thinkingStrength, 3=verbosity, 4=fastMode
	// chat/other: 0=showThinking, 1=enableThinking
	const maxThinkingIndex = useMemo(() => {
		if (requestMethod === 'anthropic') return 3;
		if (requestMethod === 'responses') return 4;
		if (requestMethod === 'gemini') return 2;
		return 1;
	}, [requestMethod]);

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
				// 使用 ref 同步检查状态，避免 React 状态更新延迟导致需要按两次 ESC
				if (thinkingInputMode) {
					setThinkingInputMode(null);
					setThinkingInputValue('');
					return;
				}
				if (isThinkingModeSelecting) {
					setIsThinkingModeSelecting(false);
					return;
				}
				if (isThinkingEffortSelecting) {
					setIsThinkingEffortSelecting(false);
					return;
				}
				if (isVerbositySelecting) {
					setIsVerbositySelecting(false);
					return;
				}
				if (manualInputModeRef.current || manualInputMode) {
					manualInputModeRef.current = false;
					setManualInputMode(false);
					setManualInputValue('');
					setSearchTerm('');
					setHasStartedLoading(false);
					return;
				}
				if (isSelectingRef.current || isSelecting) {
					isSelectingRef.current = false;
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

				if (input) {
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
			if (isThinkingModeSelecting || isThinkingEffortSelecting || isVerbositySelecting) {
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
					setThinkingFocusIndex(prev =>
						prev === 0 ? maxThinkingIndex : prev - 1,
					);
					return;
				}
				if (key.downArrow) {
					setThinkingFocusIndex(prev =>
						prev === maxThinkingIndex ? 0 : prev + 1,
					);
					return;
				}
				if (key.return) {
					if (thinkingFocusIndex === 0) {
						void applyShowThinking(!showThinking);
					} else if (thinkingFocusIndex === 1) {
						void applyThinkingEnabled(!thinkingEnabledValue);
					} else if (thinkingFocusIndex === 2) {
						if (requestMethod === 'anthropic') {
							setIsThinkingModeSelecting(true);
						} else if (requestMethod === 'gemini') {
							setThinkingInputMode('geminiThinkingBudget');
							setThinkingInputValue(geminiThinkingBudget.toString());
						} else if (requestMethod === 'responses') {
							setIsThinkingEffortSelecting(true);
						}
					} else if (thinkingFocusIndex === 3) {
						if (requestMethod === 'anthropic') {
							if (thinkingMode === 'tokens') {
								setThinkingInputMode('anthropicBudgetTokens');
								setThinkingInputValue(thinkingBudgetTokens.toString());
							} else {
								setIsThinkingEffortSelecting(true);
							}
						} else if (requestMethod === 'responses') {
							setIsVerbositySelecting(true);
						}
					} else if (thinkingFocusIndex === 4) {
						if (requestMethod === 'responses') {
							void applyResponsesFastMode(!responsesFastMode);
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
					.then(() => {
						isSelectingRef.current = true;
						setIsSelecting(true);
					})
					.catch(() => {
						manualInputModeRef.current = true;
						setManualInputMode(true);
						setManualInputValue(currentModel);
					});
				return;
			}

			if ((input === 'm' || input === 'M') && isModelTab) {
				manualInputModeRef.current = true;
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
				<Alert variant="error">{errorMessage}</Alert>
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
					{(requestMethod === 'anthropic' ||
						requestMethod === 'gemini' ||
						requestMethod === 'responses') && (
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
					)}
					{requestMethod === 'anthropic' && (
						<Box>
							<Text
								color={
									thinkingFocusIndex === 2
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{thinkingFocusIndex === 2 ? '❯ ' : '  '}
								{t.configScreen.thinkingMode}
							</Text>
							<Text color={theme.colors.menuSelected}>
								{' '}
								{thinkingMode === 'tokens'
									? t.configScreen.thinkingModeTokens
									: t.configScreen.thinkingModeAdaptive}
							</Text>
						</Box>
					)}
					{(requestMethod === 'anthropic' ||
						requestMethod === 'gemini' ||
						requestMethod === 'responses') && (
						<Box>
							<Text
								color={
									thinkingFocusIndex ===
									(requestMethod === 'anthropic' ? 3 : 2)
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{thinkingFocusIndex ===
								(requestMethod === 'anthropic' ? 3 : 2)
									? '❯ '
									: '  '}
								{t.modelsPanel.thinkingStrength}
							</Text>
							<Text color={theme.colors.menuSelected}>
								{' '}
								{thinkingStrengthValue}
							</Text>
						</Box>
					)}
					{requestMethod === 'responses' && (
						<Box>
							<Text
								color={
									thinkingFocusIndex === 3
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{thinkingFocusIndex === 3 ? '❯ ' : '  '}
								{t.configScreen.responsesVerbosity}
							</Text>
							<Text color={theme.colors.menuSelected}>
								{' '}
								{responsesVerbosity.toUpperCase()}
							</Text>
						</Box>
					)}
					{requestMethod === 'responses' && (
						<Box>
							<Text
								color={
									thinkingFocusIndex === 4
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{thinkingFocusIndex === 4 ? '❯ ' : '  '}
								{t.configScreen.responsesFastMode}
							</Text>
							<Text color={theme.colors.menuSelected}>
								{' '}
								{responsesFastMode ? '[✓]' : '[ ]'}
							</Text>
						</Box>
					)}

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

					{isThinkingModeSelecting && (
						<Box marginTop={1}>
							<ScrollableSelectInput
								items={[
									{label: t.configScreen.thinkingModeTokens, value: 'tokens'},
									{
										label: t.configScreen.thinkingModeAdaptive,
										value: 'adaptive',
									},
								]}
								initialIndex={thinkingMode === 'tokens' ? 0 : 1}
								isFocused={true}
								onSelect={item => {
									void applyThinkingMode(item.value as 'tokens' | 'adaptive');
									setIsThinkingModeSelecting(false);
								}}
							/>
						</Box>
					)}

					{isThinkingEffortSelecting && (
						<Box marginTop={1}>
							<ScrollableSelectInput
								items={(requestMethod === 'anthropic'
									? [
											{label: 'low', value: 'low'},
											{label: 'medium', value: 'medium'},
											{label: 'high', value: 'high'},
											{label: 'max', value: 'max'},
									  ]
									: [
											{label: 'none', value: 'none'},
											{label: 'low', value: 'low'},
											{label: 'medium', value: 'medium'},
											{label: 'high', value: 'high'},
											{label: 'xhigh', value: 'xhigh'},
									  ]
								).map(i => ({
									label: i.label,
									value: i.value,
								}))}
								limit={6}
								disableNumberShortcuts={true}
								initialIndex={Math.max(
									0,
									requestMethod === 'anthropic'
										? (['low', 'medium', 'high', 'max'] as const).indexOf(
												thinkingEffort,
										  )
										: (['none', 'low', 'medium', 'high', 'xhigh'] as const).indexOf(
												responsesReasoningEffort,
										  ),
								)}
								isFocused={true}
								onSelect={item => {
									if (requestMethod === 'anthropic') {
										void applyThinkingEffort(
											item.value as 'low' | 'medium' | 'high' | 'max',
										);
									} else {
										void applyResponsesEffort(
											item.value as ResponsesReasoningEffort,
										);
									}
									setIsThinkingEffortSelecting(false);
								}}
							/>
						</Box>
					)}

					{isVerbositySelecting && (
						<Box marginTop={1}>
							<ScrollableSelectInput
								items={[
									{label: 'low', value: 'low'},
									{label: 'medium', value: 'medium'},
									{label: 'high', value: 'high'},
								]}
								limit={6}
								disableNumberShortcuts={true}
								initialIndex={Math.max(
									0,
									(['low', 'medium', 'high'] as const).indexOf(
										responsesVerbosity,
									),
								)}
								isFocused={true}
								onSelect={item => {
									void applyResponsesVerbosity(
										item.value as ResponsesVerbosity,
									);
									setIsVerbositySelecting(false);
								}}
							/>
						</Box>
					)}

					{!thinkingInputMode &&
						!isThinkingModeSelecting &&
						!isThinkingEffortSelecting &&
						!isVerbositySelecting && (
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
						isFocused={isSelecting}
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
