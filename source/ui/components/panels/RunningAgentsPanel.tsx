import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import type {RunningSubAgent} from '../../../utils/execution/runningSubAgentTracker.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';

interface Props {
	agents: RunningSubAgent[];
	selectedIndex: number;
	selectedAgents: Set<string>;
	visible: boolean;
	maxHeight?: number;
}

/**
 * Truncate a prompt string for display, preserving readability.
 * Removes newlines and truncates at the given max length.
 */
function truncatePrompt(prompt: string, maxLength: number): string {
	// Replace newlines and multiple spaces with single space
	const singleLine = prompt
		.replace(/[\r\n]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	if (singleLine.length <= maxLength) {
		return singleLine;
	}

	return singleLine.slice(0, maxLength - 3) + '...';
}

/**
 * Format elapsed time since the sub-agent started
 */
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
		// Fixed maximum display items to prevent rendering issues
		const MAX_DISPLAY_ITEMS = 5;
		const effectiveMaxItems = maxHeight
			? Math.min(maxHeight, MAX_DISPLAY_ITEMS)
			: MAX_DISPLAY_ITEMS;

		const agentWindow = useMemo(() => {
			if (agents.length <= effectiveMaxItems) {
				return {
					items: agents,
					startIndex: 0,
					endIndex: agents.length,
				};
			}

			// Show agents around the selected index
			const halfWindow = Math.floor(effectiveMaxItems / 2);
			let startIndex = Math.max(0, selectedIndex - halfWindow);
			const endIndex = Math.min(
				agents.length,
				startIndex + effectiveMaxItems,
			);

			// Adjust if we're near the end
			if (endIndex - startIndex < effectiveMaxItems) {
				startIndex = Math.max(0, endIndex - effectiveMaxItems);
			}

			return {
				items: agents.slice(startIndex, endIndex),
				startIndex,
				endIndex,
			};
		}, [agents, selectedIndex, effectiveMaxItems]);

		const displayedAgents = agentWindow.items;
		const hiddenAboveCount = agentWindow.startIndex;
		const hiddenBelowCount = Math.max(0, agents.length - agentWindow.endIndex);

		// Calculate actual selected index in the displayed subset
		const displayedSelectedIndex = useMemo(() => {
			return displayedAgents.findIndex(agent => {
				const originalIndex = agents.indexOf(agent);
				return originalIndex === selectedIndex;
			});
		}, [displayedAgents, agents, selectedIndex]);

		// Don't show panel if not visible
		if (!visible) {
			return null;
		}

		// Show message if no running agents
		if (agents.length === 0) {
			return (
				<Box flexDirection="column">
					<Box width="100%">
						<Box flexDirection="column" width="100%">
							<Box>
								<Text color={theme.colors.cyan} bold>
									{'>> '}{t.runningAgentsPanel.title}
								</Text>
							</Box>
							<Box marginTop={1}>
								<Alert variant="info">
									{t.runningAgentsPanel.noAgentsRunning}
								</Alert>
							</Box>
						</Box>
					</Box>
				</Box>
			);
		}

		return (
			<Box flexDirection="column">
				<Box width="100%">
					<Box flexDirection="column" width="100%">
						<Box>
							<Text color={theme.colors.cyan} bold>
								{'>> '}{t.runningAgentsPanel.title}
								{' '}
							</Text>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.runningAgentsPanel.keyboardHint}
							</Text>
						</Box>
						{selectedAgents.size > 0 && (
							<Box>
								<Text color={theme.colors.menuInfo}>
									{t.runningAgentsPanel.selected.replace('{count}', String(selectedAgents.size))}
								</Text>
							</Box>
						)}
						{displayedAgents.map((agent, index) => {
							const isSelected = index === displayedSelectedIndex;
							const isChecked = selectedAgents.has(agent.instanceId);
							const promptText = agent.prompt
								? truncatePrompt(agent.prompt, 80)
								: '';

							return (
								<Box
									key={agent.instanceId}
									flexDirection="column"
									width="100%"
								>
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
									<Box marginLeft={5}>
										<Text
											color={theme.colors.cyan}
											dimColor
										>
											#{agent.agentId}
										</Text>
										<Text
											color={theme.colors.menuSecondary}
											dimColor
										>
											{' '}
											{formatElapsed(agent.startedAt)}
										</Text>
									</Box>
									{promptText && (
										<Box marginLeft={5}>
											<Text
												color={
													isSelected
														? theme.colors.menuSelected
														: theme.colors.menuSecondary
												}
												dimColor={!isSelected}
											>
												{promptText}
											</Text>
										</Box>
									)}
								</Box>
							);
						})}
						{agents.length > effectiveMaxItems && (
							<Box marginTop={1}>
								<Text color={theme.colors.menuSecondary} dimColor>
									{t.runningAgentsPanel.scrollHint}
									{hiddenAboveCount > 0 && ` · ${t.runningAgentsPanel.moreAbove.replace('{count}', String(hiddenAboveCount))}`}
									{hiddenBelowCount > 0 && ` · ${t.runningAgentsPanel.moreBelow.replace('{count}', String(hiddenBelowCount))}`}
								</Text>
							</Box>
						)}
					</Box>
				</Box>
			</Box>
		);
	},
);

RunningAgentsPanel.displayName = 'RunningAgentsPanel';

export default RunningAgentsPanel;
