import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

type Props = {
	fileCount: number;
	onConfirm: (rollbackFiles: boolean) => void;
};

export default function FileRollbackConfirmation({ fileCount, onConfirm }: Props) {
	const [selectedIndex, setSelectedIndex] = useState(0);

	const options = [
		{ label: 'Yes, rollback files and conversation', value: true },
		{ label: 'No, rollback conversation only', value: false }
	];

	useInput((_, key) => {
		// Up arrow
		if (key.upArrow) {
			setSelectedIndex(prev => Math.max(0, prev - 1));
			return;
		}

		// Down arrow
		if (key.downArrow) {
			setSelectedIndex(prev => Math.min(options.length - 1, prev + 1));
			return;
		}

		// Enter - confirm selection
		if (key.return) {
			onConfirm(options[selectedIndex]?.value ?? false);
			return;
		}

		// ESC - cancel rollback (select "No")
		if (key.escape) {
			onConfirm(false);
			return;
		}
	});

	return (
		<Box flexDirection="column" marginX={1} marginBottom={1} borderStyle="round" borderColor="yellow" padding={1}>
			<Box marginBottom={1}>
				<Text color="yellow" bold>
					⚠  File Rollback Confirmation
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color="white">
					This checkpoint has {fileCount} file{fileCount > 1 ? 's' : ''} that will be rolled back.
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color="gray" dimColor>
					Do you want to rollback the files as well?
				</Text>
			</Box>

			<Box flexDirection="column">
				{options.map((option, index) => (
					<Box key={index}>
						<Text
							color={index === selectedIndex ? 'green' : 'white'}
							bold={index === selectedIndex}
						>
							{index === selectedIndex ? '❯  ' : '  '}
							{option.label}
						</Text>
					</Box>
				))}
			</Box>

			<Box marginTop={1}>
				<Text color="gray" dimColor>
					Use ↑↓ to select, Enter to confirm, ESC to cancel
				</Text>
			</Box>
		</Box>
	);
}
