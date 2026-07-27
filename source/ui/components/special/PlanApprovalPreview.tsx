/**
 * Renders the active Plan Mode document above askuser approval prompts.
 *
 * Loads `.snow/plan/**` via findActivePlan so the user can review the plan
 * in-terminal before choosing "Yes - Execute the entire plan".
 */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import wrapAnsi from 'wrap-ansi';
import {useTerminalSize} from '../../../hooks/ui/useTerminalSize.js';
import {useTerminalMouseWheel} from '../../../hooks/ui/useTerminalMouseWheel.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {
	findActivePlan,
	type PlanDoc,
} from '../../../utils/execution/planDocument.js';
import {
	computePlanPreviewScrollWindow,
	computePlanPreviewVisibleRows,
	formatPlanApprovalPreview,
	isPlanApprovalQuestion,
} from '../../../utils/ui/planApprovalPreview.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';

type Properties = Readonly<{
	isEnabled: boolean;
	question?: string;
	workingDirectory: string;
	terminalWidth?: number;
}>;

type LoadState =
	| {status: 'idle'}
	| {status: 'loading'}
	| {status: 'ready'; doc: PlanDoc; text: string}
	| {status: 'empty'}
	| {status: 'error'; message: string};

type PreviewVisualLine = {
	text: string;
	sourceIndex: number;
	sourceText: string;
};

