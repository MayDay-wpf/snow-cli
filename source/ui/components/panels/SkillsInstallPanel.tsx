import React, {useState, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import type {SkillLocation} from '../../../utils/commands/skills.js';
import {
	installSkillFromGithub,
	parseGitHubUrl,
} from '../../../utils/skills/githubSkillInstaller.js';

type Step = 'url' | 'location' | 'installing' | 'result';

interface Props {
	onComplete: (success: boolean, skillId: string, message: string) => void;
	onCancel: () => void;
	projectRoot?: string;
	/** Initial GitHub URL (e.g. from /skills install <url>) */
	initialUrl?: string;
}

export const SkillsInstallPanel: React.FC<Props> = ({
	onComplete: _onComplete,
	onCancel,
	projectRoot,
	initialUrl,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<Step>(initialUrl ? 'location' : 'url');
	const [url, setUrl] = useState(initialUrl || '');
	const [location, setLocation] = useState<SkillLocation>('global');
	const [, setInstalling] = useState(false);
	const [resultMessage, setResultMessage] = useState('');
	const [resultSuccess, setResultSuccess] = useState(false);

	// Location selection index (0 = global, 1 = project)
	const [locationIndex, setLocationIndex] = useState(0);

	const handleInstall = useCallback(async () => {
		setStep('installing');
		setInstalling(true);
		try {
			const result = await installSkillFromGithub(url, location, projectRoot);
			setResultSuccess(result.success);
			if (result.success) {
				if (result.results.length > 1) {
					const skillNames = result.results
						.filter(r => r.success)
						.map(r => r.skillId)
						.join(', ');
					setResultMessage(
						t.skillsInstall.batchInstallSuccess
							.replace('{count}', String(result.installedCount))
							.replace('{total}', String(result.totalCount))
							.replace('{names}', skillNames),
					);
				} else if (result.results.length === 1 && result.results[0]!.success) {
					const single = result.results[0]!;
					setResultMessage(
						t.skillsInstall.installSuccess
							.replace('{name}', single.skillId)
							.replace('{path}', single.path),
					);
				} else {
					setResultMessage(
						t.skillsInstall.installError.replace(
							'{error}',
							result.error || t.skillsInstall.errorUnknown,
						),
					);
				}
			} else {
				setResultMessage(
					t.skillsInstall.installError.replace(
						'{error}',
						result.error || t.skillsInstall.errorUnknown,
					),
				);
			}
		} catch (error) {
			setResultSuccess(false);
			setResultMessage(
				t.skillsInstall.installError.replace(
					'{error}',
					error instanceof Error ? error.message : t.skillsInstall.errorUnknown,
				),
			);
		} finally {
			setInstalling(false);
			setStep('result');
		}
	}, [url, location, projectRoot, t]);

	// ----- Keyboard handling -----
	useInput((_input, key) => {
		if (step === 'installing') {
			return;
		}

		if (key.escape) {
			onCancel();
			return;
		}

		// URL input step - TextInput handles its own keystrokes
		if (step === 'url') {
			if (key.return) {
				const trimmed = url.trim();
				if (trimmed && parseGitHubUrl(trimmed)) {
					setStep('location');
				}
			}
			return;
		}

		// Location selection step - use up/down arrows
		if (step === 'location') {
			if (key.upArrow) {
				setLocationIndex(prev => (prev > 0 ? prev - 1 : 1));
				return;
			}
			if (key.downArrow) {
				setLocationIndex(prev => (prev < 1 ? prev + 1 : 0));
				return;
			}
			if (key.return) {
				setLocation(locationIndex === 0 ? 'global' : 'project');
				handleInstall();
				return;
			}
			return;
		}

		// Result step
		if (step === 'result') {
			if (key.return) {
				setUrl('');
				setStep('url');
				return;
			}
			return;
		}
	});

	// ----- Render -----

	// Installing step
	if (step === 'installing') {
		return (
			<Box
				borderColor={theme.colors.menuInfo}
				borderStyle="round"
				paddingX={2}
				paddingY={0}
			>
				<Box flexDirection="column">
					<Box>
						<Text color={theme.colors.menuNormal}>
							<Spinner type="dots" /> {t.skillsInstall.installing}
						</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsInstall.installingHint}</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	// Result step
	if (step === 'result') {
		return (
			<Box
				borderColor={
					resultSuccess
						? theme.colors.success || 'green'
						: theme.colors.error || 'red'
				}
				borderStyle="round"
				paddingX={2}
				paddingY={0}
			>
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text
							color={
								resultSuccess
									? theme.colors.success || 'green'
									: theme.colors.error || 'red'
							}
						>
							{resultSuccess ? '[OK] ' : '[ERR] '}
							{resultMessage}
						</Text>
					</Box>
					<Box>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.skillsInstall.resultActions}
						</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	// URL input step
	if (step === 'url') {
		return (
			<Box
				borderColor={theme.colors.menuInfo}
				borderStyle="round"
				paddingX={2}
				paddingY={0}
			>
				<Box flexDirection="column">
					<Text color={theme.colors.menuInfo} bold>
						{t.skillsInstall.title}
					</Text>
					<Box marginTop={1} marginBottom={1}>
						<Text color={theme.colors.text}>{t.skillsInstall.urlLabel}</Text>
					</Box>
					<Box>
						<TextInput
							value={url}
							onChange={setUrl}
							placeholder={t.skillsInstall.urlPlaceholder}
						/>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsInstall.urlHint}</Text>
					</Box>
					<Box marginTop={1}>
						<Text dimColor>{t.skillsInstall.urlExamples}</Text>
					</Box>
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.skillsInstall.urlActions}
						</Text>
					</Box>
				</Box>
			</Box>
		);
	}

	// Location selection step - use up/down arrows
	// step === 'location'
	const locationOptions: {label: string}[] = [
		{label: t.skillsInstall.locationGlobal},
		{label: t.skillsInstall.locationProject},
	];

	return (
		<Box
			borderColor={theme.colors.menuInfo}
			borderStyle="round"
			paddingX={2}
			paddingY={0}
		>
			<Box flexDirection="column">
				<Text color={theme.colors.menuInfo} bold>
					{t.skillsInstall.locationLabel}
				</Text>
				<Box marginTop={1} marginBottom={1}>
					<Text color={theme.colors.text}>{t.skillsInstall.urlLabel}</Text>
					<Text> {url}</Text>
				</Box>
				<Box flexDirection="column">
					{locationOptions.map((opt, idx) => {
						const isSelected = idx === locationIndex;
						return (
							<Box key={idx}>
								<Text
									color={isSelected ? theme.colors.menuInfo : theme.colors.text}
									bold={isSelected}
								>
									{isSelected ? '❯ ' : '  '}
									{opt.label}
								</Text>
							</Box>
						);
					})}
				</Box>
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.skillsInstall.locationActions}
					</Text>
				</Box>
			</Box>
		</Box>
	);
};
