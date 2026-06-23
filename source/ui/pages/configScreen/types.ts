import type {RequestMethod} from '../../../utils/config/apiConfig.js';

export type ConfigField =
	| 'profile'
	| 'apiConnectionGroup'
	| 'baseUrl'
	| 'baseUrlMode'
	| 'apiKey'
	| 'requestMethod'
	| 'promptHeadersGroup'
	| 'systemPromptId'
	| 'customHeadersSchemeId'
	| 'displayCompressGroup'
	| 'anthropicBeta'
	| 'anthropicCacheTTL'
	| 'anthropicSpeed'
	| 'enableAutoCompress'
	| 'autoCompressThreshold'
	| 'showThinking'
	| 'streamingDisplay'
	| 'reasoningGroup'
	| 'thinkingEnabled'
	| 'thinkingMode'
	| 'thinkingBudgetTokens'
	| 'thinkingEffort'
	| 'geminiThinkingEnabled'
	| 'geminiThinkingLevel'
	| 'responsesReasoningEnabled'
	| 'responsesReasoningEffort'
	| 'responsesVerbosity'
	| 'responsesFastMode'
	| 'chatThinkingEnabled'
	| 'chatReasoningEffort'
	| 'modelGroup'
	| 'advancedModel'
	| 'basicModel'
	| 'supportsVision'
	| 'visionConfig'
	| 'tokenTimeoutGroup'
	| 'visionBaseUrl'
	| 'visionBaseUrlMode'
	| 'visionApiKey'
	| 'visionRequestMethod'
	| 'visionModel'
	| 'maxContextTokens'
	| 'maxTokens'
	| 'streamIdleTimeoutSec'
	| 'toolResultTokenLimit'
	| 'streamingDisplay'
	| 'maxRetries'
	| 'retryDelayMs';

export const GROUP_FIELDS: ConfigField[] = [
	'apiConnectionGroup',
	'promptHeadersGroup',
	'displayCompressGroup',
	'reasoningGroup',
	'modelGroup',
	'tokenTimeoutGroup',
];

export const isGroupField = (field: ConfigField) =>
	GROUP_FIELDS.includes(field);

export type ProfileMode = 'normal' | 'creating' | 'renaming' | 'deleting';

export type ConfigScreenProps = {
	onBack: () => void;
	onSave: () => void;
	inlineMode?: boolean;
	/**
	 * 指定要编辑的 profile 名称。
	 * 提供时配置仅写回该 profile，不会切换或修改全局 active profile。
	 */
	targetProfileName?: string;
};

export const MAX_VISIBLE_FIELDS = 8;

const focusEventTokenRegex = /(?:\x1b)?\[[0-9;]*[IO]/g;

export const isFocusEventInput = (value?: string) => {
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

export const stripFocusArtifacts = (value: string) => {
	if (!value) {
		return '';
	}

	return value
		.replace(/\x1b\[[0-9;]*[IO]/g, '')
		.replace(/\[[0-9;]*[IO]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

export const SELECT_FIELDS: ConfigField[] = [
	'profile',
	'baseUrlMode',
	'requestMethod',
	'systemPromptId',
	'customHeadersSchemeId',
	'advancedModel',
	'basicModel',
	'visionBaseUrlMode',
	'visionRequestMethod',
	'visionModel',
	'thinkingMode',
	'thinkingEffort',
	'geminiThinkingLevel',
	'responsesReasoningEffort',
	'responsesVerbosity',
	'anthropicSpeed',
	'chatReasoningEffort',
];

export const isSelectField = (field: ConfigField) =>
	SELECT_FIELDS.includes(field);

export const NUMERIC_FIELDS: ConfigField[] = [
	'maxContextTokens',
	'maxTokens',
	'streamIdleTimeoutSec',
	'toolResultTokenLimit',
	'thinkingBudgetTokens',
	'autoCompressThreshold',
	'maxRetries',
	'retryDelayMs',
];

export const TOGGLE_FIELDS: ConfigField[] = [
	'anthropicBeta',
	'enableAutoCompress',
	'showThinking',
	'streamingDisplay',
	'thinkingEnabled',
	'geminiThinkingEnabled',
	'responsesReasoningEnabled',
	'responsesFastMode',
	'chatThinkingEnabled',
	'supportsVision',
];

export type RequestMethodOption = {
	label: string;
	value: RequestMethod;
};
