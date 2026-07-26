/**
 * Renders the active Plan Mode document above askuser approval prompts.
 *
 * Loads `.snow/plan/**` via findActivePlan so the user can review the plan
 * in-terminal before choosing "Yes - Execute the entire plan".
 */

import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';
import {
	findActivePlan,
	type PlanDoc,
} from '../../../utils/execution/planDocument.js';
import {
	formatPlanApprovalPreview,
	isPlanApprovalQuestion,
} from '../../../utils/ui/planApprovalPreview.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';

type Props = {
	enabled: boolean;
	question?: string;
	workingDirectory: string;
	terminalWidth?: number;
};

type LoadState =
	| {status: 'idle'}
	| {status: 'loading'}
	| {status: 'ready'; doc: PlanDoc; text: string}
	| {status: 'empty'}
	| {status: 'error'; message: string};

export default function PlanApprovalPreview({
	enabled,
	question,
	workingDirectory,
}: Props) {
	const {theme} = useTheme();
	const [state, setState] = useState<LoadState>({status: 'idle'});

	const shouldShow =
		enabled && isPlanApprovalQuestion(question);

	useEffect(() => {
		if (!shouldShow) {
			setState({status: 'idle'});
			return;
		}

		let cancelled = false;
		setState({status: 'loading'});

		(async () => {
			try {
				const sessionId = sessionManager.getCurrentSession()?.id ?? null;
				const doc = await findActivePlan(workingDirectory, sessionId);
				if (cancelled) {
					return;
				}

				if (!doc) {
					setState({status: 'empty'});
					return;
				}

				setState({
					status: 'ready',
					doc,
					text: formatPlanApprovalPreview(doc),
				});
			} catch (error: any) {
				if (cancelled) {
					return;
				}

				setState({
					status: 'error',
					message:
						error?.message && typeof error.message === 'string'
							? error.message
							: 'Failed to load plan document',
				});
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [shouldShow, workingDirectory, question]);

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

	const lines = state.text.split('\n');

	return (
		<Box
			flexDirection="column"
			marginX={1}
			marginBottom={1}
			borderStyle="round"
			borderColor={theme.colors.menuInfo}
			paddingX={1}
		>
			{lines.map((line, index) => {
				const isHeader = index === 0;
				const isSection = line.startsWith('### ');
				const isMeta =
					line.startsWith('Title:') ||
					line.startsWith('Status:') ||
					line.startsWith('Path:') ||
					line.startsWith('Affected:');

				return (
					<Text
						key={index}
						bold={isHeader || isSection}
						color={
							isHeader || isSection
								? theme.colors.menuInfo
								: isMeta
									? theme.colors.menuSecondary
									: undefined
						}
						dimColor={!isHeader && !isSection && !isMeta && line.startsWith('  ')}
					>
						{line || ' '}
					</Text>
				);
			})}
			<Box marginTop={1}>
				<Text dimColor>
					Review above, then choose an option below. Full file:{' '}
					{state.doc.filePath}
				</Text>
			</Box>
		</Box>
	);
}