export default function PlanApprovalPreview({
	isEnabled,
	question,
	workingDirectory,
	terminalWidth,
}: Properties) {
	const {theme} = useTheme();
	const {columns: terminalColumns, rows: terminalRows} = useTerminalSize();
	const [state, setState] = useState<LoadState>({status: 'idle'});
	const [scrollOffset, setScrollOffset] = useState(0);

	const shouldShow = isEnabled && isPlanApprovalQuestion(question);

	useEffect(() => {
		if (!shouldShow) {
			setState({status: 'idle'});
			return;
		}

		let cancelled = false;
		setScrollOffset(0);
		setState({status: 'loading'});

		(async () => {
			try {
				const sessionId = sessionManager.getCurrentSession()?.id ?? null;
				const planDocument = await findActivePlan(workingDirectory, sessionId);
				if (cancelled) {
					return;
				}

				if (!planDocument) {
					setState({status: 'empty'});
					return;
				}

				setState({
					status: 'ready',
					doc: planDocument,
					text: formatPlanApprovalPreview(planDocument, {
						maxStepsPerPhase: Number.MAX_SAFE_INTEGER,
						maxFilesPerPhase: Number.MAX_SAFE_INTEGER,
						maxPhases: Number.MAX_SAFE_INTEGER,
					}),
				});
			} catch (error: unknown) {
				if (cancelled) {
					return;
				}

				setState({
					status: 'error',
					message:
						error instanceof Error
							? error.message
							: 'Failed to load plan document',
				});
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [shouldShow, workingDirectory, question]);

	const contentWidth = Math.max(20, (terminalWidth ?? terminalColumns) - 6);
	const readyText = state.status === 'ready' ? state.text : '';
	const visualLines = useMemo<PreviewVisualLine[]>(() => {
		if (!readyText) {
			return [];
		}

		return readyText.split('\n').flatMap((sourceText, sourceIndex) =>
			wrapAnsi(sourceText || ' ', contentWidth, {
				hard: true,
				trim: false,
				wordWrap: false,
			})
				.split('\n')
				.map(text => ({text: text || ' ', sourceIndex, sourceText})),
		);
	}, [readyText, contentWidth]);
	const visibleRows = computePlanPreviewVisibleRows(terminalRows);
	const scrollWindow = computePlanPreviewScrollWindow(
		visualLines.length,
		scrollOffset,
		visibleRows,
	);
	const visibleLines = visualLines.slice(
		scrollWindow.visibleStart,
		scrollWindow.visibleEnd,
	);
	const scrollInputActive =
		shouldShow && state.status === 'ready' && scrollWindow.canScroll;

	useEffect(() => {
		if (scrollOffset !== scrollWindow.clampedOffset) {
			setScrollOffset(scrollWindow.clampedOffset);
		}
	}, [scrollOffset, scrollWindow.clampedOffset]);

	const applyScrollDelta = useCallback(
		(delta: number) => {
			if (delta === 0) {
				return;
			}

			setScrollOffset(
				previous =>
					computePlanPreviewScrollWindow(
						visualLines.length,
						previous + delta,
						visibleRows,
					).clampedOffset,
			);
		},
		[visualLines.length, visibleRows],
	);

	useInput(
		(input, key) => {
			let delta = 0;
			if (key.pageUp) {
				delta = -visibleRows;
			} else if (key.pageDown) {
				delta = visibleRows;
			} else if (input === '[') {
				delta = -1;
			} else if (input === ']') {
				delta = 1;
			}

			applyScrollDelta(delta);
		},
		{isActive: scrollInputActive},
	);

	// Best-effort physical mouse wheel (SGR/X10). Terminals without mouse
	// reporting simply never fire; keyboard scroll remains the reliable path.
	useTerminalMouseWheel({
		isActive: scrollInputActive,
		onWheel: event => {
			applyScrollDelta(
				event.direction === 'up' ? -event.deltaLines : event.deltaLines,
			);
		},
	});

	if (!shouldShow || state.status === 'idle') {
		return null;
	}

	if (state.status === 'loading') {
		return (
			<Box
				flexDirection="column"
				marginX={1}
				marginBottom={1}
				borderStyle="round"
				borderColor={theme.colors.menuSecondary}
				paddingX={1}
			>
				<Text dimColor>Loading plan document…</Text>
			</Box>
		);
	}

	if (state.status === 'empty') {
		return (
			<Box
				flexDirection="column"
				marginX={1}
				marginBottom={1}
				borderStyle="round"
				borderColor={theme.colors.warning || theme.colors.menuSecondary}
				paddingX={1}
			>
				<Text bold color={theme.colors.warning || theme.colors.menuInfo}>
					⚠ No plan document found under .snow/plan/
				</Text>
				<Text dimColor>
					Create the plan first, then ask for approval again.
				</Text>
			</Box>
		);
	}

	if (state.status === 'error') {
		return (
			<Box
				flexDirection="column"
				marginX={1}
				marginBottom={1}
				borderStyle="round"
				borderColor={theme.colors.error || theme.colors.menuSecondary}
				paddingX={1}
			>
				<Text color={theme.colors.error || theme.colors.menuInfo}>
					Failed to load plan: {state.message}
				</Text>
			</Box>
		);
	}

	const renderVisualLine = (line: PreviewVisualLine, index: number) => {
		const isHeader = line.sourceIndex === 0;
		const isSection = line.sourceText.startsWith('### ');
		const isMeta =
			line.sourceText.startsWith('Title:') ||
			line.sourceText.startsWith('Status:') ||
			line.sourceText.startsWith('Path:') ||
			line.sourceText.startsWith('Affected:');

		return (
			<Text
				key={`${scrollWindow.visibleStart + index}-${line.sourceIndex}`}
				bold={isHeader || isSection}
				color={
					isHeader || isSection
						? theme.colors.menuInfo
						: isMeta
						? theme.colors.menuSecondary
						: undefined
				}
				dimColor={
					!isHeader && !isSection && !isMeta && line.sourceText.startsWith('  ')
				}
				wrap="truncate"
			>
				{line.text}
			</Text>
		);
	};

	return (
		<Box
			flexDirection="column"
			marginX={1}
			marginBottom={1}
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={1}
		>
			{scrollWindow.canScroll ? (
				<Box flexDirection="column" height={visibleRows + 2}>
					<Text dimColor color={theme.colors.menuSecondary}>
						{scrollWindow.hiddenAbove > 0
							? `↑ ${scrollWindow.hiddenAbove} more above`
							: ' '}
					</Text>
					<Box flexDirection="column" height={visibleRows} overflow="hidden">
						{visibleLines.map((line, index) => renderVisualLine(line, index))}
					</Box>
					<Text dimColor color={theme.colors.menuSecondary}>
						{scrollWindow.hiddenBelow > 0
							? `↓ ${scrollWindow.hiddenBelow} more below`
							: ' '}
					</Text>
				</Box>
			) : (
				<Box flexDirection="column">
					{visibleLines.map((line, index) => renderVisualLine(line, index))}
				</Box>
			)}
			{scrollWindow.canScroll && (
				<Text dimColor color={theme.colors.menuSecondary}>
					PgUp/PgDn/[ ]/wheel scroll plan · ↑↓ select options · (
					{scrollWindow.visibleStart + 1}-{scrollWindow.visibleEnd}/
					{visualLines.length})
				</Text>
			)}
			<Box marginTop={1}>
				<Text dimColor wrap="truncate">
					Review above, then choose an option below. Full file:{' '}
					{state.doc.filePath}
				</Text>
			</Box>
		</Box>
	);
}
