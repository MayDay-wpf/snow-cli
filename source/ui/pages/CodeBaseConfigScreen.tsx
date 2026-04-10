import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import Gradient from 'ink-gradient';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import ScrollableSelectInput from '../components/common/ScrollableSelectInput.js';
import {
	loadCodebaseConfig,
	saveCodebaseConfig,
	type CodebaseConfig,
} from '../../utils/config/codebaseConfig.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	onBack: () => void;
	onSave?: () => void;
	inlineMode?: boolean;
};

type ConfigField =
	| 'enabled'
	| 'enableAgentReview'
	| 'enableReranking'
	| 'embeddingSettings'
	| 'embeddingType'
	| 'embeddingModelName'
	| 'embeddingBaseUrl'
	| 'embeddingApiKey'
	| 'embeddingDimensions'
	| 'batchSettings'
	| 'batchMaxLines'
	| 'batchConcurrency'
	| 'chunkingMaxLinesPerChunk'
	| 'chunkingMinLinesPerChunk'
	| 'chunkingMinCharsPerChunk'
	| 'chunkingOverlapLines'
	| 'rerankingSettings'
	| 'rerankingModelName'
	| 'rerankingBaseUrl'
	| 'rerankingApiKey'
	| 'rerankingContextLength'
	| 'rerankingTopN';

