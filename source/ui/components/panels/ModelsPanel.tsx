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
	getSnowConfig,
	updateSnowConfig,
	type RequestMethod,
	type ResponsesReasoningMode,
} from '../../../utils/config/apiConfig.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';
import {configEvents} from '../../../utils/config/configEvents.js';
import {setPickerActive} from '../../../utils/ui/pickerState.js';

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
	| 'thinkingEffort'
	| 'geminiThinkingLevel'
	| 'responsesReasoningEffort'
	| 'chatReasoningEffort';

type ResponsesReasoningEffort = string;
type ResponsesVerbosity = 'low' | 'medium' | 'high';

export const ModelsPanel: React.FC<Props> = ({
	advancedModel,
	basicModel,
	visible,
	onClose,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();

	const closePanel = useCallback(() => {
		setPickerActive(false);
		onClose();
	}, [onClose]);

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
	const [highlightedModelIndex, setHighlightedModelIndex] = useState(0);

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
	const [thinkingEffort, setThinkingEffort] = useState<string>('high');
	const [geminiThinkingEnabled, setGeminiThinkingEnabled] = useState(false);
	const [geminiThinkingLevel, setGeminiThinkingLevel] =
		useState<string>('high');
	const [isGeminiLevelSelecting, setIsGeminiLevelSelecting] = useState(false);
	const [responsesReasoningEnabled, setResponsesReasoningEnabled] =
		useState(false);
	const [responsesReasoningEffort, setResponsesReasoningEffort] =
		useState<ResponsesReasoningEffort>('high');
	const [responsesReasoningMode, setResponsesReasoningMode] = useState<
		ResponsesReasoningMode | undefined
	>(undefined);
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
	const [isResponsesModeSelecting, setIsResponsesModeSelecting] =
		useState(false);
	const [isVerbositySelecting, setIsVerbositySelecting] = useState(false);
	const [anthropicSpeed, setAnthropicSpeed] = useState<
		'fast' | 'standard' | undefined
	>(undefined);
	const [isSpeedSelecting, setIsSpeedSelecting] = useState(false);
	const [chatThinkingEnabled, setChatThinkingEnabled] = useState(false);
	const [chatReasoningEffort, setChatReasoningEffort] =
		useState<string>('high');
	const [isChatEffortSelecting, setIsChatEffortSelecting] = useState(false);

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
		setHighlightedModelIndex(0);
		setThinkingFocusIndex(0);
		setThinkingInputMode(null);
		setThinkingInputValue('');
		setIsThinkingEffortSelecting(false);
		setIsResponsesModeSelecting(false);
		setIsVerbositySelecting(false);
		setIsSpeedSelecting(false);
		setErrorMessage('');

		// Load thinking-related config on open
		const cfg = getSnowConfig();
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
		setGeminiThinkingLevel(
			(cfg as any).geminiThinking?.thinkingLevel || 'high',
		);
		setIsGeminiLevelSelecting(false);
		setResponsesReasoningEnabled(
			(cfg as any).responsesReasoning?.enabled || false,
		);
		setResponsesReasoningEffort(
			(cfg as any).responsesReasoning?.effort || 'high',
		);
		setResponsesReasoningMode(
			(cfg as any).responsesReasoning?.mode === 'standard' ||
				(cfg as any).responsesReasoning?.mode === 'pro'
				? (cfg as any).responsesReasoning.mode
				: undefined,
		);
		setResponsesFastMode((cfg as any).responsesFastMode || false);
		setResponsesVerbosity((cfg as any).responsesVerbosity || 'medium');
		setAnthropicSpeed((cfg as any).anthropicSpeed);
		setChatThinkingEnabled((cfg as any).chatThinking?.enabled || false);
		setChatReasoningEffort(
			(cfg as any).chatThinking?.reasoning_effort || 'high',
		);
		setIsChatEffortSelecting(false);
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
					await updateSnowConfig({advancedModel: value});
					setLocalAdvancedModel(value);
				} else {
					await updateSnowConfig({basicModel: value});
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

	const currentOptions = useMemo(() => {
		const seen = new Set<string>();
		const uniqueModels = filteredModels.filter(model => {
			if (seen.has(model.id)) return false;
			seen.add(model.id);
			return true;
		});
		return [
			{label: t.modelsPanel.manualInputOption, value: '__MANUAL_INPUT__'},
			...uniqueModels.map(model => ({
				label: model.id,
				value: model.id,
			})),
		];
	}, [filteredModels, t]);

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
		if (requestMethod === 'chat') {
			return chatThinkingEnabled;
		}
		return false;
	}, [
		requestMethod,
		thinkingEnabled,
		geminiThinkingEnabled,
		responsesReasoningEnabled,
		chatThinkingEnabled,
	]);

	const thinkingStrengthValue = useMemo(() => {
		if (requestMethod === 'anthropic') {
			return thinkingMode === 'adaptive'
				? thinkingEffort
				: String(thinkingBudgetTokens);
		}
		if (requestMethod === 'gemini') {
			return geminiThinkingLevel.toUpperCase();
		}
		if (requestMethod === 'responses') {
			return responsesReasoningEffort;
		}
		if (requestMethod === 'chat') {
			return chatReasoningEffort.toUpperCase();
		}
		return t.modelsPanel.notSupported;
	}, [
		requestMethod,
		thinkingMode,
		thinkingBudgetTokens,
		thinkingEffort,
		geminiThinkingLevel,
		responsesReasoningEffort,
		chatReasoningEffort,
		t,
	]);

	const applyShowThinking = useCallback(async (next: boolean) => {
		setErrorMessage('');
		try {
			setShowThinking(next);
			await updateSnowConfig({showThinking: next});
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

	const applyChatThinkingEnabled = useCallback(
		async (next: boolean) => {
			setErrorMessage('');
			try {
				if (!next && showThinking) {
					setShowThinking(false);
					await updateSnowConfig({showThinking: false});
					configEvents.emitConfigChange({type: 'showThinking', value: false});
				}
				setChatThinkingEnabled(next);
				await updateSnowConfig({
					chatThinking: next
						? {enabled: true, reasoning_effort: chatReasoningEffort}
						: undefined,
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[showThinking, chatReasoningEffort],
	);

	const applyThinkingEnabled = useCallback(
		async (next: boolean) => {
			setErrorMessage('');
			try {
				// Turning off thinking → auto turn off show thinking
				if (!next && showThinking) {
					setShowThinking(false);
					await updateSnowConfig({showThinking: false});
					configEvents.emitConfigChange({type: 'showThinking', value: false});
				}

				if (requestMethod === 'anthropic') {
					setThinkingEnabled(next);
					await updateSnowConfig({
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
					await updateSnowConfig({
						geminiThinking: next
							? {enabled: true, thinkingLevel: geminiThinkingLevel}
							: undefined,
					} as any);
					return;
				}
				if (requestMethod === 'responses') {
					setResponsesReasoningEnabled(next);
					await updateSnowConfig({
						responsesReasoning: {
							enabled: next,
							effort: responsesReasoningEffort,
							mode: responsesReasoningMode,
						},
					} as any);
					return;
				}
				if (requestMethod === 'chat') {
					void applyChatThinkingEnabled(next);
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
			showThinking,
			thinkingMode,
			thinkingBudgetTokens,
			thinkingEffort,
			geminiThinkingLevel,
			responsesReasoningEffort,
			responsesReasoningMode,
			applyChatThinkingEnabled,
			t,
		],
	);

	const applyAnthropicBudgetTokens = useCallback(
		async (next: number) => {
			setErrorMessage('');
			try {
				setThinkingBudgetTokens(next);
				await updateSnowConfig({
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
				await updateSnowConfig({
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
		async (next: string) => {
			setErrorMessage('');
			try {
				setThinkingEffort(next);
				await updateSnowConfig({
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

	const applyGeminiLevel = useCallback(
		async (next: string) => {
			setErrorMessage('');
			try {
				setGeminiThinkingLevel(next);
				await updateSnowConfig({
					geminiThinking: geminiThinkingEnabled
						? {enabled: true, thinkingLevel: next}
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
		async (effort: string) => {
			setErrorMessage('');
			try {
				setResponsesReasoningEffort(effort);
				await updateSnowConfig({
					responsesReasoning: {
						enabled: responsesReasoningEnabled,
						effort,
						mode: responsesReasoningMode,
					},
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[responsesReasoningEnabled, responsesReasoningMode],
	);

	const applyResponsesMode = useCallback(
		async (mode: ResponsesReasoningMode | undefined) => {
			setErrorMessage('');
			try {
				setResponsesReasoningMode(mode);
				await updateSnowConfig({
					responsesReasoning: {
						enabled: responsesReasoningEnabled,
						effort: responsesReasoningEffort,
						mode,
					},
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[responsesReasoningEnabled, responsesReasoningEffort],
	);

	const applyResponsesVerbosity = useCallback(
		async (verbosity: ResponsesVerbosity) => {
			setErrorMessage('');
			try {
				setResponsesVerbosity(verbosity);
				await updateSnowConfig({
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

	const applyChatReasoningEffort = useCallback(
		async (effort: string) => {
			setErrorMessage('');
			try {
				setChatReasoningEffort(effort);
				await updateSnowConfig({
					chatThinking: {
						enabled: chatThinkingEnabled,
						reasoning_effort: effort,
					},
				} as any);
			} catch (err) {
				const message =
					err instanceof Error ? err.message : t.modelsPanel.saveFailed;
				setErrorMessage(message);
			}
		},
		[chatThinkingEnabled],
	);

	const applyAnthropicSpeed = useCallback(
		async (next: 'fast' | 'standard' | undefined) => {
			setErrorMessage('');
			try {
				setAnthropicSpeed(next);
				await updateSnowConfig({
					anthropicSpeed: next,
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
			await updateSnowConfig({
				responsesFastMode: next,
			} as any);
		} catch (err) {
			const message =
				err instanceof Error ? err.message : t.modelsPanel.saveFailed;
			setErrorMessage(message);
		}
	}, []);

	// 每种请求方案的最大聚焦索引（各自独立）
	// anthropic: 0=showThinking, 1=enableThinking, 2=thinkingMode, 3=thinkingStrength, 4=anthropicSpeed
	// gemini:    0=showThinking, 1=enableThinking, 2=thinkingStrength
	// responses: 0=showThinking, 1=enableThinking, 2=thinkingStrength, 3=mode, 4=verbosity, 5=fastMode
	// chat:      0=showThinking, 1=enableThinking, 2=thinkingStrength
	// other:     0=showThinking, 1=enableThinking
	const maxThinkingIndex = useMemo(() => {
		if (requestMethod === 'anthropic') return 4;
		if (requestMethod === 'responses') return 5;
		if (requestMethod === 'gemini') return 2;
		if (requestMethod === 'chat') return 2;
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
				if (isGeminiLevelSelecting) {
					setIsGeminiLevelSelecting(false);
					return;
				}
				if (isThinkingEffortSelecting) {
					setIsThinkingEffortSelecting(false);
					return;
				}
				if (isResponsesModeSelecting) {
					setIsResponsesModeSelecting(false);
					return;
				}
				if (isVerbositySelecting) {
					setIsVerbositySelecting(false);
					return;
				}
				if (isSpeedSelecting) {
					setIsSpeedSelecting(false);
					return;
				}
				if (isChatEffortSelecting) {
					setIsChatEffortSelecting(false);
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
				closePanel();
				return;
			}

			// Thinking numeric input
			if (thinkingInputMode) {
				if (thinkingInputMode === 'anthropicBudgetTokens') {
					if (key.return) {
						const parsed = Number.parseInt(thinkingInputValue.trim(), 10);
						if (!Number.isNaN(parsed) && parsed >= 0) {
							void applyAnthropicBudgetTokens(parsed);
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

				// Text input mode for thinking effort fields
				if (key.return) {
					const cleaned = thinkingInputValue.trim();
					if (cleaned) {
						if (thinkingInputMode === 'thinkingEffort') {
							void applyThinkingEffort(cleaned);
						} else if (thinkingInputMode === 'geminiThinkingLevel') {
							void applyGeminiLevel(cleaned);
						} else if (thinkingInputMode === 'responsesReasoningEffort') {
							void applyResponsesEffort(cleaned);
						} else if (thinkingInputMode === 'chatReasoningEffort') {
							void applyChatReasoningEffort(cleaned);
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

				if (input && /[a-zA-Z0-9_-]/.test(input)) {
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
			if (
				isThinkingModeSelecting ||
				isGeminiLevelSelecting ||
				isThinkingEffortSelecting ||
				isResponsesModeSelecting ||
				isVerbositySelecting ||
				isSpeedSelecting ||
				isChatEffortSelecting
			) {
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
							setIsGeminiLevelSelecting(true);
						} else if (requestMethod === 'responses') {
							setIsThinkingEffortSelecting(true);
						} else if (requestMethod === 'chat') {
							setIsChatEffortSelecting(true);
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
							setIsResponsesModeSelecting(true);
						}
					} else if (thinkingFocusIndex === 4) {
						if (requestMethod === 'anthropic') {
							setIsSpeedSelecting(true);
						} else if (requestMethod === 'responses') {
							setIsVerbositySelecting(true);
						}
					} else if (
						thinkingFocusIndex === 5 &&
						requestMethod === 'responses'
					) {
						void applyResponsesFastMode(!responsesFastMode);
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
						requestMethod === 'responses' ||
						requestMethod === 'chat') && (
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
						requestMethod === 'responses' ||
						requestMethod === 'chat') && (
						<Box>
							<Text
								color={
									thinkingFocusIndex === (requestMethod === 'anthropic' ? 3 : 2)
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{thinkingFocusIndex === (requestMethod === 'anthropic' ? 3 : 2)
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
					{requestMethod === 'anthropic' && (
						<Box>
							<Text
								color={
									thinkingFocusIndex === 4
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{thinkingFocusIndex === 4 ? '❯ ' : '  '}
								{t.modelsPanel.anthropicSpeed}
							</Text>
							<Text color={theme.colors.menuSelected}>
								{' '}
								{anthropicSpeed === 'fast'
									? t.configScreen.anthropicSpeedFast
									: anthropicSpeed === 'standard'
									? t.configScreen.anthropicSpeedStandard
									: t.configScreen.anthropicSpeedNotUsed}
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
								{t.configScreen.responsesReasoningMode}
							</Text>
							<Text color={theme.colors.menuSelected}>
								{' '}
								{responsesReasoningMode ??
									t.configScreen.responsesReasoningModeNone}
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
									thinkingFocusIndex === 5
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{thinkingFocusIndex === 5 ? '❯ ' : '  '}
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
								{thinkingInputMode === 'anthropicBudgetTokens'
									? t.modelsPanel.inputNumberHint
									: t.modelsPanel.manualInputHint}
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
											{
												label: t.modelsPanel.manualInputOption,
												value: '__MANUAL_INPUT__',
											},
											{label: 'low', value: 'low'},
											{label: 'medium', value: 'medium'},
											{label: 'high', value: 'high'},
											{label: 'max', value: 'max'},
									  ]
									: [
											{
												label: t.modelsPanel.manualInputOption,
												value: '__MANUAL_INPUT__',
											},
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
												thinkingEffort as 'low' | 'medium' | 'high' | 'max',
										  )
										: (
												['none', 'low', 'medium', 'high', 'xhigh'] as const
										  ).indexOf(
												responsesReasoningEffort as
													| 'none'
													| 'low'
													| 'medium'
													| 'high'
													| 'xhigh',
										  ),
								)}
								isFocused={true}
								onSelect={item => {
									if (item.value === '__MANUAL_INPUT__') {
										if (requestMethod === 'anthropic') {
											setIsThinkingEffortSelecting(false);
											setThinkingInputMode('thinkingEffort');
											setThinkingInputValue(thinkingEffort);
										} else {
											setIsThinkingEffortSelecting(false);
											setThinkingInputMode('responsesReasoningEffort');
											setThinkingInputValue(responsesReasoningEffort);
										}
										return;
									}
									if (requestMethod === 'anthropic') {
										void applyThinkingEffort(item.value);
									} else {
										void applyResponsesEffort(item.value);
									}
									setIsThinkingEffortSelecting(false);
								}}
							/>
						</Box>
					)}

					{isResponsesModeSelecting && (
						<Box marginTop={1}>
							<ScrollableSelectInput
								items={[
									{
										label: t.configScreen.responsesReasoningModeNone,
										value: 'none',
									},
									{label: 'standard', value: 'standard'},
									{label: 'pro', value: 'pro'},
								]}
								limit={3}
								disableNumberShortcuts={true}
								initialIndex={Math.max(
									0,
									(['none', 'standard', 'pro'] as const).indexOf(
										responsesReasoningMode ?? 'none',
									),
								)}
								isFocused={true}
								onSelect={item => {
									void applyResponsesMode(
										item.value === 'none'
											? undefined
											: (item.value as ResponsesReasoningMode),
									);
									setIsResponsesModeSelecting(false);
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

					{isGeminiLevelSelecting && (
						<Box marginTop={1}>
							<ScrollableSelectInput
								items={[
									{
										label: t.modelsPanel.manualInputOption,
										value: '__MANUAL_INPUT__',
									},
									{label: 'MINIMAL', value: 'minimal'},
									{label: 'LOW', value: 'low'},
									{label: 'MEDIUM', value: 'medium'},
									{label: 'HIGH', value: 'high'},
								]}
								limit={6}
								disableNumberShortcuts={true}
								initialIndex={Math.max(
									0,
									(['minimal', 'low', 'medium', 'high'] as const).indexOf(
										geminiThinkingLevel as
											| 'minimal'
											| 'low'
											| 'medium'
											| 'high',
									),
								)}
								isFocused={true}
								onSelect={item => {
									if (item.value === '__MANUAL_INPUT__') {
										setIsGeminiLevelSelecting(false);
										setThinkingInputMode('geminiThinkingLevel');
										setThinkingInputValue(geminiThinkingLevel);
										return;
									}
									void applyGeminiLevel(item.value);
									setIsGeminiLevelSelecting(false);
								}}
							/>
						</Box>
					)}

					{isSpeedSelecting && (
						<Box marginTop={1}>
							<ScrollableSelectInput
								items={[
									{
										label: t.configScreen.anthropicSpeedNotUsed,
										value: '__NONE__',
									},
									{label: t.configScreen.anthropicSpeedFast, value: 'fast'},
									{
										label: t.configScreen.anthropicSpeedStandard,
										value: 'standard',
									},
								]}
								limit={6}
								disableNumberShortcuts={true}
								initialIndex={
									anthropicSpeed === 'fast'
										? 1
										: anthropicSpeed === 'standard'
										? 2
										: 0
								}
								isFocused={true}
								onSelect={item => {
									void applyAnthropicSpeed(
										item.value === '__NONE__'
											? undefined
											: (item.value as 'fast' | 'standard'),
									);
									setIsSpeedSelecting(false);
								}}
							/>
						</Box>
					)}

					{isChatEffortSelecting && (
						<Box marginTop={1}>
							<ScrollableSelectInput
								items={[
									{
										label: t.modelsPanel.manualInputOption,
										value: '__MANUAL_INPUT__',
									},
									{label: 'LOW', value: 'low'},
									{label: 'MEDIUM', value: 'medium'},
									{label: 'HIGH', value: 'high'},
									{label: 'MAX', value: 'max'},
								]}
								limit={6}
								disableNumberShortcuts={true}
								initialIndex={Math.max(
									0,
									(['low', 'medium', 'high', 'max'] as const).indexOf(
										chatReasoningEffort as 'low' | 'medium' | 'high' | 'max',
									),
								)}
								isFocused={true}
								onSelect={item => {
									if (item.value === '__MANUAL_INPUT__') {
										setIsChatEffortSelecting(false);
										setThinkingInputMode('chatReasoningEffort');
										setThinkingInputValue(chatReasoningEffort);
										return;
									}
									void applyChatReasoningEffort(item.value);
									setIsChatEffortSelecting(false);
								}}
							/>
						</Box>
					)}

					{!thinkingInputMode &&
						!isThinkingModeSelecting &&
						!isGeminiLevelSelecting &&
						!isThinkingEffortSelecting &&
						!isResponsesModeSelecting &&
						!isVerbositySelecting &&
						!isSpeedSelecting &&
						!isChatEffortSelecting && (
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
					<Box>
						{searchTerm && (
							<Text color={theme.colors.menuInfo}>
								{t.modelsPanel.filterLabel} {searchTerm}
								{'  '}
							</Text>
						)}
						<Text color={theme.colors.warning} bold>
							{t.modelsPanel.modelCount.replace(
								'{count}',
								(currentOptions.length - 1).toString(),
							)}
							{currentOptions.length > 10 &&
								` (${highlightedModelIndex + 1}/${currentOptions.length})`}
						</Text>
					</Box>
					<ScrollableSelectInput
						items={currentOptions}
						limit={10}
						disableNumberShortcuts={true}
						initialIndex={selectedIndex}
						isFocused={isSelecting}
						onSelect={item => handleModelSelect(item.value)}
						onHighlight={item => {
							const idx = currentOptions.findIndex(o => o.value === item.value);
							if (idx >= 0) setHighlightedModelIndex(idx);
						}}
					/>
					{currentOptions.length > 10 && (
						<Box>
							<Text dimColor color={theme.colors.menuSecondary}>
								{t.modelsPanel.scrollHint}
							</Text>
						</Box>
					)}
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

export default ModelsPanel;
