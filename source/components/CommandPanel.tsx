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
	if (!visible) {
		return null;
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			<Box 
				borderStyle="round" 
				borderColor="yellow" 
				paddingX={1} 
				paddingY={0}
				width="100%"
			>
				<Box flexDirection="column" width="100%">
					{commands.length > 0 ? (
						<>
							<Box marginBottom={1}>
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
						</>
					) : (
						<Box marginBottom={1}>
							<Text color="red">
								No commands found matching "{query}"
							</Text>
						</Box>
					)}
					<Box marginTop={1}>
						<Text color="gray" dimColor>
							↑↓ Navigate • Enter Select • Esc Cancel
						</Text>
					</Box>
				</Box>
			</Box>
		</Box>
	);
}