const focusEventTokenRegex = /(?:\x1b)?\[[0-9;]*[IO]/g;

const isFocusEventInput = (value?: string) => {
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

const stripFocusArtifacts = (value: string) => {
	if (!value) {
		return '';
	}

	return value
		.replace(/\x1b\[[0-9;]*[IO]/g, '')
		.replace(/\[[0-9;]*[IO]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

export default function CodeBaseConfigScreen({
	onBack,
	onSave,
	inlineMode = false,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	// Configuration state
	const [enabled, setEnabled] = useState(false);
	const [enableAgentReview, setEnableAgentReview] = useState(true);
	const [enableReranking, setEnableReranking] = useState(false);
	const [embeddingType, setEmbeddingType] = useState<
		'jina' | 'ollama' | 'gemini'
	>('jina');
	const [embeddingModelName, setEmbeddingModelName] = useState('');
	const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('');
	const [embeddingApiKey, setEmbeddingApiKey] = useState('');
	const [embeddingDimensions, setEmbeddingDimensions] = useState(1536);
	const [batchMaxLines, setBatchMaxLines] = useState(10);
	const [batchConcurrency, setBatchConcurrency] = useState(1);
	const [chunkingMaxLinesPerChunk, setChunkingMaxLinesPerChunk] = useState(200);
	const [chunkingMinLinesPerChunk, setChunkingMinLinesPerChunk] = useState(10);
	const [chunkingMinCharsPerChunk, setChunkingMinCharsPerChunk] = useState(20);
	const [chunkingOverlapLines, setChunkingOverlapLines] = useState(20);
	const [rerankingModelName, setRerankingModelName] = useState('');
	const [rerankingBaseUrl, setRerankingBaseUrl] = useState('');
	const [rerankingApiKey, setRerankingApiKey] = useState('');
	const [rerankingContextLength, setRerankingContextLength] = useState(4096);
	const [rerankingTopN, setRerankingTopN] = useState(5);

	// UI state
	const [currentField, setCurrentField] = useState<ConfigField>('enabled');
	const [isEditing, setIsEditing] = useState(false);
	const [embeddingExpanded, setEmbeddingExpanded] = useState(false);
	const [batchExpanded, setBatchExpanded] = useState(false);
	const [rerankingExpanded, setRerankingExpanded] = useState(false);
	const [toastMessage, setToastMessage] = useState('');
	const [errors, setErrors] = useState<string[]>([]);

	// Scrolling configuration
	const MAX_VISIBLE_FIELDS = 8;

	const embeddingSubFields: ConfigField[] = [
		'embeddingType',
		'embeddingModelName',
		'embeddingBaseUrl',
		'embeddingApiKey',
		'embeddingDimensions',
	];

	const batchSubFields: ConfigField[] = [
		'batchMaxLines',
		'batchConcurrency',
		'chunkingMaxLinesPerChunk',
		'chunkingMinLinesPerChunk',
		'chunkingMinCharsPerChunk',
		'chunkingOverlapLines',
	];

	const rerankingSubFields: ConfigField[] = [
		'rerankingModelName',
		'rerankingBaseUrl',
		'rerankingApiKey',
		'rerankingContextLength',
		'rerankingTopN',
	];

	const allFields: ConfigField[] = [
		'enabled',
		'enableAgentReview',
		'enableReranking',
		'embeddingSettings',
		...(embeddingExpanded ? embeddingSubFields : []),
		'rerankingSettings',
		...(rerankingExpanded ? rerankingSubFields : []),
		'batchSettings',
		...(batchExpanded ? batchSubFields : []),
	];

	// Embedding type options
	const embeddingTypeOptions = [
		{label: 'Jina & OpenAI', value: 'jina' as const},
		{label: 'Ollama', value: 'ollama' as const},
		{label: 'Gemini', value: 'gemini' as const},
	];

	const currentFieldIndex = allFields.indexOf(currentField);
	const totalFields = allFields.length;

	const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showToast = useCallback((msg: string) => {
		if (toastTimerRef.current) {
			clearTimeout(toastTimerRef.current);
		}
		setToastMessage(msg);
		toastTimerRef.current = setTimeout(() => {
			setToastMessage('');
			toastTimerRef.current = null;
		}, 2000);
	}, []);

	useEffect(() => {
		loadConfiguration();
	}, []);

	useEffect(() => {
		return () => {
			if (toastTimerRef.current) {
				clearTimeout(toastTimerRef.current);
			}
		};
	}, []);

	const loadConfiguration = () => {
		const config = loadCodebaseConfig();
		setEnabled(config.enabled);
		setEnableAgentReview(config.enableAgentReview);
		setEnableReranking(config.enableReranking);
		setEmbeddingType(config.embedding.type || 'jina');
		setEmbeddingModelName(config.embedding.modelName);
		setEmbeddingBaseUrl(config.embedding.baseUrl);
		setEmbeddingApiKey(config.embedding.apiKey);
		setEmbeddingDimensions(config.embedding.dimensions);
		setBatchMaxLines(config.batch.maxLines);
		setBatchConcurrency(config.batch.concurrency);
		setChunkingMaxLinesPerChunk(config.chunking.maxLinesPerChunk);
		setChunkingMinLinesPerChunk(config.chunking.minLinesPerChunk);
		setChunkingMinCharsPerChunk(config.chunking.minCharsPerChunk);
		setChunkingOverlapLines(config.chunking.overlapLines);
		setRerankingModelName(config.reranking.modelName);
		setRerankingBaseUrl(config.reranking.baseUrl);
		setRerankingApiKey(config.reranking.apiKey);
		setRerankingContextLength(config.reranking.contextLength);
		setRerankingTopN(config.reranking.topN);
	};

	const saveConfiguration = () => {
		// Validation
		const validationErrors: string[] = [];

		if (enabled) {
			// Embedding configuration is required
			if (!embeddingModelName.trim()) {
				validationErrors.push(t.codebaseConfig.validationModelNameRequired);
			}
			if (!embeddingBaseUrl.trim()) {
				validationErrors.push(t.codebaseConfig.validationBaseUrlRequired);
				// Embedding API key is optional (for local deployments like Ollama)
				// if (!embeddingApiKey.trim()) {
				// 	validationErrors.push('Embedding API key is required when enabled');
				// }
			}
			if (embeddingDimensions <= 0) {
				validationErrors.push(t.codebaseConfig.validationDimensionsPositive);
			}

			// Batch configuration validation
			if (batchMaxLines <= 0) {
				validationErrors.push(t.codebaseConfig.validationMaxLinesPositive);
			}
			if (batchConcurrency <= 0) {
				validationErrors.push(t.codebaseConfig.validationConcurrencyPositive);
			}

			// Chunking configuration validation
			if (chunkingMaxLinesPerChunk <= 0) {
				validationErrors.push(
					t.codebaseConfig.validationMaxLinesPerChunkPositive,
				);
			}
			if (chunkingMinLinesPerChunk <= 0) {
				validationErrors.push(
					t.codebaseConfig.validationMinLinesPerChunkPositive,
				);
			}
			if (chunkingMinCharsPerChunk <= 0) {
				validationErrors.push(
					t.codebaseConfig.validationMinCharsPerChunkPositive,
				);
			}
			if (chunkingOverlapLines < 0) {
				validationErrors.push(
					t.codebaseConfig.validationOverlapLinesNonNegative,
				);
			}
			if (chunkingOverlapLines >= chunkingMaxLinesPerChunk) {
				validationErrors.push(
					t.codebaseConfig.validationOverlapLessThanMaxLines,
				);
			}

			// Reranking configuration validation
			if (enableReranking) {
				if (!rerankingModelName.trim()) {
					validationErrors.push(
						t.codebaseConfig.validationRerankingModelNameRequired,
					);
				}
				if (!rerankingBaseUrl.trim()) {
					validationErrors.push(
						t.codebaseConfig.validationRerankingBaseUrlRequired,
					);
				}
				if (rerankingContextLength <= 0) {
					validationErrors.push(
						t.codebaseConfig.validationRerankingContextLengthPositive,
					);
				}
				if (rerankingTopN <= 0) {
					validationErrors.push(
						t.codebaseConfig.validationRerankingTopNPositive,
					);
				}
			}
		}

		if (validationErrors.length > 0) {
			setErrors(validationErrors);
			return;
		}

		try {
			const config: CodebaseConfig = {
				enabled,
				enableAgentReview,
				enableReranking,
				embedding: {
					type: embeddingType,
					modelName: embeddingModelName,
					baseUrl: embeddingBaseUrl,
					apiKey: embeddingApiKey,
					dimensions: embeddingDimensions,
				},
				batch: {
					maxLines: batchMaxLines,
					concurrency: batchConcurrency,
				},
				chunking: {
					maxLinesPerChunk: chunkingMaxLinesPerChunk,
					minLinesPerChunk: chunkingMinLinesPerChunk,
					minCharsPerChunk: chunkingMinCharsPerChunk,
					overlapLines: chunkingOverlapLines,
				},
				reranking: {
					modelName: rerankingModelName,
					baseUrl: rerankingBaseUrl,
					apiKey: rerankingApiKey,
					contextLength: rerankingContextLength,
					topN: rerankingTopN,
				},
			};

			saveCodebaseConfig(config);
			setErrors([]);

			// Trigger codebase config reload in ChatScreen
			if ((global as any).__reloadCodebaseConfig) {
				(global as any).__reloadCodebaseConfig();
			}

			onSave?.();
		} catch (error) {
			setErrors([
				error instanceof Error ? error.message : t.codebaseConfig.saveError,
			]);
		}
	};

	const renderField = (field: ConfigField) => {
		const isActive = field === currentField;
		const isCurrentlyEditing = isActive && isEditing;

		switch (field) {
			case 'enabled':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.codebaseConfig.codebaseEnabled}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{enabled ? t.codebaseConfig.enabled : t.codebaseConfig.disabled}{' '}
								{t.codebaseConfig.toggleHint}
							</Text>
						</Box>
					</Box>
				);

			case 'enableAgentReview':
				return (
					<Box key={field} flexDirection="column">
						<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.codebaseConfig.agentReview}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{enableAgentReview
									? t.codebaseConfig.enabled
									: t.codebaseConfig.disabled}{' '}
								{t.codebaseConfig.toggleHint}
							</Text>
						</Box>
					</Box>
				);

		case 'enableReranking':
			return (
				<Box key={field} flexDirection="column">
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.rerankingToggle}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{enableReranking
								? t.codebaseConfig.enabled
								: t.codebaseConfig.disabled}{' '}
							{t.codebaseConfig.toggleHint}
						</Text>
					</Box>
				</Box>
			);

		case 'embeddingSettings':
			return (
				<Box key={field} flexDirection="column">
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{embeddingExpanded ? '▼ ' : '▶ '}
						{t.codebaseConfig.embeddingSettingsGroup}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{t.codebaseConfig.embeddingSettingsExpandHint}
						</Text>
					</Box>
				</Box>
			);

		case 'embeddingType':
			return (
				<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.embeddingType}
					</Text>
						{isEditing && isActive ? (
							<Box marginLeft={3}>
								<ScrollableSelectInput
									items={embeddingTypeOptions}
									initialIndex={embeddingTypeOptions.findIndex(
										opt => opt.value === embeddingType,
									)}
									isFocused={true}
									onSelect={item => {
										setEmbeddingType(
											item.value as 'jina' | 'ollama' | 'gemini',
										);
										setIsEditing(false);
									}}
								/>
							</Box>
						) : (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{embeddingTypeOptions.find(opt => opt.value === embeddingType)
										?.label || t.codebaseConfig.notSet}{' '}
									{t.codebaseConfig.toggleHint}
								</Text>
							</Box>
						)}
					</Box>
				);

		case 'embeddingModelName':
			return (
				<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.codebaseConfig.embeddingModelName}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									<TextInput
										value={embeddingModelName}
										onChange={value =>
											setEmbeddingModelName(stripFocusArtifacts(value))
										}
										onSubmit={() => setIsEditing(false)}
									/>
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{embeddingModelName || t.codebaseConfig.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);

		case 'embeddingBaseUrl':
			return (
				<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.codebaseConfig.embeddingBaseUrl}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									<TextInput
										value={embeddingBaseUrl}
										onChange={value =>
											setEmbeddingBaseUrl(stripFocusArtifacts(value))
										}
										onSubmit={() => setIsEditing(false)}
									/>
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{embeddingBaseUrl || t.codebaseConfig.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);

		case 'embeddingApiKey':
			return (
				<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.codebaseConfig.embeddingApiKeyOptional}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									<TextInput
										value={embeddingApiKey}
										onChange={value =>
											setEmbeddingApiKey(stripFocusArtifacts(value))
										}
										onSubmit={() => setIsEditing(false)}
										mask="*"
									/>
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{embeddingApiKey
										? t.codebaseConfig.masked
										: t.codebaseConfig.notSet}
								</Text>
							</Box>
						)}
					</Box>
				);

		case 'embeddingDimensions':
			return (
				<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
							color={
								isActive ? theme.colors.menuSelected : theme.colors.menuNormal
							}
						>
							{isActive ? '❯ ' : '  '}
							{t.codebaseConfig.embeddingDimensions}
						</Text>
						{isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo}>
									{t.codebaseConfig.enterValue} {embeddingDimensions}
								</Text>
							</Box>
						)}
						{!isCurrentlyEditing && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{embeddingDimensions}
								</Text>
							</Box>
						)}
					</Box>
				);

	case 'batchSettings':
		return (
			<Box key={field} flexDirection="column">
				<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{batchExpanded ? '▼ ' : '▶ '}
						{t.codebaseConfig.batchSettingsGroup}
					</Text>
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{t.codebaseConfig.batchSettingsExpandHint}
						</Text>
					</Box>
				</Box>
			);

	case 'batchMaxLines':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.batchMaxLines}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.codebaseConfig.enterValue} {batchMaxLines}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>{batchMaxLines}</Text>
						</Box>
					)}
				</Box>
			);

	case 'batchConcurrency':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.batchConcurrency}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.codebaseConfig.enterValue} {batchConcurrency}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{batchConcurrency}
							</Text>
						</Box>
					)}
				</Box>
			);
	case 'chunkingMaxLinesPerChunk':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.chunkingMaxLinesPerChunk}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.codebaseConfig.enterValue} {chunkingMaxLinesPerChunk}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{chunkingMaxLinesPerChunk}
							</Text>
						</Box>
					)}
				</Box>
			);

	case 'chunkingMinLinesPerChunk':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.chunkingMinLinesPerChunk}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.codebaseConfig.enterValue} {chunkingMinLinesPerChunk}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{chunkingMinLinesPerChunk}
							</Text>
						</Box>
					)}
				</Box>
			);

	case 'chunkingMinCharsPerChunk':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.chunkingMinCharsPerChunk}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.codebaseConfig.enterValue} {chunkingMinCharsPerChunk}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{chunkingMinCharsPerChunk}
							</Text>
						</Box>
					)}
				</Box>
			);

	case 'chunkingOverlapLines':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
					<Text
						color={
							isActive ? theme.colors.menuSelected : theme.colors.menuNormal
						}
					>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.chunkingOverlapLines}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								{t.codebaseConfig.enterValue} {chunkingOverlapLines}
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{chunkingOverlapLines}
							</Text>
						</Box>
					)}
				</Box>
			);
		case 'rerankingSettings':
		return (
			<Box key={field} flexDirection="column">
				<Text
					color={
						isActive ? theme.colors.menuSelected : theme.colors.menuNormal
					}
				>
					{isActive ? '❯ ' : '  '}
					{rerankingExpanded ? '▼ ' : '▶ '}
					{t.codebaseConfig.rerankingSettingsGroup}
				</Text>
				<Box marginLeft={3}>
					<Text color={theme.colors.menuSecondary}>
						{t.codebaseConfig.rerankingSettingsExpandHint}
					</Text>
				</Box>
			</Box>
		);

	case 'rerankingModelName':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
				<Text
					color={
						isActive ? theme.colors.menuSelected : theme.colors.menuNormal
					}
				>
					{isActive ? '❯ ' : '  '}
					{t.codebaseConfig.rerankingModelName}
				</Text>
				{isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuInfo}>
							<TextInput
								value={rerankingModelName}
								onChange={value =>
									setRerankingModelName(stripFocusArtifacts(value))
								}
								onSubmit={() => setIsEditing(false)}
							/>
						</Text>
					</Box>
				)}
				{!isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{rerankingModelName || t.codebaseConfig.notSet}
						</Text>
					</Box>
				)}
			</Box>
		);

	case 'rerankingBaseUrl':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
				<Text
					color={
						isActive ? theme.colors.menuSelected : theme.colors.menuNormal
					}
				>
					{isActive ? '❯ ' : '  '}
					{t.codebaseConfig.rerankingBaseUrl}
				</Text>
				{isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuInfo}>
							<TextInput
								value={rerankingBaseUrl}
								onChange={value =>
									setRerankingBaseUrl(stripFocusArtifacts(value))
								}
								onSubmit={() => setIsEditing(false)}
							/>
						</Text>
					</Box>
				)}
				{!isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{rerankingBaseUrl || t.codebaseConfig.notSet}
						</Text>
					</Box>
				)}
			</Box>
		);

	case 'rerankingApiKey':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
				<Text
					color={
						isActive ? theme.colors.menuSelected : theme.colors.menuNormal
					}
				>
					{isActive ? '❯ ' : '  '}
					{t.codebaseConfig.rerankingApiKey}
				</Text>
				{isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuInfo}>
							<TextInput
								value={rerankingApiKey}
								onChange={value =>
									setRerankingApiKey(stripFocusArtifacts(value))
								}
								onSubmit={() => setIsEditing(false)}
								mask="*"
							/>
						</Text>
					</Box>
				)}
				{!isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{rerankingApiKey
								? t.codebaseConfig.masked
								: t.codebaseConfig.notSet}
						</Text>
					</Box>
				)}
			</Box>
		);

	case 'rerankingContextLength':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
				<Text
					color={
						isActive ? theme.colors.menuSelected : theme.colors.menuNormal
					}
				>
					{isActive ? '❯ ' : '  '}
					{t.codebaseConfig.rerankingContextLength}
				</Text>
				{isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuInfo}>
							{t.codebaseConfig.enterValue} {rerankingContextLength}
						</Text>
					</Box>
				)}
				{!isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{rerankingContextLength}
						</Text>
					</Box>
				)}
			</Box>
		);

	case 'rerankingTopN':
		return (
			<Box key={field} flexDirection="column" marginLeft={2}>
				<Text
					color={
						isActive ? theme.colors.menuSelected : theme.colors.menuNormal
					}
				>
					{isActive ? '❯ ' : '  '}
					{t.codebaseConfig.rerankingTopN}
				</Text>
				{isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuInfo}>
							{t.codebaseConfig.enterValue} {rerankingTopN}
						</Text>
					</Box>
				)}
				{!isCurrentlyEditing && (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>
							{rerankingTopN}
						</Text>
					</Box>
				)}
			</Box>
		);

		default:
				return null;
		}
	};

	// Define numeric fields
	const numericFields: ConfigField[] = [
		'embeddingDimensions',
		'batchMaxLines',
		'batchConcurrency',
		'chunkingMaxLinesPerChunk',
		'chunkingMinLinesPerChunk',
		'chunkingMinCharsPerChunk',
		'chunkingOverlapLines',
		'rerankingContextLength',
		'rerankingTopN',
	];

	const isNumericField = (field: ConfigField) => numericFields.includes(field);

	const getNumericValue = (field: ConfigField): number => {
		switch (field) {
			case 'embeddingDimensions':
				return embeddingDimensions;
			case 'batchMaxLines':
				return batchMaxLines;
			case 'batchConcurrency':
				return batchConcurrency;
			case 'chunkingMaxLinesPerChunk':
				return chunkingMaxLinesPerChunk;
			case 'chunkingMinLinesPerChunk':
				return chunkingMinLinesPerChunk;
			case 'chunkingMinCharsPerChunk':
				return chunkingMinCharsPerChunk;
			case 'chunkingOverlapLines':
				return chunkingOverlapLines;
			case 'rerankingContextLength':
				return rerankingContextLength;
			case 'rerankingTopN':
				return rerankingTopN;
			default:
				return 0;
		}
	};

	const setNumericValue = (field: ConfigField, value: number) => {
		switch (field) {
			case 'embeddingDimensions':
				setEmbeddingDimensions(value);
				break;
			case 'batchMaxLines':
				setBatchMaxLines(value);
				break;
			case 'batchConcurrency':
				setBatchConcurrency(value);
				break;
			case 'chunkingMaxLinesPerChunk':
				setChunkingMaxLinesPerChunk(value);
				break;
			case 'chunkingMinLinesPerChunk':
				setChunkingMinLinesPerChunk(value);
				break;
			case 'chunkingMinCharsPerChunk':
				setChunkingMinCharsPerChunk(value);
				break;
			case 'chunkingOverlapLines':
				setChunkingOverlapLines(value);
				break;
			case 'rerankingContextLength':
				setRerankingContextLength(value);
				break;
			case 'rerankingTopN':
				setRerankingTopN(value);
				break;
		}
	};

	useInput((rawInput, key) => {
		const input = stripFocusArtifacts(rawInput);

		if (!input && isFocusEventInput(rawInput)) {
			return;
		}

		if (isFocusEventInput(rawInput)) {
			return;
		}

		// Handle numeric field editing
		if (isEditing && isNumericField(currentField)) {
			// Handle digit input
			if (input && input.match(/[0-9]/)) {
				const currentValue = getNumericValue(currentField);
				const newValue = parseInt(currentValue.toString() + input, 10);
				if (!isNaN(newValue)) {
					setNumericValue(currentField, newValue);
				}
			} else if (key.backspace || key.delete) {
				// Handle backspace/delete
				const currentValue = getNumericValue(currentField);
				const currentStr = currentValue.toString();
				const newStr = currentStr.slice(0, -1);
				const newValue = parseInt(newStr, 10);
				setNumericValue(currentField, !isNaN(newValue) ? newValue : 0);
			} else if (key.return) {
				// Confirm and exit editing
				setIsEditing(false);
			} else if (key.escape) {
				// Cancel editing
				setIsEditing(false);
				loadConfiguration();
			}
			return;
		}

		// When editing non-numeric fields, only handle escape
		if (isEditing) {
			if (key.escape) {
				setIsEditing(false);
				loadConfiguration();
			}
			return;
		}

		// Navigation
		if (key.upArrow) {
			const currentIndex = allFields.indexOf(currentField);
			const newIndex =
				currentIndex > 0 ? currentIndex - 1 : allFields.length - 1;
			setCurrentField(allFields[newIndex]!);
			return;
		}

		if (key.downArrow) {
			const currentIndex = allFields.indexOf(currentField);
			const newIndex =
				currentIndex < allFields.length - 1 ? currentIndex + 1 : 0;
			setCurrentField(allFields[newIndex]!);
			return;
		}

		// Toggle enabled field
		if (key.return && currentField === 'enabled') {
			setEnabled(!enabled);
			return;
		}

		// Toggle enableAgentReview field (mutually exclusive with reranking)
		if (key.return && currentField === 'enableAgentReview') {
			const newValue = !enableAgentReview;
			setEnableAgentReview(newValue);
			if (newValue) {
				setEnableReranking(false);
			}
			return;
		}

		// Toggle enableReranking field (mutually exclusive with agent review)
		if (key.return && currentField === 'enableReranking') {
			if (!enableReranking) {
				if (!rerankingModelName.trim() || !rerankingBaseUrl.trim()) {
					showToast(t.codebaseConfig.rerankingNotConfigured);
					return;
				}
			}
			const newValue = !enableReranking;
			setEnableReranking(newValue);
			if (newValue) {
				setEnableAgentReview(false);
			}
			return;
		}

		// Toggle embedding settings expand/collapse
		if (key.return && currentField === 'embeddingSettings') {
			setEmbeddingExpanded(!embeddingExpanded);
			return;
		}

		// Toggle batch settings expand/collapse
		if (key.return && currentField === 'batchSettings') {
			setBatchExpanded(!batchExpanded);
			return;
		}

		// Toggle reranking settings expand/collapse
		if (key.return && currentField === 'rerankingSettings') {
			setRerankingExpanded(!rerankingExpanded);
			return;
		}

		// Enter editing mode for embeddingType to show selector
		if (key.return && currentField === 'embeddingType') {
			setIsEditing(true);
			return;
		}

		// Enter editing mode for text fields
		if (
			key.return &&
			currentField !== 'enabled' &&
			currentField !== 'enableAgentReview' &&
			currentField !== 'enableReranking' &&
			currentField !== 'embeddingSettings' &&
			currentField !== 'batchSettings' &&
			currentField !== 'rerankingSettings'
		) {
			setIsEditing(true);
			return;
		}

		// Save configuration (Ctrl+S or Escape when not editing)
		if ((key.ctrl && input === 's') || key.escape) {
			saveConfiguration();
			if (!errors.length) {
				onBack();
			}
			return;
		}
	});

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box
					marginBottom={1}
					borderStyle="double"
					borderColor={theme.colors.menuInfo}
					paddingX={2}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">{t.codebaseConfig.title}</Gradient>
						<Text color={theme.colors.menuSecondary}>
							{t.codebaseConfig.subtitle}
						</Text>
					</Box>
				</Box>
			)}

			{/* Position indicator - always visible */}
			<Box marginBottom={1}>
				<Text color={theme.colors.warning} bold>
					{t.codebaseConfig.settingsPosition} ({currentFieldIndex + 1}/
					{totalFields})
				</Text>
				{totalFields > MAX_VISIBLE_FIELDS && (
					<Text color={theme.colors.menuSecondary}>
						{' '}
						{t.codebaseConfig.scrollHint}
					</Text>
				)}
			</Box>

			{/* Scrollable field list */}
			<Box flexDirection="column">
				{(() => {
					// Calculate visible window
					if (allFields.length <= MAX_VISIBLE_FIELDS) {
						// Show all fields if less than max
						return allFields.map(field => renderField(field));
					}

					// Calculate scroll window
					const halfWindow = Math.floor(MAX_VISIBLE_FIELDS / 2);
					let startIndex = Math.max(0, currentFieldIndex - halfWindow);
					let endIndex = Math.min(
						allFields.length,
						startIndex + MAX_VISIBLE_FIELDS,
					);

					// Adjust if we're near the end
					if (endIndex - startIndex < MAX_VISIBLE_FIELDS) {
						startIndex = Math.max(0, endIndex - MAX_VISIBLE_FIELDS);
					}

					const visibleFields = allFields.slice(startIndex, endIndex);
					return visibleFields.map(field => renderField(field));
				})()}
			</Box>

			{errors.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color={theme.colors.error} bold>
						{t.codebaseConfig.errors}
					</Text>
					{errors.map((error, index) => (
						<Text key={index} color={theme.colors.error}>
							• {error}
						</Text>
					))}
				</Box>
			)}

			{toastMessage && (
				<Box marginTop={1}>
					<Alert variant="warning">{toastMessage}</Alert>
				</Box>
			)}

			{/* Navigation hints */}
			<Box flexDirection="column" marginTop={1}>
				{isEditing ? (
					<Alert variant="info">{t.codebaseConfig.editingHint}</Alert>
				) : (
					<Alert variant="info">{t.codebaseConfig.navigationHint}</Alert>
				)}
			</Box>
		</Box>
	);
}
