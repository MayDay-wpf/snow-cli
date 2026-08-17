import React, {useState, useEffect} from 'react';
import {Box, Newline, Text, useInput} from 'ink';
import Gradient from 'ink-gradient';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getProxyConfig,
	updateProxyConfig,
	DEFAULT_PROXY_HOST,
	sanitizeProxyHost,
	RECOMMENDED_BLOCKED_PATTERNS,
	type ProxyConfig,
	type SearchEngineId,
} from '../../utils/config/proxyConfig.js';
import {
	listSearchEngines,
	listSearchEnginesAsync,
} from '../../mcp/engines/websearch/index.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import ScrollableSelectInput from '../components/common/ScrollableSelectInput.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
	inlineMode?: boolean;
};

export default function ProxyConfigScreen({
	onBack,
	onSave,
	inlineMode = false,
}: Props) {
	const {t} = useI18n();
	useTerminalTitle(`Snow CLI - ${t.proxyConfig.title}`);
	const {theme} = useTheme();
	const [enabled, setEnabled] = useState(false);
	const [port, setPort] = useState('7890');
	const [host, setHost] = useState(DEFAULT_PROXY_HOST);
	const [browserPath, setBrowserPath] = useState('');
	const [searchEngine, setSearchEngine] =
		useState<SearchEngineId>('duckduckgo');
	const [blockedPatternsText, setBlockedPatternsText] = useState('');
	const [currentField, setCurrentField] = useState<
		| 'enabled'
		| 'searchEngine'
		| 'port'
		| 'host'
		| 'browserPath'
		| 'blockedPatterns'
	>('enabled');
	const [errors, setErrors] = useState<string[]>([]);
	const [isEditing, setIsEditing] = useState(false);

	// Available search engines (built-ins plus user plugins under
	// ~/.snow/plugin/search_engines/). Start with built-ins synchronously then
	// merge in plugin engines once they finish loading.
	const [availableEngines, setAvailableEngines] = useState(() =>
		listSearchEngines(),
	);

	useEffect(() => {
		const config = getProxyConfig();
		setEnabled(config.enabled);
		setPort(config.port.toString());
		setHost(config.host || DEFAULT_PROXY_HOST);
		setBrowserPath(config.browserPath || '');
		setSearchEngine(config.searchEngine || 'duckduckgo');
		setBlockedPatternsText(
			(config.blockedPatterns || []).join('\n'),
		);

		let cancelled = false;
		void listSearchEnginesAsync().then(engines => {
			if (!cancelled) setAvailableEngines(engines);
		});
		return () => {
			cancelled = true;
		};
	}, []);

	const validateConfig = (): string[] => {
		const validationErrors: string[] = [];
		const portNum = parseInt(port, 10);

		if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
			validationErrors.push(t.proxyConfig.portValidationError);
		}

		const trimmedHost = host.trim();
		if (!trimmedHost || /\s/.test(trimmedHost)) {
			// Reject empty hosts and hosts containing whitespace
			validationErrors.push(t.proxyConfig.hostValidationError);
		}

		// Validate each blocked pattern line is a valid regex
		const invalidPattern = blockedPatternsText
			.split(/\r?\n/)
			.map(line => line.trim())
			.filter(line => line.length > 0)
			.find(line => {
				try {
					new RegExp(line);
					return false;
				} catch {
					return true;
				}
			});

		if (invalidPattern) {
			validationErrors.push(
				t.proxyConfig.blockedPatternsValidationError.replace(
					'{{pattern}}',
					invalidPattern,
				),
			);
		}

		return validationErrors;
	};

	const saveConfig = async () => {
		const validationErrors = validateConfig();
		if (validationErrors.length === 0) {
			const blockedPatterns = blockedPatternsText
				.split(/\r?\n/)
				.map(line => line.trim())
				.filter(line => line.length > 0);
			const config: ProxyConfig = {
				enabled,
				port: parseInt(port, 10),
				host: sanitizeProxyHost(host),
				browserPath: browserPath.trim() || undefined,
				searchEngine,
				blockedPatterns: blockedPatterns.length > 0
					? blockedPatterns
					: undefined,
			};
			await updateProxyConfig(config);
			setErrors([]);
			return true;
		} else {
			setErrors(validationErrors);
			return false;
		}
	};

	useInput((input, key) => {
		// Handle save/exit globally
		if (input === 's' && (key.ctrl || key.meta)) {
			saveConfig().then(success => {
				if (success) {
					onSave();
				}
			});
		} else if (key.escape) {
			if (isEditing) {
				// Escape exits edit mode without leaving the screen
				setIsEditing(false);
			} else {
				saveConfig().then(() => onBack()); // Try to save even on escape
			}
		} else if (key.return) {
			if (isEditing) {
				if (currentField === 'blockedPatterns') {
					// In blockedPatterns editing mode, Enter inserts a newline
					// instead of exiting edit mode so the user can write
					// multi-line regex patterns.
					setBlockedPatternsText(prev => `${prev}\n`);
				} else {
					// Exit edit mode, return to navigation
					setIsEditing(false);
				}
			} else {
				// Enter edit mode for the current field (toggle for the
				// boolean checkbox, list selection for searchEngine, text
				// input for the rest).
				if (currentField === 'enabled') {
					setEnabled(!enabled);
				} else {
					setIsEditing(true);
				}
			}
		} else if (!isEditing && key.upArrow) {
			const fields: Array<
				| 'enabled'
				| 'searchEngine'
				| 'port'
				| 'host'
				| 'browserPath'
				| 'blockedPatterns'
			> = [
				'enabled',
				'searchEngine',
				'port',
				'host',
				'browserPath',
				'blockedPatterns',
			];
			const currentIndex = fields.indexOf(currentField);
			const newIndex = currentIndex > 0 ? currentIndex - 1 : fields.length - 1;
			setCurrentField(fields[newIndex]!);
		} else if (!isEditing && key.downArrow) {
			const fields: Array<
				| 'enabled'
				| 'searchEngine'
				| 'port'
				| 'host'
				| 'browserPath'
				| 'blockedPatterns'
			> = [
				'enabled',
				'searchEngine',
				'port',
				'host',
				'browserPath',
				'blockedPatterns',
			];
			const currentIndex = fields.indexOf(currentField);
			const newIndex = currentIndex < fields.length - 1 ? currentIndex + 1 : 0;
			setCurrentField(fields[newIndex]!);
		} else if (!isEditing && input === 'r' && currentField === 'blockedPatterns') {
			// Fill in recommended blocked patterns template
			setBlockedPatternsText(RECOMMENDED_BLOCKED_PATTERNS.join('\n'));
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
					paddingY={1}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">{t.proxyConfig.title}</Gradient>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.proxyConfig.subtitle}
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column" marginBottom={1}>
				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text
							color={
								currentField === 'enabled'
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{currentField === 'enabled' ? '❯ ' : '  '}
							{t.proxyConfig.enableProxy}
						</Text>
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{enabled ? t.proxyConfig.enabled : t.proxyConfig.disabled}{' '}
								{t.proxyConfig.toggleHint}
							</Text>
						</Box>
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text
							color={
								currentField === 'searchEngine'
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{currentField === 'searchEngine' ? '❯ ' : '  '}
							{t.proxyConfig.searchEngine}
						</Text>
						{currentField === 'searchEngine' && isEditing ? (
							<Box marginLeft={3}>
								<ScrollableSelectInput
									items={availableEngines.map(e => ({
										label: e.name,
										value: e.id,
									}))}
									initialIndex={Math.max(
										0,
										availableEngines.findIndex(e => e.id === searchEngine),
									)}
									isFocused={true}
									onSelect={item => {
										setSearchEngine(item.value as SearchEngineId);
										setIsEditing(false);
									}}
								/>
							</Box>
						) : (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{availableEngines.find(e => e.id === searchEngine)?.name ||
										searchEngine}{' '}
									{t.proxyConfig.toggleHint}
								</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text
							color={
								currentField === 'port'
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{currentField === 'port' ? '❯ ' : '  '}
							{t.proxyConfig.proxyPort}
						</Text>
						{currentField === 'port' && isEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={port}
									onChange={setPort}
									placeholder={t.proxyConfig.portPlaceholder}
								/>
							</Box>
						)}
						{(!isEditing || currentField !== 'port') && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{port || t.proxyConfig.notSet}
								</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text
							color={
								currentField === 'host'
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{currentField === 'host' ? '❯ ' : '  '}
							{t.proxyConfig.proxyHost}
						</Text>
						{currentField === 'host' && isEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={host}
									onChange={setHost}
									placeholder={t.proxyConfig.hostPlaceholder}
								/>
							</Box>
						)}
						{(!isEditing || currentField !== 'host') && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{host || t.proxyConfig.notSet}
								</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text
							color={
								currentField === 'browserPath'
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{currentField === 'browserPath' ? '❯ ' : '  '}
							{t.proxyConfig.browserPath}
						</Text>
						{currentField === 'browserPath' && isEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={browserPath}
									onChange={setBrowserPath}
									placeholder={t.proxyConfig.browserPathPlaceholder}
								/>
							</Box>
						)}
					{(!isEditing || currentField !== 'browserPath') && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{browserPath || t.proxyConfig.autoDetect}
							</Text>
						</Box>
					)}
				</Box>
			</Box>

			<Box marginBottom={1}>
				<Box flexDirection="column">
					<Text
						color={
							currentField === 'blockedPatterns'
								? theme.colors.menuSelected
								: theme.colors.menuNormal
						}
					>
						{currentField === 'blockedPatterns' ? '❯ ' : '  '}
						{t.proxyConfig.blockedPatterns}
					</Text>
					{currentField === 'blockedPatterns' && isEditing && (
						<Box marginLeft={3} flexDirection="column">
							<TextInput
								value={blockedPatternsText}
								onChange={setBlockedPatternsText}
								placeholder={t.proxyConfig.blockedPatternsPlaceholder}
							/>
							<Text color={theme.colors.menuInfo} dimColor>
								{t.proxyConfig.blockedPatternsInfo}
							</Text>
						</Box>
					)}
					{(!isEditing || currentField !== 'blockedPatterns') && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>
								{blockedPatternsText
									? blockedPatternsText
											.split(/\r?\n/)
											.filter(l => l.trim().length > 0).length +
									  ' rule(s)'
									: t.proxyConfig.notSet}
							</Text>
						</Box>
					)}
					{!isEditing && currentField !== 'blockedPatterns' && (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuInfo} dimColor>
								{t.proxyConfig.recommendedTemplate}
							</Text>
						</Box>
					)}
				</Box>
			</Box>
		</Box>

			{errors.length > 0 && (
				<Box flexDirection="column" marginBottom={2}>
					<Text color={theme.colors.error} bold>
						{t.proxyConfig.errors}
					</Text>
					{errors.map((error, index) => (
						<Text key={index} color={theme.colors.error}>
							• {error}
						</Text>
					))}
				</Box>
			)}

			<Box flexDirection="column">
				{isEditing ? (
					<>
						<Alert variant="info">{t.proxyConfig.editingHint}</Alert>
					</>
				) : (
					<>
						<Alert variant="info">{t.proxyConfig.navigationHint}</Alert>
						{currentField === 'blockedPatterns' && (
							<Alert variant="info">
								{t.proxyConfig.recommendedTemplateInfo} (press 'r')
							</Alert>
						)}
					</>
				)}
			</Box>

			{currentField === 'browserPath' && (
				<Box flexDirection="column" marginTop={1}>
					<Alert variant="info">
						{t.proxyConfig.browserExamplesTitle} <Newline />
						<Text color={theme.colors.menuInfo}>
							{t.proxyConfig.windowsExample}
						</Text>{' '}
						<Newline />
						<Text color={theme.colors.success}>
							{t.proxyConfig.macosExample}
						</Text>{' '}
						<Newline />
						<Text color={theme.colors.warning}>
							{t.proxyConfig.linuxExample}
						</Text>{' '}
						<Newline />
						{t.proxyConfig.browserExamplesFooter}
					</Alert>
				</Box>
			)}
		</Box>
	);
}
