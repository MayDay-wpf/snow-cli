import React, {memo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import type {SubAgent} from '../../../utils/config/subAgentConfig.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import PickerList from '../common/PickerList.js';

interface Props {
	agents: SubAgent[];
	selectedIndex: number;
	visible: boolean;
	maxHeight?: number;
}

const AgentPickerPanel = memo(
	({agents, selectedIndex, visible, maxHeight}: Props) => {
		const {theme} = useTheme();

		if (!visible) {
			return null;
		}

		if (agents.length === 0) {
			return (
				<Box flexDirection="column">
					<Box width="100%" flexDirection="column">
						<Box>
							<Text color={theme.colors.warning} bold>
								Sub-Agent Selection
							</Text>
						</Box>
						<Box marginTop={1}>
							<Alert variant="warning">
								No sub-agents configured. Please configure sub-agents first.
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
				getItemKey={(agent: SubAgent) => agent.id}
				title={
					<>
						<Text color={theme.colors.warning} bold>
							Select Sub-Agent{' '}
							{agents.length > 5 &&
								`(${selectedIndex + 1}/${agents.length})`}
						</Text>
						<Text color={theme.colors.menuSecondary} dimColor>
							(Press ESC to close)
						</Text>
					</>
				}
				renderItem={(agent: SubAgent, isSelected: boolean) => (
					<>
						<Text
							color={
								isSelected
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
							bold
						>
							{isSelected ? '❯ ' : '  '}#{agent.name}
						</Text>
						<Box marginLeft={3} overflow="hidden">
							<Text
								color={
									isSelected
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
								dimColor
								wrap="truncate-end"
							>
								└─ {agent.description || 'No description'}
							</Text>
						</Box>
					</>
				)}
			/>
		);
	},
);

AgentPickerPanel.displayName = 'AgentPickerPanel';

export default AgentPickerPanel;
