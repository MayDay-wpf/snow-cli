import React, {useState, useCallback, useRef, useEffect, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {streamBtwResponse} from '../../../utils/commands/btwStream.js';
import {visualWidth} from '../../../utils/core/textUtils.js';

type Step = 'streaming' | 'done' | 'error';

const VISIBLE_ROWS = 8;
const DEBOUNCE_MS = 80;

/**
 * Split text into visual lines that each fit within `maxWidth` columns.
 * Accounts for wide characters (CJK, emoji) via visualWidth.
 */
function toVisualLines(text: string, maxWidth: number): string[] {
	if (maxWidth <= 0) return text.split('\n');

	const result: string[] = [];
	for (const logical of text.split('\n')) {
		if (!logical || visualWidth(logical) <= maxWidth) {
			result.push(logical);
			continue;
		}

		const chars = [...logical];
		let cur = '';
		let curW = 0;
		for (const ch of chars) {
			const w = visualWidth(ch);
			if (curW + w > maxWidth) {
				result.push(cur);
				cur = ch;
				curW = w;
			} else {
				cur += ch;
				curW += w;
			}
		}
		if (cur) result.push(cur);
	}
	return result;
}

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
		() => toVisualLines(response, contentWidth),
		[response, contentWidth],
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
	const promptPreview =
		prompt.length > 50 ? prompt.slice(0, 50) + '...' : prompt;

	const visibleSlice = visualLines.slice(
		scrollOffset,
		scrollOffset + VISIBLE_ROWS,
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
					<Text color={theme.colors.warning} bold>
						{title}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{' '}
						— {promptPreview}
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
						{' '}
						— {promptPreview}
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
					{' '}
					— {promptPreview}
				</Text>
			</Box>
			{responseBox}
			<Box marginTop={1}>
				<Text color={theme.colors.success} bold>
					{'Enter'}
				</Text>
				<Text color={theme.colors.menuSecondary}>
					{' '}
					- {btwText.actionClose || 'Close'}
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
