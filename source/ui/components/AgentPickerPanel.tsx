import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {Alert} from '@inkjs/ui';
import type {SubAgent} from '../../utils/subAgentConfig.js';

interface Props {
	agents: SubAgent[];
	selectedIndex: number;
	visible: boolean;
	maxHeight?: number;
}

const AgentPickerPanel = memo(({agents, selectedIndex, visible, maxHeight}: Props) => {
	// Fixed maximum display items to prevent rendering issues
	const MAX_DISPLAY_ITEMS = 5;
	const effectiveMaxItems = maxHeight
		? Math.min(maxHeight, MAX_DISPLAY_ITEMS)
		: MAX_DISPLAY_ITEMS;

	// Limit displayed agents
	const displayedAgents = useMemo(() => {
		if (agents.length <= effectiveMaxItems) {
			return agents;
		}

		// Show agents around the selected index
		const halfWindow = Math.floor(effectiveMaxItems / 2);
		let startIndex = Math.max(0, selectedIndex - halfWindow);
		let endIndex = Math.min(agents.length, startIndex + effectiveMaxItems);

		// Adjust if we're near the end
		if (endIndex - startIndex < effectiveMaxItems) {
			startIndex = Math.max(0, endIndex - effectiveMaxItems);
		}

		return agents.slice(startIndex, endIndex);
	}, [agents, selectedIndex, effectiveMaxItems]);

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

	// Show message if no agents configured
	if (agents.length === 0) {
		return (
			<Box flexDirection="column">
				<Box width="100%">
					<Box flexDirection="column" width="100%">
						<Box>
							<Text color="yellow" bold>
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
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Box width="100%">
				<Box flexDirection="column" width="100%">
					<Box>
						<Text color="yellow" bold>
							Select Sub-Agent{' '}
							{agents.length > effectiveMaxItems &&
								`(${selectedIndex + 1}/${agents.length})`}
						</Text>
						<Text color="gray" dimColor>
						(Press ESC to close)
					</Text>
					</Box>
					{displayedAgents.map((agent, index) => (
						<Box key={agent.id} flexDirection="column" width="100%">
							<Text
								color={index === displayedSelectedIndex ? 'green' : 'gray'}
								bold
							>
								{index === displayedSelectedIndex ? '❯ ' : '  '}#{agent.name}
							</Text>
							<Box marginLeft={3}>
								<Text
									color={index === displayedSelectedIndex ? 'green' : 'gray'}
									dimColor
								>
									└─ {agent.description || 'No description'}
								</Text>
							</Box>
						</Box>
					))}
				{agents.length > effectiveMaxItems && (
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							↑↓ to scroll · {agents.length - effectiveMaxItems} more hidden
						</Text>
					</Box>
				)}
			</Box>
		</Box>
	</Box>
);
});

AgentPickerPanel.displayName = 'AgentPickerPanel';

export default AgentPickerPanel;
