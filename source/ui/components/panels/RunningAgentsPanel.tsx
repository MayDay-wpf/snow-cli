import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import type {PickerAgent} from '../../../hooks/picker/useRunningAgentsPicker.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import PickerList from '../common/PickerList.js';

interface Props {
	agents: PickerAgent[];
	selectedIndex: number;
	selectedAgents: Set<string>;
	visible: boolean;
	maxHeight?: number;
}

function truncatePrompt(prompt: string, maxLength: number): string {
	const singleLine = prompt
		.replace(/[\r\n]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (singleLine.length <= maxLength) {
		return singleLine;
	}

	return singleLine.slice(0, maxLength - 3) + '...';
}

function formatElapsed(startedAt: Date): string {
	const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000);
	if (elapsed < 60) {
		return `${elapsed}s`;
	}

	const minutes = Math.floor(elapsed / 60);
	const seconds = elapsed % 60;
	return `${minutes}m${seconds}s`;
}

const RunningAgentsPanel = memo(
	({agents, selectedIndex, selectedAgents, visible, maxHeight}: Props) => {
		const {theme} = useTheme();
		const {t} = useI18n();

		if (!visible) {
			return null;
		}

		if (agents.length === 0) {
			return (
				<Box flexDirection="column">
					<Box width="100%" flexDirection="column">
						<Box>
							<Text color={theme.colors.cyan} bold>
								{'>> '}
								{t.runningAgentsPanel.title}
							</Text>
						</Box>
						<Box marginTop={1}>
							<Alert variant="info">
								{t.runningAgentsPanel.noAgentsRunning}
							</Alert>
						</Box>
					</Box>
				</Box>
			);
		}

		return (
			<PickerList
				items={agents}
				selectedIndex={selectedIndex}
				visible={visible}
				maxDisplayItems={maxHeight}
				itemHeight={3}
				getItemKey={(agent: PickerAgent) => agent.instanceId}
				title={
					<>
						<Text color={theme.colors.cyan} bold>
							{'>> '}
							{t.runningAgentsPanel.title}{' '}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.runningAgentsPanel.keyboardHint}
						</Text>
					</>
				}
				header={
					selectedAgents.size > 0 ? (
						<Box>
							<Text color={theme.colors.menuInfo}>
								{t.runningAgentsPanel.selected.replace(
									'{count}',
									String(selectedAgents.size),
								)}
							</Text>
						</Box>
					) : undefined
				}
				scrollHintFormat={(above, below) => (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.runningAgentsPanel.scrollHint}
						{above > 0 &&
							` · ${t.runningAgentsPanel.moreAbove.replace('{count}', String(above))}`}
						{below > 0 &&
							` · ${t.runningAgentsPanel.moreBelow.replace('{count}', String(below))}`}
					</Text>
				)}
				renderItem={(agent: PickerAgent, isSelected: boolean) => {
					const isChecked = selectedAgents.has(agent.instanceId);
					const promptText = agent.prompt
						? truncatePrompt(agent.prompt, 80)
						: '';
					const isTeammate = agent.sourceType === 'teammate';
					const typeLabel = isTeammate
						? t.runningAgentsPanel.teammateLabel
						: t.runningAgentsPanel.subAgentLabel;

					return (
						<>
							<Text
								color={
									isSelected
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								bold={isSelected}
							>
								{isSelected ? '❯ ' : '  '}
								{isChecked ? '[✓]' : '[ ]'} {agent.agentName}
							</Text>
							<Box marginLeft={5} overflow="hidden">
								<Text
									color={
										isTeammate
											? theme.colors.warning
											: theme.colors.cyan
									}
									dimColor
								>
									{typeLabel}
								</Text>
								<Text color={theme.colors.cyan} dimColor>
									{' '}#{agent.agentId}
								</Text>
								<Text color={theme.colors.menuSecondary} dimColor>
									{' '}
									{formatElapsed(agent.startedAt)}
								</Text>
							</Box>
							{promptText ? (
								<Box marginLeft={5} overflow="hidden">
									<Text
										color={
											isSelected
												? theme.colors.menuSelected
												: theme.colors.menuSecondary
										}
										dimColor={!isSelected}
										wrap="truncate-end"
									>
										{promptText}
									</Text>
								</Box>
							) : null}
						</>
					);
				}}
			/>
		);
	},
);

RunningAgentsPanel.displayName = 'RunningAgentsPanel';

export default RunningAgentsPanel;
