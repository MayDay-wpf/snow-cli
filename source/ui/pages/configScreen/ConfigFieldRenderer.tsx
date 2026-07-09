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
		// Group expansion
		apiConnectionExpanded,
		promptHeadersExpanded,
		displayCompressExpanded,
		reasoningExpanded,
		modelExpanded,
		tokenTimeoutExpanded,
		// Profile
		profiles,
		activeProfile,
		// API settings
		baseUrl,
		setBaseUrl,
		baseUrlMode,
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
		anthropicSpeed,
		setAnthropicSpeed,
		enableAutoCompress,
		autoCompressThreshold,
		showThinking,
		streamingDisplay,
		thinkingEnabled,
		thinkingMode,
		thinkingBudgetTokens,
		thinkingEffort,
		geminiThinkingEnabled,
		geminiThinkingLevel,
		setGeminiThinkingLevel,
		responsesReasoningEnabled,
		responsesReasoningEffort,
		setResponsesReasoningEffort,
		responsesVerbosity,
		setResponsesVerbosity,
		responsesFastMode,
		chatThinkingEnabled,
		chatReasoningEffort,
		supportsXHigh,
		// Model settings
		advancedModel,
		basicModel,
		supportsVision,
		visionBaseUrl,
		setVisionBaseUrl,
		visionBaseUrlMode,
		visionApiKey,
		setVisionApiKey,
		visionRequestMethod,
		visionModel,
		maxContextTokens,
		maxTokens,
		streamIdleTimeoutSec,
		toolResultTokenLimit,
		maxRetries,
		retryDelayMs,
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
		case 'apiConnectionGroup':
		case 'promptHeadersGroup':
		case 'displayCompressGroup':
		case 'reasoningGroup':
		case 'modelGroup':
		case 'tokenTimeoutGroup':
			return renderGroupHeader(field);

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

		case 'baseUrlMode':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.baseUrlMode}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{baseUrlMode === 'base'
									? t.configScreen.baseUrlModeBase
									: baseUrlMode === 'endpoint'
									? t.configScreen.baseUrlModeEndpoint
									: t.configScreen.baseUrlModeAuto}
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
							{anthropicBeta ? t.configScreen.enabled : t.configScreen.disabled}{' '}
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

		case 'anthropicSpeed':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.anthropicSpeed}
					</Text>
					{isEditing && isActive ? (
						<Box marginLeft={3}>
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
								initialIndex={
									anthropicSpeed === 'fast'
										? 1
										: anthropicSpeed === 'standard'
										? 2
										: 0
								}
								isFocused={true}
								onSelect={item => {
									setAnthropicSpeed(
										item.value === '__NONE__'
											? undefined
											: (item.value as 'fast' | 'standard'),
									);
									state.setIsEditing(false);
								}}
							/>
						</Box>
					) : (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{anthropicSpeed === 'fast'
									? t.configScreen.anthropicSpeedFast
									: anthropicSpeed === 'standard'
									? t.configScreen.anthropicSpeedStandard
									: t.configScreen.anthropicSpeedNotUsed}
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
			{
				const actualThreshold = Math.floor(
					(maxContextTokens * autoCompressThreshold) / 100,
				);
				return (
					<Box key={field} flexDirection="column">
						<Text color={activeColor}>
							{activeIndicator}
							{t.configScreen.autoCompressThreshold}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									{t.configScreen.enterValue} {autoCompressThreshold}%
								</Text>
								<Text color={theme.colors.menuSecondary} dimColor>
									{t.configScreen.autoCompressThresholdHint
										?.replace('{percentage}', autoCompressThreshold.toString())
										.replace('{maxContext}', maxContextTokens.toString())
										.replace(
											'{actualThreshold}',
											actualThreshold.toLocaleString(),
										)}
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3} flexDirection="column">
								<Text color={theme.colors.menuSecondary}>
									{autoCompressThreshold}% → {actualThreshold.toLocaleString()}{' '}
									tokens
								</Text>
								{isActive && (
									<Text color={theme.colors.menuSecondary} dimColor>
										{t.configScreen.autoCompressThresholdDesc}
									</Text>
								)}
							</Box>
						)}
					</Box>
				);
			}
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
							{showThinking ? t.configScreen.enabled : t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'streamingDisplay':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.streamingDisplay}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{streamingDisplay
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

		case 'geminiThinkingLevel':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.geminiThinkingLevel}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Select
								options={[
									{label: 'MINIMAL', value: 'minimal'},
									{label: 'LOW', value: 'low'},
									{label: 'MEDIUM', value: 'medium'},
									{label: 'HIGH', value: 'high'},
								]}
								onChange={value => {
									setGeminiThinkingLevel(value);
									state.setIsEditing(false);
								}}
							/>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{geminiThinkingLevel.toUpperCase()}
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
									...(supportsXHigh ? [{label: 'XHIGH', value: 'xhigh'}] : []),
								]}
								onChange={value => {
									setResponsesReasoningEffort(value);
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
									setResponsesVerbosity(value as 'low' | 'medium' | 'high');
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

		case 'chatThinkingEnabled':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.chatThinkingEnabled}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{chatThinkingEnabled
								? t.configScreen.enabled
								: t.configScreen.disabled}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'chatReasoningEffort':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.chatReasoningEffort}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{chatReasoningEffort.toUpperCase()}
							</Text>
						</Box>
					)}
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

		case 'supportsVision':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.supportsVision}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{supportsVision
								? t.configScreen.supportsVisionYes
								: t.configScreen.supportsVisionNo}{' '}
							{t.configScreen.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'visionConfig':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.visionConfig}
					</Text>
					<Box marginLeft={3} flexDirection="column">
						<Text color={theme.colors.menuSecondary}>
							{t.configScreen.visionConfigSubtitle}
						</Text>
						{isActive && (
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.configScreen.visionConfigOpenHint}
							</Text>
						)}
					</Box>
				</Box>
			);

		case 'visionBaseUrl':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.visionBaseUrl}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<TextInput
								value={visionBaseUrl}
								onChange={value => setVisionBaseUrl(stripFocusArtifacts(value))}
								placeholder="https://api.openai.com/v1"
							/>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{visionBaseUrl || t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'visionBaseUrlMode':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.visionBaseUrlMode}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{visionBaseUrlMode === 'base'
									? t.configScreen.baseUrlModeBase
									: visionBaseUrlMode === 'endpoint'
									? t.configScreen.baseUrlModeEndpoint
									: t.configScreen.baseUrlModeAuto}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'visionApiKey':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.visionApiKey}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<TextInput
								value={visionApiKey}
								onChange={value => setVisionApiKey(stripFocusArtifacts(value))}
								placeholder="sk-..."
								mask="*"
							/>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{visionApiKey
									? '*'.repeat(Math.min(visionApiKey.length, 20))
									: t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'visionRequestMethod':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.visionRequestMethod}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{requestMethodOptions.find(
									opt => opt.value === visionRequestMethod,
								)?.label || t.configScreen.notSet}
							</Text>
						</Box>
					)}
				</Box>
			);

		case 'visionModel':
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.visionModel}
					</Text>
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{visionModel || t.configScreen.notSet}
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
			return renderNumericField(field, t.configScreen.maxTokens, maxTokens);

		case 'streamIdleTimeoutSec':
			return renderNumericField(
				field,
				t.configScreen.streamIdleTimeoutSec,
				streamIdleTimeoutSec,
			);

		case 'toolResultTokenLimit': {
			const actualLimit = Math.floor(
				(maxContextTokens * toolResultTokenLimit) / 100,
			);
			return (
				<Box key={field} flexDirection="column">
					<Text color={activeColor}>
						{activeIndicator}
						{t.configScreen.toolResultTokenLimit}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.configScreen.enterValue} {toolResultTokenLimit}%
							</Text>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.configScreen.toolResultTokenLimitHint
									?.replace('{percentage}', toolResultTokenLimit.toString())
									.replace('{maxContext}', maxContextTokens.toString())
									.replace('{actualLimit}', actualLimit.toLocaleString())}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3} flexDirection="column">
							<Text color={theme.colors.menuSecondary}>
								{toolResultTokenLimit}% → {actualLimit.toLocaleString()} tokens
							</Text>
							{isActive && (
								<Text color={theme.colors.menuSecondary} dimColor>
									{t.configScreen.toolResultTokenLimitDesc}
								</Text>
							)}
						</Box>
					)}
				</Box>
			);
		}

		case 'maxRetries':
			return renderNumericField(field, t.configScreen.maxRetries, maxRetries);

		case 'retryDelayMs':
			return renderNumericField(
				field,
				t.configScreen.retryDelayMs,
				retryDelayMs,
			);

		default:
			return null;
	}

	function renderGroupHeader(groupField: ConfigField) {
		let label: string;
		let expanded: boolean;
		switch (groupField) {
			case 'apiConnectionGroup':
				label = t.configScreen.apiConnectionGroup;
				expanded = apiConnectionExpanded;
				break;
			case 'promptHeadersGroup':
				label = t.configScreen.promptHeadersGroup;
				expanded = promptHeadersExpanded;
				break;
			case 'displayCompressGroup':
				label = t.configScreen.displayCompressGroup;
				expanded = displayCompressExpanded;
				break;
			case 'reasoningGroup':
				label = t.configScreen.reasoningGroup;
				expanded = reasoningExpanded;
				break;
			case 'modelGroup':
				label = t.configScreen.modelGroup;
				expanded = modelExpanded;
				break;
			case 'tokenTimeoutGroup':
				label = t.configScreen.tokenTimeoutGroup;
				expanded = tokenTimeoutExpanded;
				break;
			default:
				return null;
		}
		const groupColor = isActive
			? theme.colors.menuSelected
			: theme.colors.menuInfo;
		return (
			<Box key={groupField} flexDirection="column">
				<Text color={groupColor} bold>
					{activeIndicator}
					{expanded ? '▼ ' : '▶ '}
					{label}
				</Text>
				<Box marginLeft={3}>
					<Text color={theme.colors.menuSecondary}>
						{t.configScreen.groupExpandHint}
					</Text>
				</Box>
			</Box>
		);
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
