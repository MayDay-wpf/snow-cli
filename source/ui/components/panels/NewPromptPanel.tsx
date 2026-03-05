import React, {useState, useCallback, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {streamGeneratePrompt} from '../../../utils/commands/newPrompt.js';

type Step = 'input' | 'generating' | 'preview' | 'error';

interface Props {
	onAccept: (prompt: string) => void;
	onCancel: () => void;
}

const VISIBLE_LINES = 15;

export const NewPromptPanel: React.FC<Props> = ({onAccept, onCancel}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const [step, setStep] = useState<Step>('input');
	const [requirement, setRequirement] = useState('');
	const [generatedPrompt, setGeneratedPrompt] = useState('');
	const [errorMessage, setErrorMessage] = useState('');
	const [scrollOffset, setScrollOffset] = useState(0);
	const abortControllerRef = useRef<AbortController | null>(null);

	const generatePrompt = useCallback(
		async (userRequirement: string) => {
			setStep('generating');
			setGeneratedPrompt('');
			setScrollOffset(0);

			const controller = new AbortController();
			abortControllerRef.current = controller;

			try {
				let fullResponse = '';
				for await (const chunk of streamGeneratePrompt(
					userRequirement,
					controller.signal,
				)) {
					if (controller.signal.aborted) break;
					fullResponse += chunk;
					setGeneratedPrompt(fullResponse);
				}

				if (!controller.signal.aborted) {
					setGeneratedPrompt(fullResponse);
					setStep('preview');
				}
			} catch (error) {
				if (!controller.signal.aborted) {
					const msg =
						error instanceof Error ? error.message : 'Unknown error';
					setErrorMessage(msg);
					setStep('error');
				}
			}
		},
		[],
	);

	const handleRequirementSubmit = useCallback(
		(value: string) => {
			if (!value.trim()) return;
			generatePrompt(value.trim());
		},
		[generatePrompt],
	);

	const handleCancel = useCallback(() => {
		try {
			abortControllerRef.current?.abort();
		} catch {
			// ignore
		}
		onCancel();
	}, [onCancel]);

	useInput((input, key) => {
		if (key.escape) {
			handleCancel();
			return;
		}

		if (step === 'preview') {
			const lines = generatedPrompt.split('\n');
			const maxScroll = Math.max(0, lines.length - VISIBLE_LINES);

			if (key.upArrow) {
				setScrollOffset(prev => Math.max(0, prev - 1));
				return;
			}
			if (key.downArrow) {
				setScrollOffset(prev => Math.min(maxScroll, prev + 1));
				return;
			}
		}

		if (step === 'preview') {
			const lower = input.toLowerCase();
			if (lower === 'y') {
				onAccept(generatedPrompt);
			} else if (lower === 'n') {
				handleCancel();
			} else if (lower === 'r') {
				generatePrompt(requirement);
			}
			return;
		}

		if (step === 'error') {
			const lower = input.toLowerCase();
			if (lower === 'r') {
				generatePrompt(requirement);
			}
		}
	});

	const newPromptText = t.newPrompt || ({} as any);
	const scrollHint = newPromptText.scrollHint || '↑↓ Scroll';

	if (step === 'input') {
		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.warning}
				paddingX={1}
			>
				<Box marginBottom={1}>
					<Text color={theme.colors.warning} bold>
						{newPromptText.title || '✦ Prompt Generator'}
					</Text>
				</Box>
				<Box marginBottom={1}>
					<Text color={theme.colors.menuSecondary}>
						{newPromptText.inputHint ||
							'Describe your requirement, AI will generate a refined prompt:'}
					</Text>
				</Box>
				<Box>
					<Text color={theme.colors.menuInfo} bold>
						{'❯ '}
					</Text>
					<TextInput
						value={requirement}
						onChange={setRequirement}
						onSubmit={handleRequirementSubmit}
						placeholder={
							newPromptText.placeholder || 'Enter your requirement...'
						}
					/>
				</Box>
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{newPromptText.escHint || 'ESC to cancel'}
					</Text>
				</Box>
			</Box>
		);
	}

	if (step === 'generating') {
		const allLines = generatedPrompt ? generatedPrompt.split('\n') : [];
		const tailLines = allLines.slice(-VISIBLE_LINES);

		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.warning}
				paddingX={1}
			>
				<Box marginBottom={1}>
					<Text color={theme.colors.warning} bold>
						{newPromptText.title || '✦ Prompt Generator'}
					</Text>
				</Box>
				<Box marginBottom={1}>
					<Text color={theme.colors.success}>
						<Spinner type="dots" />{' '}
						{newPromptText.generating || 'Generating prompt...'}
					</Text>
				</Box>
				{tailLines.length > 0 && (
					<Box
						flexDirection="column"
						borderStyle="round"
						borderColor={theme.colors.menuSecondary}
						paddingX={1}
					>
						{tailLines.map((line, i) => (
							<Text key={i} color={theme.colors.menuNormal} wrap="truncate">
								{line}
							</Text>
						))}
					</Box>
				)}
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{newPromptText.escHint || 'ESC to cancel'}
					</Text>
				</Box>
			</Box>
		);
	}

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
						{newPromptText.title || '✦ Prompt Generator'}
					</Text>
				</Box>
				<Box marginBottom={1}>
					<Text color={theme.colors.error}>
						{newPromptText.errorPrefix || 'Error: '}
						{errorMessage}
					</Text>
				</Box>
				<Box>
					<Text color={theme.colors.menuSecondary}>
						{'R'} -{' '}
						{newPromptText.actionRetry || 'Retry'}
						{'  '}
						{'ESC'} -{' '}
						{newPromptText.actionCancel || 'Cancel'}
					</Text>
				</Box>
			</Box>
		);
	}

	// preview step
	const allLines = generatedPrompt.split('\n');
	const maxScroll = Math.max(0, allLines.length - VISIBLE_LINES);
	const safeOffset = Math.min(scrollOffset, maxScroll);
	const displayLines = allLines.slice(safeOffset, safeOffset + VISIBLE_LINES);
	const hasScrollable = allLines.length > VISIBLE_LINES;

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.success}
			paddingX={1}
		>
			<Box marginBottom={1}>
				<Text color={theme.colors.warning} bold>
					{newPromptText.title || '✦ Prompt Generator'}
				</Text>
			</Box>
			<Box marginBottom={1}>
				<Text color={theme.colors.success} bold>
					{newPromptText.previewTitle || '✓ Prompt generated:'}
				</Text>
			</Box>
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.success}
				paddingX={1}
			>
				{displayLines.map((line, i) => (
					<Text key={i} color={theme.colors.menuNormal} wrap="truncate">
						{line}
					</Text>
				))}
				{hasScrollable && (
					<Text color={theme.colors.menuSecondary} dimColor>
						[{safeOffset + 1}-{Math.min(safeOffset + VISIBLE_LINES, allLines.length)}/{allLines.length}] {scrollHint}
					</Text>
				)}
			</Box>
			<Box marginTop={1}>
				<Text color={theme.colors.success} bold>
					{'Y'}
				</Text>
				<Text color={theme.colors.menuSecondary}>
					{' - '}
					{newPromptText.actionAccept || 'Write to input'}
				</Text>
				<Text>{'  '}</Text>
				<Text color={theme.colors.error} bold>
					{'N'}
				</Text>
				<Text color={theme.colors.menuSecondary}>
					{' - '}
					{newPromptText.actionReject || 'Discard'}
				</Text>
				<Text>{'  '}</Text>
				<Text color={theme.colors.warning} bold>
					{'R'}
				</Text>
				<Text color={theme.colors.menuSecondary}>
					{' - '}
					{newPromptText.actionRegenerate || 'Regenerate'}
				</Text>
			</Box>
		</Box>
	);
};

export default NewPromptPanel;
