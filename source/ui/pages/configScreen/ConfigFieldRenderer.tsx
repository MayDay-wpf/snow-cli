import React from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import {Select} from '@inkjs/ui';
import ScrollableSelectInput from '../../components/common/ScrollableSelectInput.js';
import {stripFocusArtifacts, type ConfigField} from './types.js';
import type {ConfigStateReturn} from './useConfigState.js';

type Props = {
	field: ConfigField;
	state: ConfigStateReturn;
};

export default function ConfigFieldRenderer({field, state}: Props) {
	const {
		t,
		theme,
		currentField,
		isEditing,
		// Profile
		profiles,
		activeProfile,
		// API settings
		baseUrl,
		setBaseUrl,
		apiKey,
		setApiKey,
		requestMethod,
		requestMethodOptions,
		systemPromptId,
		activeSystemPromptIds,
		customHeadersSchemeId,
		activeCustomHeadersSchemeId,
		anthropicBeta,
		anthropicCacheTTL,
		setAnthropicCacheTTL,
		enableAutoCompress,
		autoCompressThreshold,
		showThinking,
		thinkingEnabled,
		thinkingMode,
		thinkingBudgetTokens,
		thinkingEffort,
		geminiThinkingEnabled,
		geminiThinkingBudget,
		responsesReasoningEnabled,
		responsesReasoningEffort,
		setResponsesReasoningEffort,
		responsesVerbosity,
		setResponsesVerbosity,
		responsesFastMode,
		supportsXHigh,
		// Model settings
		advancedModel,
		basicModel,
		maxContextTokens,
		maxTokens,
		streamIdleTimeoutSec,
		toolResultTokenLimit,
		editSimilarityThreshold,
		editingThresholdValue,
		// Helpers
		getSystemPromptNameById,
		getCustomHeadersSchemeNameById,
	} = state;

	const isActive = field === currentField;
	const isCurrentlyEditing = isEditing && isActive;

	const activeIndicator = isActive ? '❯ ' : '  ';
	const activeColor = isActive
		? theme.colors.menuSelected
		: theme.colors.menuNormal;

	switch (field) {
		case 'profile':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.profile}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{profiles.find(p => p.name === activeProfile)?.displayName ||
									activeProfile}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'baseUrl':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.baseUrl}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<TextInput
								value={baseUrl}
								onChange={value => setBaseUrl(stripFocusArtifacts(value))}
								placeholder="https://api.openai.com/v1"
							/>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{baseUrl || t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'apiKey':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.apiKey}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<TextInput
								value={apiKey}
								onChange={value => setApiKey(stripFocusArtifacts(value))}
								placeholder="sk-..."
								mask="*"
							/>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{apiKey
									? '*'.repeat(Math.min(apiKey.length, 20))
									: t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'requestMethod':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.requestMethod}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{requestMethodOptions.find(opt => opt.value === requestMethod)
									?.label || t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'systemPromptId': {
			let display = t.configScreen.followGlobalNone;
			if (systemPromptId === '') {
				display = t.configScreen.notUse;
			} else if (Array.isArray(systemPromptId) && systemPromptId.length > 0) {
				display = systemPromptId
					.map(id => getSystemPromptNameById(id))
					.join(', ');
			} else if (systemPromptId && typeof systemPromptId === 'string') {
				display = getSystemPromptNameById(systemPromptId);
			} else if (activeSystemPromptIds.length > 0) {
				const activeNames = activeSystemPromptIds
					.map(id => getSystemPromptNameById(id))
					.join(', ');
				display = t.configScreen.followGlobal.replace('{name}', activeNames);
			}
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.systemPrompt}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{display || t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);
		}

		case 'customHeadersSchemeId': {
			let display = t.configScreen.followGlobalNone;
			if (customHeadersSchemeId === '') {
				display = t.configScreen.notUse;
			} else if (customHeadersSchemeId) {
				display = getCustomHeadersSchemeNameById(customHeadersSchemeId);
			} else if (activeCustomHeadersSchemeId) {
				display = t.configScreen.followGlobal.replace(
					'{name}',
					getCustomHeadersSchemeNameById(activeCustomHeadersSchemeId),
				);
			}
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.customHeadersField}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{display || t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);
		}

		case 'anthropicBeta':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.anthropicBeta}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{anthropicBeta
								? t.configScreen.enabled
								: t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'anthropicCacheTTL':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.anthropicCacheTTL}
					</Text>
					{isEditing && isActive ? (
						<Box marginLeft={3}>
							<ScrollableSelectInput
								items={[
									{label: t.configScreen.anthropicCacheTTL5m, value: '5m'},
									{label: t.configScreen.anthropicCacheTTL1h, value: '1h'},
								]}
								initialIndex={anthropicCacheTTL === '5m' ? 0 : 1}
								isFocused={true}
								onSelect={item => {
									setAnthropicCacheTTL(item.value as '5m' | '1h');
									state.setIsEditing(false);
								}}
							/>
						</Box>
					) : (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{anthropicCacheTTL === '5m'
									? t.configScreen.anthropicCacheTTL5m
									: t.configScreen.anthropicCacheTTL1h}{' '}
								{t.configScreen.toggleHint}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'enableAutoCompress':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.enableAutoCompress}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{enableAutoCompress
								? t.configScreen.enabled
								: t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'autoCompressThreshold':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.autoCompressThreshold}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.configScreen.enterValue} {autoCompressThreshold}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{autoCompressThreshold}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'showThinking':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.showThinking}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{showThinking
								? t.configScreen.enabled
								: t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'thinkingEnabled':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.thinkingEnabled}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{thinkingEnabled
								? t.configScreen.enabled
								: t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'thinkingMode':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.thinkingMode}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{thinkingMode === 'tokens'
								? t.configScreen.thinkingModeTokens
								: t.configScreen.thinkingModeAdaptive}
						</Text>
					</Box>
				</Box>
			);

		case 'thinkingBudgetTokens':
			if (thinkingMode !== 'tokens') return null;
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.thinkingBudgetTokens}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.configScreen.enterValue} {thinkingBudgetTokens}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{thinkingBudgetTokens}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'thinkingEffort':
			if (thinkingMode !== 'adaptive') return null;
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.thinkingEffort}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>{thinkingEffort}</Text>
					</Box>
				</Box>
			);

		case 'geminiThinkingEnabled':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.geminiThinkingEnabled}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{geminiThinkingEnabled
								? t.configScreen.enabled
								: t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'geminiThinkingBudget':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.geminiThinkingBudget}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.configScreen.enterValue} {geminiThinkingBudget}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{geminiThinkingBudget}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'responsesReasoningEnabled':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.responsesReasoningEnabled}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{responsesReasoningEnabled
								? t.configScreen.enabled
								: t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'responsesReasoningEffort':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.responsesReasoningEffort}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{responsesReasoningEffort.toUpperCase()}
							</Text>
						</Box>
					)}
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Select
								options={[
									{label: 'NONE', value: 'none'},
									{label: 'LOW', value: 'low'},
									{label: 'MEDIUM', value: 'medium'},
									{label: 'HIGH', value: 'high'},
									...(supportsXHigh
										? [{label: 'XHIGH', value: 'xhigh'}]
										: []),
								]}
								onChange={value => {
									setResponsesReasoningEffort(
										value as 'none' | 'low' | 'medium' | 'high' | 'xhigh',
									);
									state.setIsEditing(false);
								}}
							/>
						</Box>
					)}
				</Box>
			);

		case 'responsesVerbosity':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.responsesVerbosity}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{responsesVerbosity.toUpperCase()}
							</Text>
						</Box>
					)}
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Select
								options={[
									{label: 'LOW', value: 'low'},
									{label: 'MEDIUM', value: 'medium'},
									{label: 'HIGH', value: 'high'},
								]}
								onChange={value => {
									setResponsesVerbosity(
										value as 'low' | 'medium' | 'high',
									);
									state.setIsEditing(false);
								}}
							/>
						</Box>
					)}
				</Box>
			);

		case 'responsesFastMode':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.responsesFastMode}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{responsesFastMode
								? t.configScreen.enabled
								: t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'advancedModel':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.advancedModel}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{advancedModel || t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'basicModel':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.basicModel}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{basicModel || t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'maxContextTokens':
			return renderNumericField(
				field,
				t.configScreen.maxContextTokens,
				maxContextTokens,
			);

		case 'maxTokens':
			return renderNumericField(
				field,
				t.configScreen.maxTokens,
				maxTokens,
			);

		case 'streamIdleTimeoutSec':
			return renderNumericField(
				field,
				t.configScreen.streamIdleTimeoutSec,
				streamIdleTimeoutSec,
			);

		case 'toolResultTokenLimit':
			return renderNumericField(
				field,
				t.configScreen.toolResultTokenLimit,
				toolResultTokenLimit,
			);

		case 'editSimilarityThreshold':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.editSimilarityThreshold}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.configScreen.enterValue}{' '}
								{editingThresholdValue || editSimilarityThreshold}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{editSimilarityThreshold}
							</Text>
						</Box>
					)}
				</Box>
			);

		default:
			return null;
	}

	function renderNumericField(
		fieldKey: ConfigField,
		label: string,
		value: number,
	) {
		return (
			<Box key={fieldKey} flexDirection="column">
				<Text color={activeColor}>
					{activeIndicator}
					{label}
				</Text>
				{isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuInfo}>
							{t.configScreen.enterValue} {value}
						</Text>
					</Box>
				)}
				{!isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>{value}</Text>
					</Box>
				)}
			</Box>
		);
	}
}
