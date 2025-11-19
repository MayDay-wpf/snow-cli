import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import Gradient from 'ink-gradient';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	loadCodebaseConfig,
	saveCodebaseConfig,
	type CodebaseConfig,
} from '../../utils/codebaseConfig.js';
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
	| 'embeddingModelName'
	| 'embeddingBaseUrl'
	| 'embeddingApiKey'
	| 'embeddingDimensions'
	| 'batchMaxLines'
	| 'batchConcurrency';

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
	const [embeddingModelName, setEmbeddingModelName] = useState('');
	const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('');
	const [embeddingApiKey, setEmbeddingApiKey] = useState('');
	const [embeddingDimensions, setEmbeddingDimensions] = useState(1536);
	const [batchMaxLines, setBatchMaxLines] = useState(10);
	const [batchConcurrency, setBatchConcurrency] = useState(1);

	// UI state
	const [currentField, setCurrentField] = useState<ConfigField>('enabled');
	const [isEditing, setIsEditing] = useState(false);
	const [errors, setErrors] = useState<string[]>([]);

	// Scrolling configuration
	const MAX_VISIBLE_FIELDS = 8;

	const allFields: ConfigField[] = [
		'enabled',
		'enableAgentReview',
		'embeddingModelName',
		'embeddingBaseUrl',
		'embeddingApiKey',
		'embeddingDimensions',
		'batchMaxLines',
		'batchConcurrency',
	];

	const currentFieldIndex = allFields.indexOf(currentField);
	const totalFields = allFields.length;

	useEffect(() => {
		loadConfiguration();
	}, []);

	const loadConfiguration = () => {
		const config = loadCodebaseConfig();
		setEnabled(config.enabled);
		setEnableAgentReview(config.enableAgentReview);
		setEmbeddingModelName(config.embedding.modelName);
		setEmbeddingBaseUrl(config.embedding.baseUrl);
		setEmbeddingApiKey(config.embedding.apiKey);
		setEmbeddingDimensions(config.embedding.dimensions);
		setBatchMaxLines(config.batch.maxLines);
		setBatchConcurrency(config.batch.concurrency);
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

			// LLM is optional - no validation needed
		}

		if (validationErrors.length > 0) {
			setErrors(validationErrors);
			return;
		}

		try {
			const config: CodebaseConfig = {
				enabled,
				enableAgentReview,
				embedding: {
					modelName: embeddingModelName,
					baseUrl: embeddingBaseUrl,
					apiKey: embeddingApiKey,
					dimensions: embeddingDimensions,
				},
				batch: {
					maxLines: batchMaxLines,
					concurrency: batchConcurrency,
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
					<Text color={isActive ? theme.colors.menuSelected : theme.colors.menuNormal}>
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
					<Text color={isActive ? theme.colors.menuSelected : theme.colors.menuNormal}>
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

		case 'embeddingModelName':
			return (
				<Box key={field} flexDirection="column">
					<Text color={isActive ? theme.colors.menuSelected : theme.colors.menuNormal}>
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
				<Box key={field} flexDirection="column">
					<Text color={isActive ? theme.colors.menuSelected : theme.colors.menuNormal}>
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
				<Box key={field} flexDirection="column">
					<Text color={isActive ? theme.colors.menuSelected : theme.colors.menuNormal}>
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
				<Box key={field} flexDirection="column">
					<Text color={isActive ? theme.colors.menuSelected : theme.colors.menuNormal}>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.embeddingDimensions}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								<TextInput
									value={embeddingDimensions.toString()}
									onChange={value => {
										const num = parseInt(stripFocusArtifacts(value) || '0');
										if (!isNaN(num)) {
											setEmbeddingDimensions(num);
										}
									}}
									onSubmit={() => setIsEditing(false)}
								/>
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>{embeddingDimensions}</Text>
						</Box>
					)}
				</Box>
			);

		case 'batchMaxLines':
			return (
				<Box key={field} flexDirection="column">
					<Text color={isActive ? theme.colors.menuSelected : theme.colors.menuNormal}>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.batchMaxLines}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								<TextInput
									value={batchMaxLines.toString()}
									onChange={value => {
										const num = parseInt(stripFocusArtifacts(value) || '0');
										if (!isNaN(num)) {
											setBatchMaxLines(num);
										}
									}}
									onSubmit={() => setIsEditing(false)}
								/>
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
				<Box key={field} flexDirection="column">
					<Text color={isActive ? theme.colors.menuSelected : theme.colors.menuNormal}>
						{isActive ? '❯ ' : '  '}
						{t.codebaseConfig.batchConcurrency}
					</Text>
					{isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo}>
								<TextInput
									value={batchConcurrency.toString()}
									onChange={value => {
										const num = parseInt(stripFocusArtifacts(value) || '0');
										if (!isNaN(num)) {
											setBatchConcurrency(num);
										}
									}}
									onSubmit={() => setIsEditing(false)}
								/>
							</Text>
						</Box>
					)}
					{!isCurrentlyEditing && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>{batchConcurrency}</Text>
						</Box>
					)}
				</Box>
			);

			default:
				return null;
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

		// When editing, only handle submission
		if (isEditing) {
			// TextInput handles the actual editing
			// Escape to cancel editing
			if (key.escape) {
				setIsEditing(false);
				loadConfiguration(); // Reset to saved values
			}
			return;
		}

		// Navigation
		if (key.upArrow) {
			const currentIndex = allFields.indexOf(currentField);
			if (currentIndex > 0) {
				setCurrentField(allFields[currentIndex - 1]!);
			}
			return;
		}

		if (key.downArrow) {
			const currentIndex = allFields.indexOf(currentField);
			if (currentIndex < allFields.length - 1) {
				setCurrentField(allFields[currentIndex + 1]!);
			}
			return;
		}

		// Toggle enabled field
		if (key.return && currentField === 'enabled') {
			setEnabled(!enabled);
			return;
		}

		// Toggle enableAgentReview field
		if (key.return && currentField === 'enableAgentReview') {
			setEnableAgentReview(!enableAgentReview);
			return;
		}

		// Enter editing mode for text fields
		if (
			key.return &&
			currentField !== 'enabled' &&
			currentField !== 'enableAgentReview'
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
