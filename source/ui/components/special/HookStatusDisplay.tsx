import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';
import type {HookType} from '../../../utils/config/hooksConfig.js';
import type {HookStatusEvent} from '../../../utils/execution/hookStatusEvents.js';
import {
	HOOK_DECOR_ICONS,
	HOOK_PHASE_ICONS,
	getHookActionIcon,
	getHookTypeIcon,
} from './hookIcons.js';

export type {HookStatusEvent};

interface HookStatusDisplayProps {
	status: HookStatusEvent | null;
}

function hookTypeLabel(hookType: HookType): string {
	return hookType;
}

/**
 * Live Hook execution status for the TUI.
 * Uses Unicode icons + ink-spinner (no SVG — terminal cannot render vectors).
 */
export const HookStatusDisplay: React.FC<HookStatusDisplayProps> = ({
	status,
}) => {
	const {theme} = useTheme();

	if (!status || status.phase === 'idle') {
		return null;
	}

	const typeIcon = getHookTypeIcon(status.hookType);
	const isRunning = status.phase === 'start' || status.phase === 'action';
	const phaseMeta = HOOK_PHASE_ICONS[status.phase];

	const accent =
		status.phase === 'failed'
			? theme.colors.error || 'red'
			: status.phase === 'success'
			? theme.colors.success || 'green'
			: theme.colors.menuInfo || 'cyan';

	const progress =
		status.actionIndex && status.totalActions
			? ` ${status.actionIndex}/${status.totalActions}`
			: '';

	const resultSuffix =
		status.phase === 'success'
			? status.executedActions != null
				? ` · ${status.executedActions} ok ${HOOK_DECOR_ICONS.done}`
				: ` · done ${HOOK_DECOR_ICONS.done}`
			: status.phase === 'failed'
			? ' · failed'
			: '';

	return (
		<Box flexDirection="column">
			<Box>
				{isRunning ? (
					<Text color={accent} bold>
						<Spinner type="dots" /> {HOOK_DECOR_ICONS.hook} {typeIcon} Hook ·{' '}
						{hookTypeLabel(status.hookType)}
						{progress}
					</Text>
				) : (
					<Text color={accent} bold>
						{phaseMeta.icon} {typeIcon} Hook · {hookTypeLabel(status.hookType)}
						{resultSuffix}
					</Text>
				)}
			</Box>
			{status.actionLabel && (
				<Box marginLeft={2}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{getHookActionIcon(status.actionType)} {status.actionLabel}
					</Text>
				</Box>
			)}
			{status.message && !isRunning && (
				<Box marginLeft={2}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{HOOK_DECOR_ICONS.bullet} {status.message}
					</Text>
				</Box>
			)}
		</Box>
	);
};

export default HookStatusDisplay;
