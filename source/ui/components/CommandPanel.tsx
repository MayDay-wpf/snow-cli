import React from 'react';
import { Box, Text } from 'ink';

interface Command {
	name: string;
	description: string;
}

interface Props {
	commands: Command[];
	selectedIndex: number;
	query: string;
	visible: boolean;
}

export default function CommandPanel({ commands, selectedIndex, query, visible }: Props) {
	// Don't show panel if not visible or no commands found
	if (!visible || commands.length === 0) {
		return null;
	}

	return (
		<Box flexDirection="column">
			<Box width="100%">
				<Box flexDirection="column" width="100%">
					<Box>
						<Text color="yellow" bold>
							Available Commands {query && `(${commands.length} matches)`}
						</Text>
					</Box>
					{commands.map((command, index) => (
						<Box key={command.name} flexDirection="row" width="100%">
							<Text color={index === selectedIndex ? "green" : "gray"}>
								{index === selectedIndex ? "➣ " : "  "}
								/{command.name}
							</Text>
							<Box marginLeft={2}>
								<Text color={index === selectedIndex ? "green" : "gray"} dimColor>
									{command.description}
								</Text>
							</Box>
						</Box>
					))}
				</Box>
			</Box>
		</Box>
	);
}