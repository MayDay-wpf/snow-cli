import React, {useState, useCallback, useRef, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {streamBtwResponse} from '../../../utils/commands/btwStream.js';

type Step = 'streaming' | 'done' | 'error';

interface Props {
	prompt: string;
	onClose: () => void;
}

export const BtwPanel: React.FC<Props> = ({prompt, onClose}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<Step>('streaming');
	const [response, setResponse] = useState('');
	const [errorMessage, setErrorMessage] = useState('');
	const abortControllerRef = useRef<AbortController | null>(null);
	const startedRef = useRef(false);

	const btwText = (t as any).btw || {};

	const startStream = useCallback(async () => {
		setStep('streaming');
		setResponse('');

		const controller = new AbortController();
		abortControllerRef.current = controller;

		try {
			let fullResponse = '';
			for await (const chunk of streamBtwResponse(
				prompt,
				controller.signal,
			)) {
				if (controller.signal.aborted) break;
				fullResponse += chunk;
				setResponse(fullResponse);
			}

			if (!controller.signal.aborted) {
				setResponse(fullResponse);
				setStep('done');
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				const msg =
					error instanceof Error ? error.message : 'Unknown error';
				setErrorMessage(msg);
				setStep('error');
			}
		}
	}, [prompt]);

	useEffect(() => {
		if (!startedRef.current) {
			startedRef.current = true;
			startStream();
		}
		return () => {
			try {
				abortControllerRef.current?.abort();
			} catch {
				// ignore
			}
		};
	}, [startStream]);

	useInput((_input, key) => {
		if (key.escape) {
			try {
				abortControllerRef.current?.abort();
			} catch {
				// ignore
			}
			onClose();
			return;
		}

		if (key.return && (step === 'done' || step === 'error')) {
			onClose();
			return;
		}
	});

	const title = btwText.title || '✦ BTW';
	const promptPreview =
		prompt.length > 50 ? prompt.slice(0, 50) + '...' : prompt;

	if (step === 'error') {
		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.error}
				paddingX={1}
			>
				<Box marginBottom={1}>
					<Text color={theme.colors.warning} bold>
						{title}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{' '}— {promptPreview}
					</Text>
				</Box>
				<Box marginBottom={1}>
					<Text color={theme.colors.error} wrap="wrap">
						{btwText.errorPrefix || 'Error: '}
						{errorMessage}
					</Text>
				</Box>
				<Box>
					<Text color={theme.colors.menuSecondary} dimColor>
						{'Enter'} - {btwText.actionClose || 'Close'}
						{'  '}
						{'ESC'} - {btwText.actionClose || 'Close'}
					</Text>
				</Box>
			</Box>
		);
	}

	if (step === 'streaming') {
		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.warning}
				paddingX={1}
			>
				<Box marginBottom={1}>
					<Text color={theme.colors.warning} bold>
						{title}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{' '}— {promptPreview}
					</Text>
				</Box>
				<Box marginBottom={1}>
					<Text color={theme.colors.success}>
						<Spinner type="dots" />{' '}
						{btwText.thinking || 'Thinking...'}
					</Text>
				</Box>
				{response.length > 0 && (
					<Box flexDirection="column">
						<Text color={theme.colors.menuNormal} wrap="wrap">
							{response}
						</Text>
					</Box>
				)}
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{btwText.escHint || 'ESC to cancel'}
					</Text>
				</Box>
			</Box>
		);
	}

	// step === 'done'
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.success}
			paddingX={1}
		>
			<Box marginBottom={1}>
				<Text color={theme.colors.warning} bold>
					{title}
				</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{' '}— {promptPreview}
				</Text>
			</Box>
			<Box flexDirection="column">
				<Text color={theme.colors.menuNormal} wrap="wrap">
					{response}
				</Text>
			</Box>
			<Box marginTop={1}>
				<Text color={theme.colors.success} bold>
					{'Enter'}
				</Text>
				<Text color={theme.colors.menuSecondary}>
					{' '}- {btwText.actionClose || 'Close'}
				</Text>
				<Text>{'  '}</Text>
				<Text color={theme.colors.menuSecondary} dimColor>
					{'ESC'} - {btwText.actionClose || 'Close'}
				</Text>
			</Box>
		</Box>
	);
};

export default BtwPanel;
