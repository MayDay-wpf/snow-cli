import React, {useState, useEffect} from 'react';
import {Box, Newline, Text, useInput} from 'ink';
import Gradient from 'ink-gradient';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getProxyConfig,
	updateProxyConfig,
	type ProxyConfig,
} from '../../utils/config/proxyConfig.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';

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
	const {theme} = useTheme();
	const [enabled, setEnabled] = useState(false);
	const [port, setPort] = useState('7890');
	const [browserPath, setBrowserPath] = useState('');
	const [currentField, setCurrentField] = useState<
		'enabled' | 'port' | 'browserPath'
	>('enabled');
	const [errors, setErrors] = useState<string[]>([]);
	const [isEditing, setIsEditing] = useState(false);

	useEffect(() => {
		const config = getProxyConfig();
		setEnabled(config.enabled);
		setPort(config.port.toString());
		setBrowserPath(config.browserPath || '');
	}, []);

	const validateConfig = (): string[] => {
		const validationErrors: string[] = [];
		const portNum = parseInt(port, 10);

		if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
			validationErrors.push(t.proxyConfig.portValidationError);
		}

		return validationErrors;
	};

	const saveConfig = async () => {
		const validationErrors = validateConfig();
		if (validationErrors.length === 0) {
			const config: ProxyConfig = {
				enabled,
				port: parseInt(port, 10),
				browserPath: browserPath.trim() || undefined,
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
			saveConfig().then(() => onBack()); // Try to save even on escape
		} else if (key.return) {
			if (isEditing) {
				// Exit edit mode, return to navigation
				setIsEditing(false);
			} else {
				// Enter edit mode for current field (toggle for checkbox)
				if (currentField === 'enabled') {
					setEnabled(!enabled);
				} else {
					setIsEditing(true);
				}
			}
		} else if (!isEditing && key.upArrow) {
			const fields: Array<'enabled' | 'port' | 'browserPath'> = [
				'enabled',
				'port',
				'browserPath',
			];
			const currentIndex = fields.indexOf(currentField);
			const newIndex = currentIndex > 0 ? currentIndex - 1 : fields.length - 1;
			setCurrentField(fields[newIndex]!);
		} else if (!isEditing && key.downArrow) {
			const fields: Array<'enabled' | 'port' | 'browserPath'> = [
				'enabled',
				'port',
				'browserPath',
			];
			const currentIndex = fields.indexOf(currentField);
			const newIndex = currentIndex < fields.length - 1 ? currentIndex + 1 : 0;
			setCurrentField(fields[newIndex]!);
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
					</>
				)}
			</Box>

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
		</Box>
	);
}
