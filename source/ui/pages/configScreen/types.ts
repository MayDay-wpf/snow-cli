import type {RequestMethod} from '../../../utils/config/apiConfig.js';

export type ConfigField =
	| 'profile'
	| 'baseUrl'
	| 'apiKey'
	| 'requestMethod'
	| 'systemPromptId'
	| 'customHeadersSchemeId'
	| 'anthropicBeta'
	| 'anthropicCacheTTL'
	| 'enableAutoCompress'
	| 'autoCompressThreshold'
	| 'showThinking'
	| 'thinkingEnabled'
	| 'thinkingMode'
	| 'thinkingBudgetTokens'
	| 'thinkingEffort'
	| 'geminiThinkingEnabled'
	| 'geminiThinkingBudget'
	| 'responsesReasoningEnabled'
	| 'responsesReasoningEffort'
	| 'responsesVerbosity'
	| 'responsesFastMode'
	| 'advancedModel'
	| 'basicModel'
	| 'maxContextTokens'
	| 'maxTokens'
	| 'streamIdleTimeoutSec'
	| 'toolResultTokenLimit'
	| 'editSimilarityThreshold';

export type ProfileMode = 'normal' | 'creating' | 'deleting';

export type ConfigScreenProps = {
	onBack: () => void;
	onSave: () => void;
	inlineMode?: boolean;
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
	'requestMethod',
	'systemPromptId',
	'customHeadersSchemeId',
	'advancedModel',
	'basicModel',
	'thinkingMode',
	'thinkingEffort',
	'responsesReasoningEffort',
	'responsesVerbosity',
];

export const isSelectField = (field: ConfigField) =>
	SELECT_FIELDS.includes(field);

export const NUMERIC_FIELDS: ConfigField[] = [
	'maxContextTokens',
	'maxTokens',
	'streamIdleTimeoutSec',
	'toolResultTokenLimit',
	'thinkingBudgetTokens',
	'geminiThinkingBudget',
	'autoCompressThreshold',
	'editSimilarityThreshold',
];

export const TOGGLE_FIELDS: ConfigField[] = [
	'anthropicBeta',
	'enableAutoCompress',
	'showThinking',
	'thinkingEnabled',
	'geminiThinkingEnabled',
	'responsesReasoningEnabled',
	'responsesFastMode',
];

export type RequestMethodOption = {
	label: string;
	value: RequestMethod;
};
