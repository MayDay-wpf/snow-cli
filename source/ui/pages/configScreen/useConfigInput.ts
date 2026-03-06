import {useInput} from 'ink';
import {stripFocusArtifacts, isFocusEventInput, isSelectField} from './types.js';
import type {ConfigStateReturn} from './useConfigState.js';

export function useConfigInput(
	state: ConfigStateReturn,
	callbacks: {onBack: () => void; onSave: () => void},
) {
	const {onBack, onSave} = callbacks;
	const {
		t,
		profileMode,
		setProfileMode,
		setNewProfileName,
		markedProfiles,
		setErrors,
		handleCreateProfile,
		handleBatchDeleteProfiles,
		loading,
		setLoading,
		manualInputMode,
		setManualInputMode,
		manualInputValue,
		setManualInputValue,
		isEditing,
		setIsEditing,
		currentField,
		setCurrentField,
		setSearchTerm,
		setPendingPromptIds,
		triggerForceUpdate,
		saveConfiguration,
		loadModels,
		getCurrentValue,
		getAllFields,
		anthropicBeta,
		setAnthropicBeta,
		enableAutoCompress,
		setEnableAutoCompress,
		showThinking,
		setShowThinking,
		thinkingEnabled,
		setThinkingEnabled,
		geminiThinkingEnabled,
		setGeminiThinkingEnabled,
		responsesReasoningEnabled,
		setResponsesReasoningEnabled,
		responsesFastMode,
		setResponsesFastMode,
		maxContextTokens,
		setMaxContextTokens,
		maxTokens,
		setMaxTokens,
		streamIdleTimeoutSec,
		setStreamIdleTimeoutSec,
		toolResultTokenLimit,
		setToolResultTokenLimit,
		thinkingBudgetTokens,
		setThinkingBudgetTokens,
		autoCompressThreshold,
		setAutoCompressThreshold,
		geminiThinkingBudget,
		setGeminiThinkingBudget,
		editSimilarityThreshold,
		setEditSimilarityThreshold,
		editingThresholdValue,
		setEditingThresholdValue,
		setAdvancedModel,
		setBasicModel,
		systemPromptId,
	} = state;

	useInput((rawInput, key) => {
		const input = stripFocusArtifacts(rawInput);

		if (!input && isFocusEventInput(rawInput)) {
			return;
		}

		if (isFocusEventInput(rawInput)) {
			return;
		}

		// Handle profile creation mode
		if (profileMode === 'creating') {
			if (key.return) {
				handleCreateProfile();
			} else if (key.escape) {
				setProfileMode('normal');
				setNewProfileName('');
				setErrors([]);
			}
			return;
		}

		// Handle profile deletion confirmation
		if (profileMode === 'deleting') {
			if (input === 'y' || input === 'Y') {
				handleBatchDeleteProfiles();
			} else if (input === 'n' || input === 'N' || key.escape) {
				setProfileMode('normal');
				setErrors([]);
			}
			return;
		}

		// Handle profile shortcuts
		if (
			profileMode === 'normal' &&
			currentField === 'profile' &&
			(input === 'n' || input === 'N')
		) {
			setProfileMode('creating');
			setNewProfileName('');
			setIsEditing(false);
			return;
		}

		if (
			profileMode === 'normal' &&
			currentField === 'profile' &&
			(input === 'd' || input === 'D')
		) {
			if (markedProfiles.size === 0) {
				setErrors([t.configScreen.noProfilesMarked]);
				setIsEditing(false);
				return;
			}
			if (markedProfiles.has('default')) {
				setErrors([t.configScreen.cannotDeleteDefault]);
				setIsEditing(false);
				return;
			}
			setProfileMode('deleting');
			setIsEditing(false);
			return;
		}

		// Handle loading state
		if (loading) {
			if (key.escape) {
				setLoading(false);
			}
			return;
		}

		// Handle manual input mode
		if (manualInputMode) {
			if (key.return) {
				const cleaned = stripFocusArtifacts(manualInputValue).trim();
				if (cleaned) {
					if (currentField === 'advancedModel') {
						setAdvancedModel(cleaned);
					} else if (currentField === 'basicModel') {
						setBasicModel(cleaned);
					}
				}
				setManualInputMode(false);
				setManualInputValue('');
				setIsEditing(false);
				setSearchTerm('');
			} else if (key.escape) {
				setManualInputMode(false);
				setManualInputValue('');
			} else if (key.backspace || key.delete) {
				setManualInputValue(prev => prev.slice(0, -1));
			} else if (input) {
				setManualInputValue(prev => prev + stripFocusArtifacts(input));
			}
			return;
		}

		// Allow Escape key to exit Select component
		if (isEditing && isSelectField(currentField) && key.escape) {
			setIsEditing(false);
			setSearchTerm('');
			if (currentField === 'systemPromptId') {
				setPendingPromptIds(new Set());
			}
			triggerForceUpdate();
			return;
		}

		// Handle editing mode
		if (isEditing) {
			if (currentField === 'baseUrl' || currentField === 'apiKey') {
				if (key.return) {
					setIsEditing(false);
				}
				return;
			}

			// Handle numeric / decimal input
			if (
				currentField === 'maxContextTokens' ||
				currentField === 'maxTokens' ||
				currentField === 'streamIdleTimeoutSec' ||
				currentField === 'toolResultTokenLimit' ||
				currentField === 'thinkingBudgetTokens' ||
				currentField === 'geminiThinkingBudget' ||
				currentField === 'autoCompressThreshold' ||
				currentField === 'editSimilarityThreshold'
			) {
				if (currentField === 'editSimilarityThreshold') {
					handleThresholdInput(input, key);
					return;
				}

				handleNumericInput(input, key);
				return;
			}

			// Allow typing to filter for model selection
			if (input && input.match(/[a-zA-Z0-9-_.]/)) {
				setSearchTerm(prev => prev + input);
			} else if (key.backspace || key.delete) {
				setSearchTerm(prev => prev.slice(0, -1));
			}
			return;
		}

		// Handle save/exit globally
		if (input === 's' && (key.ctrl || key.meta)) {
			saveConfiguration().then(success => {
				if (success) {
					onSave();
				}
			});
		} else if (key.escape) {
			saveConfiguration().then(() => onBack());
		} else if (key.return) {
			handleEnterKey();
		} else if (input === 'm' && !isEditing) {
			if (currentField === 'advancedModel' || currentField === 'basicModel') {
				setManualInputMode(true);
				setManualInputValue(getCurrentValue());
			}
		} else if (!isEditing && key.upArrow) {
			const fields = getAllFields();
			const currentIndex = fields.indexOf(currentField);
			const nextIndex = currentIndex > 0 ? currentIndex - 1 : fields.length - 1;
			setCurrentField(fields[nextIndex]!);
		} else if (!isEditing && key.downArrow) {
			const fields = getAllFields();
			const currentIndex = fields.indexOf(currentField);
			const nextIndex = currentIndex < fields.length - 1 ? currentIndex + 1 : 0;
			setCurrentField(fields[nextIndex]!);
		}
	});

	function handleThresholdInput(
		input: string,
		key: {
			return: boolean;
			backspace: boolean;
			delete: boolean;
			[k: string]: any;
		},
	) {
		if (input && input.match(/[0-9.]/)) {
			const currentStr =
				editingThresholdValue || editSimilarityThreshold.toString();
			if (input === '.' && currentStr.includes('.')) {
				return;
			}
			const newStr = currentStr + input;
			if (
				newStr === '.' ||
				newStr === '0.' ||
				/^[0-9]*\.?[0-9]*$/.test(newStr)
			) {
				setEditingThresholdValue(newStr);
			}
		} else if (key.backspace || key.delete) {
			const currentStr =
				editingThresholdValue || editSimilarityThreshold.toString();
			const newStr = currentStr.slice(0, -1);
			setEditingThresholdValue(newStr);
		} else if (key.return) {
			const valueToSave =
				editingThresholdValue || editSimilarityThreshold.toString();
			const finalValue = parseFloat(valueToSave);
			if (!isNaN(finalValue) && finalValue >= 0.1 && finalValue <= 1) {
				setEditSimilarityThreshold(finalValue);
			} else if (finalValue < 0.1) {
				setEditSimilarityThreshold(0.1);
			}
			setEditingThresholdValue('');
			setIsEditing(false);
		}
	}

	function handleNumericInput(
		input: string,
		key: {
			return: boolean;
			backspace: boolean;
			delete: boolean;
			[k: string]: any;
		},
	) {
		const fieldMap: Record<
			string,
			{get: () => number; set: (v: number) => void; min: number; max: number}
		> = {
			maxContextTokens: {
				get: () => maxContextTokens,
				set: setMaxContextTokens,
				min: 4000,
				max: Infinity,
			},
			maxTokens: {
				get: () => maxTokens,
				set: setMaxTokens,
				min: 100,
				max: Infinity,
			},
			streamIdleTimeoutSec: {
				get: () => streamIdleTimeoutSec,
				set: setStreamIdleTimeoutSec,
				min: 1,
				max: Infinity,
			},
			toolResultTokenLimit: {
				get: () => toolResultTokenLimit,
				set: setToolResultTokenLimit,
				min: 1000,
				max: Infinity,
			},
			thinkingBudgetTokens: {
				get: () => thinkingBudgetTokens,
				set: setThinkingBudgetTokens,
				min: 1000,
				max: Infinity,
			},
			autoCompressThreshold: {
				get: () => autoCompressThreshold,
				set: setAutoCompressThreshold,
				min: 50,
				max: 95,
			},
			geminiThinkingBudget: {
				get: () => geminiThinkingBudget,
				set: setGeminiThinkingBudget,
				min: 1,
				max: Infinity,
			},
		};

		const config = fieldMap[currentField];
		if (!config) return;

		if (input && input.match(/[0-9]/)) {
			const newValue = parseInt(config.get().toString() + input, 10);
			if (!isNaN(newValue)) {
				config.set(newValue);
			}
		} else if (key.backspace || key.delete) {
			const currentStr = config.get().toString();
			const newStr = currentStr.slice(0, -1);
			const newValue = parseInt(newStr, 10);
			config.set(!isNaN(newValue) ? newValue : 0);
		} else if (key.return) {
			const clampedValue = Math.min(
				Math.max(config.get(), config.min),
				config.max,
			);
			config.set(clampedValue);
			setIsEditing(false);
		}
	}

	function handleEnterKey() {
		if (isEditing) {
			setIsEditing(false);
			return;
		}

		// Toggle fields
		if (currentField === 'anthropicBeta') {
			setAnthropicBeta(!anthropicBeta);
		} else if (currentField === 'enableAutoCompress') {
			setEnableAutoCompress(!enableAutoCompress);
		} else if (currentField === 'showThinking') {
			setShowThinking(!showThinking);
		} else if (currentField === 'thinkingEnabled') {
			setThinkingEnabled(!thinkingEnabled);
		} else if (currentField === 'geminiThinkingEnabled') {
			setGeminiThinkingEnabled(!geminiThinkingEnabled);
		} else if (currentField === 'responsesReasoningEnabled') {
			setResponsesReasoningEnabled(!responsesReasoningEnabled);
		} else if (currentField === 'responsesFastMode') {
			setResponsesFastMode(!responsesFastMode);
		} else if (
			currentField === 'anthropicCacheTTL' ||
			currentField === 'thinkingMode' ||
			currentField === 'thinkingEffort' ||
			currentField === 'responsesReasoningEffort' ||
			currentField === 'responsesVerbosity'
		) {
			setIsEditing(true);
		} else if (
			currentField === 'maxContextTokens' ||
			currentField === 'maxTokens' ||
			currentField === 'streamIdleTimeoutSec' ||
			currentField === 'toolResultTokenLimit' ||
			currentField === 'thinkingBudgetTokens' ||
			currentField === 'geminiThinkingBudget' ||
			currentField === 'autoCompressThreshold'
		) {
			setIsEditing(true);
		} else if (currentField === 'editSimilarityThreshold') {
			setEditingThresholdValue('');
			setIsEditing(true);
		} else if (
			currentField === 'advancedModel' ||
			currentField === 'basicModel'
		) {
			loadModels()
				.then(() => {
					setIsEditing(true);
				})
				.catch(() => {
					setManualInputMode(true);
					setManualInputValue(getCurrentValue());
				});
		} else {
			if (currentField === 'systemPromptId') {
				if (Array.isArray(systemPromptId)) {
					setPendingPromptIds(new Set(systemPromptId));
				} else if (systemPromptId && systemPromptId !== '') {
					setPendingPromptIds(new Set([systemPromptId]));
				} else {
					setPendingPromptIds(new Set());
				}
			}
			setIsEditing(true);
		}
	}
}
