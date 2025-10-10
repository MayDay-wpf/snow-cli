import React, { useState, useMemo } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

export type ConfirmationResult = 'approve' | 'approve_always' | 'reject';

export interface ToolCall {
	id: string;
	type: 'function';
	function: {
		name: string;
		arguments: string;
	};
}

interface Props {
	toolName: string;
	toolArguments?: string; // JSON string of tool arguments
	allTools?: ToolCall[]; // All tools when confirming multiple tools in parallel
	onConfirm: (result: ConfirmationResult) => void;
}

// Helper function to format argument values with truncation
function formatArgumentValue(value: any, maxLength: number = 100): string {
	if (value === null || value === undefined) {
		return String(value);
	}

	const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

	if (stringValue.length <= maxLength) {
		return stringValue;
	}

	return stringValue.substring(0, maxLength) + '...';
}

// Helper function to convert parsed arguments to tree display format
function formatArgumentsAsTree(args: Record<string, any>): Array<{key: string; value: string; isLast: boolean}> {
	const keys = Object.keys(args);
	return keys.map((key, index) => ({
		key,
		value: formatArgumentValue(args[key]),
		isLast: index === keys.length - 1
	}));
}

export default function ToolConfirmation({ toolName, toolArguments, allTools, onConfirm }: Props) {
	const [hasSelected, setHasSelected] = useState(false);

	// Parse and format tool arguments for display (single tool)
	const formattedArgs = useMemo(() => {
		if (!toolArguments) return null;

		try {
			const parsed = JSON.parse(toolArguments);
			return formatArgumentsAsTree(parsed);
		} catch {
			return null;
		}
	}, [toolArguments]);

	// Parse and format all tools arguments for display (multiple tools)
	const formattedAllTools = useMemo(() => {
		if (!allTools || allTools.length === 0) return null;

		return allTools.map(tool => {
			try {
				const parsed = JSON.parse(tool.function.arguments);
				return {
					name: tool.function.name,
					args: formatArgumentsAsTree(parsed)
				};
			} catch {
				return {
					name: tool.function.name,
					args: []
				};
			}
		});
	}, [allTools]);

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

			{/* Display single tool */}
			{!formattedAllTools && (
				<>
					<Box marginBottom={1}>
						<Text>
							Tool: <Text bold color="cyan">{toolName}</Text>
						</Text>
					</Box>

					{/* Display tool arguments in tree format */}
					{formattedArgs && formattedArgs.length > 0 && (
						<Box flexDirection="column" marginBottom={1}>
							<Text dimColor>Arguments:</Text>
							{formattedArgs.map((arg, index) => (
								<Box key={index} flexDirection="column">
									<Text color="gray" dimColor>
										{arg.isLast ? '└─' : '├─'} {arg.key}: <Text color="white">{arg.value}</Text>
									</Text>
								</Box>
							))}
						</Box>
					)}
				</>
			)}

			{/* Display multiple tools */}
			{formattedAllTools && (
				<Box flexDirection="column" marginBottom={1}>
					<Box marginBottom={1}>
						<Text>
							Tools: <Text bold color="cyan">{formattedAllTools.length} tools in parallel</Text>
						</Text>
					</Box>

					{formattedAllTools.map((tool, toolIndex) => (
						<Box key={toolIndex} flexDirection="column" marginBottom={toolIndex < formattedAllTools.length - 1 ? 1 : 0}>
							<Text color="cyan" bold>
								{toolIndex + 1}. {tool.name}
							</Text>
							{tool.args.length > 0 && (
								<Box flexDirection="column" paddingLeft={2}>
									{tool.args.map((arg, argIndex) => (
										<Text key={argIndex} color="gray" dimColor>
											{arg.isLast ? '└─' : '├─'} {arg.key}: <Text color="white">{arg.value}</Text>
										</Text>
									))}
								</Box>
							)}
						</Box>
					))}
				</Box>
			)}

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
