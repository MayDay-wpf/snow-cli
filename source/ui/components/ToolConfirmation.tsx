import React, { useState } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

export type ConfirmationResult = 'approve' | 'approve_always' | 'reject';

interface Props {
	toolName: string;
	onConfirm: (result: ConfirmationResult) => void;
}

export default function ToolConfirmation({ toolName, onConfirm }: Props) {
	const [hasSelected, setHasSelected] = useState(false);

	const items = [
		{
			label: 'Approve (once)',
			value: 'approve' as ConfirmationResult
		},
		{
			label: 'Always approve this tool',
			value: 'approve_always' as ConfirmationResult
		},
		{
			label: 'Reject (end session)',
			value: 'reject' as ConfirmationResult
		}
	];

	const handleSelect = (item: { label: string; value: ConfirmationResult }) => {
		if (!hasSelected) {
			setHasSelected(true);
			onConfirm(item.value);
		}
	};

	return (
		<Box flexDirection="column" marginX={1} marginY={1} borderStyle="round" borderColor="yellow" paddingX={1}>
			<Box marginBottom={1}>
				<Text bold color="yellow">
					[Tool Confirmation]
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text>
					Tool: <Text bold color="cyan">{toolName}</Text>
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text dimColor>Select action:</Text>
			</Box>

			{!hasSelected && (
				<SelectInput items={items} onSelect={handleSelect} />
			)}

			{hasSelected && (
				<Box>
					<Text color="green">Confirmed</Text>
				</Box>
			)}
		</Box>
	);
}
