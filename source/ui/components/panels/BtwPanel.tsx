import React, {useState, useCallback, useRef, useEffect, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {streamBtwResponse} from '../../../utils/commands/btwStream.js';
import {visualWidth} from '../../../utils/core/textUtils.js';
import {renderMarkdownToLines} from '../common/MarkdownRenderer.js';

type Step = 'streaming' | 'done' | 'error';

const VISIBLE_ROWS = 8;
const DEBOUNCE_MS = 80;

interface Props {
	prompt: string;
	onClose: () => void;
}

export const BtwPanel: React.FC<Props> = ({prompt, onClose}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const {columns} = useTerminalSize();
	const [step, setStep] = useState<Step>('streaming');
	const [response, setResponse] = useState('');
	const [errorMessage, setErrorMessage] = useState('');
	const [scrollOffset, setScrollOffset] = useState(0);
	const abortControllerRef = useRef<AbortController | null>(null);
	const startedRef = useRef(false);
	const pendingTextRef = useRef('');
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const btwText = (t as any).btw || {};

	// border (2) + paddingX (2) = 4 columns of chrome
	const contentWidth = Math.max(1, columns - 4);

	const visualLines = useMemo(
		() => (response ? renderMarkdownToLines(response) : []),
		[response],
	);

	const flushPending = useCallback(() => {
		debounceTimerRef.current = null;
		setResponse(pendingTextRef.current);
	}, []);

	const startStream = useCallback(async () => {
		setStep('streaming');
		setResponse('');
		pendingTextRef.current = '';

		const controller = new AbortController();
		abortControllerRef.current = controller;

		try {
			for await (const chunk of streamBtwResponse(prompt, controller.signal)) {
				if (controller.signal.aborted) break;
				pendingTextRef.current += chunk;
				if (!debounceTimerRef.current) {
					debounceTimerRef.current = setTimeout(flushPending, DEBOUNCE_MS);
				}
			}

			if (!controller.signal.aborted) {
				if (debounceTimerRef.current) {
					clearTimeout(debounceTimerRef.current);
					debounceTimerRef.current = null;
				}
				setResponse(pendingTextRef.current);
				setStep('done');
			}
		} catch (error) {
			if (!controller.signal.aborted) {
				if (debounceTimerRef.current) {
					clearTimeout(debounceTimerRef.current);
					debounceTimerRef.current = null;
				}
				const msg = error instanceof Error ? error.message : 'Unknown error';
				setErrorMessage(msg);
				setStep('error');
			}
		}
	}, [prompt, flushPending]);

	useEffect(() => {
		if (!startedRef.current) {
			startedRef.current = true;
			startStream();
		}
		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
			try {
				abortControllerRef.current?.abort();
			} catch {
				// ignore
			}
		};
	}, [startStream]);

	useEffect(() => {
		setScrollOffset(Math.max(0, visualLines.length - VISIBLE_ROWS));
	}, [visualLines.length]);

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

		if (key.upArrow) {
			setScrollOffset(prev => Math.max(0, prev - 1));
			return;
		}

		if (key.downArrow) {
			setScrollOffset(prev => {
				const max = Math.max(0, visualLines.length - VISIBLE_ROWS);
				return Math.min(max, prev + 1);
			});
			return;
		}

		if (key.return && (step === 'done' || step === 'error')) {
			onClose();
			return;
		}
	});

	const title = btwText.title || '✦ BTW';
	const separator = ' — ';
	const maxPromptWidth = Math.max(
		10,
		contentWidth - visualWidth(title) - visualWidth(separator),
	);
	const promptPreview = useMemo(() => {
		if (visualWidth(prompt) <= maxPromptWidth) return prompt;
		const chars = [...prompt];
		let s = '';
		let w = 0;
		const ellipsis = '...';
		const ellipsisW = visualWidth(ellipsis);
		for (const ch of chars) {
			const cw = visualWidth(ch);
			if (w + cw + ellipsisW > maxPromptWidth) break;
			s += ch;
			w += cw;
		}
		return s + ellipsis;
	}, [prompt, maxPromptWidth]);

	const canScroll = visualLines.length > VISIBLE_ROWS;
	const visibleSlice = visualLines.slice(
		scrollOffset,
		scrollOffset + VISIBLE_ROWS,
	);

	const scrollIndicator = canScroll && (
		<Box>
			<Text color={theme.colors.menuSecondary} dimColor>
				{btwText.scrollHint || '↑↓ Scroll'}
				{` (${scrollOffset + 1}-${Math.min(scrollOffset + VISIBLE_ROWS, visualLines.length)}/${visualLines.length})`}
			</Text>
		</Box>
	);

	const responseBox = response.length > 0 && (
		<Box
			flexDirection="column"
			height={Math.min(visibleSlice.length, VISIBLE_ROWS)}
		>
			{visibleSlice.map((line, i) => (
				<Text key={i} color={theme.colors.menuNormal} wrap="truncate">
					{line || ' '}
				</Text>
			))}
		</Box>
	);

	if (step === 'error') {
		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.error}
				paddingX={1}
			>
				<Box marginBottom={1}>
					<Text wrap="truncate">
						<Text color={theme.colors.warning} bold>
							{title}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{separator}{promptPreview}
						</Text>
					</Text>
				</Box>
				<Box marginBottom={1}>
					<Text color={theme.colors.error} wrap="wrap">
						{btwText.errorPrefix || 'Error: '}
						{errorMessage}
					</Text>
				</Box>
				<Box>
					<Text color={theme.colors.success} bold>
						{'Enter'}
					</Text>
					<Text color={theme.colors.menuSecondary}>
						{' '}- {btwText.actionClose || 'Close'}
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
					<Text wrap="truncate">
						<Text color={theme.colors.warning} bold>
							{title}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{separator}{promptPreview}
						</Text>
					</Text>
				</Box>
				{!response && (
					<Box marginBottom={1}>
						<Text color={theme.colors.success}>
							{btwText.thinking || 'Thinking...'}
						</Text>
					</Box>
				)}
				{responseBox}
				{scrollIndicator}
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
				<Text wrap="truncate">
					<Text color={theme.colors.warning} bold>
						{title}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{separator}{promptPreview}
					</Text>
				</Text>
			</Box>
			{responseBox}
			{scrollIndicator}
			<Box marginTop={1}>
				<Text color={theme.colors.success} bold>
					{'Enter'}
				</Text>
				<Text color={theme.colors.menuSecondary}>
					{' '}- {btwText.actionClose || 'Close'}
				</Text>
			</Box>
		</Box>
	);
};

export default BtwPanel;
