import React, {useState, useMemo} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import {isSensitiveCommand} from '../../utils/sensitiveCommandManager.js';

export type ConfirmationResult =
	| 'approve'
	| 'approve_always'
	| 'reject'
	| {type: 'reject_with_reply'; reason: string};

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
function formatArgumentsAsTree(
	args: Record<string, any>,
	toolName?: string,
): Array<{key: string; value: string; isLast: boolean}> {
	// For filesystem-create and filesystem-edit, exclude content fields
	const excludeFields = new Set<string>();

	if (toolName === 'filesystem-create') {
		excludeFields.add('content');
	}
	if (toolName === 'filesystem-edit') {
		excludeFields.add('newContent');
	}
	if (toolName === 'filesystem-edit_search') {
		excludeFields.add('searchContent');
		excludeFields.add('replaceContent');
	}

	// For ACE tools, exclude large result fields that may contain extensive code
	if (toolName?.startsWith('ace-')) {
		excludeFields.add('context'); // ACE tools may return large context strings
		excludeFields.add('signature'); // Function signatures can be verbose
	}

	const keys = Object.keys(args).filter(key => !excludeFields.has(key));
	return keys.map((key, index) => ({
		key,
		value: formatArgumentValue(args[key]),
		isLast: index === keys.length - 1,
	}));
}

export default function ToolConfirmation({
	toolName,
	toolArguments,
	allTools,
	onConfirm,
}: Props) {
	const [hasSelected, setHasSelected] = useState(false);
	const [showRejectInput, setShowRejectInput] = useState(false);
	const [rejectReason, setRejectReason] = useState('');

	// Check if this is a sensitive command (for terminal-execute)
	const sensitiveCommandCheck = useMemo(() => {
		if (toolName !== 'terminal-execute' || !toolArguments) {
			return {isSensitive: false};
		}

		try {
			const parsed = JSON.parse(toolArguments);
			const command = parsed.command;
			if (command && typeof command === 'string') {
				return isSensitiveCommand(command);
			}
		} catch {
			// Ignore parse errors
		}

		return {isSensitive: false};
	}, [toolName, toolArguments]);

	// Parse and format tool arguments for display (single tool)
	const formattedArgs = useMemo(() => {
		if (!toolArguments) return null;

		try {
			const parsed = JSON.parse(toolArguments);
			return formatArgumentsAsTree(parsed, toolName);
		} catch {
			return null;
		}
	}, [toolArguments, toolName]);

	// Parse and format all tools arguments for display (multiple tools)
	const formattedAllTools = useMemo(() => {
		if (!allTools || allTools.length === 0) return null;

		return allTools.map(tool => {
			try {
				const parsed = JSON.parse(tool.function.arguments);
				return {
					name: tool.function.name,
					args: formatArgumentsAsTree(parsed, tool.function.name),
				};
			} catch {
				return {
					name: tool.function.name,
					args: [],
				};
			}
		});
	}, [allTools]);

	// Conditionally show "Always approve" based on sensitive command check
	const items = useMemo(() => {
		const baseItems: Array<{label: string; value: string}> = [
			{
				label: 'Approve (once)',
				value: 'approve',
			},
		];

		// Only show "Always approve" if NOT a sensitive command
		if (!sensitiveCommandCheck.isSensitive) {
			baseItems.push({
				label: 'Always approve this tool',
				value: 'approve_always',
			});
		}

		baseItems.push({
			label: 'Reject with reply',
			value: 'reject_with_reply',
		});

		baseItems.push({
			label: 'Reject (end session)',
			value: 'reject',
		});

		return baseItems;
	}, [sensitiveCommandCheck.isSensitive]);

	const handleSelect = (item: {label: string; value: string}) => {
		if (!hasSelected) {
			if (item.value === 'reject_with_reply') {
				setShowRejectInput(true);
			} else {
				setHasSelected(true);
				onConfirm(item.value as ConfirmationResult);
			}
		}
	};

	const handleRejectReasonSubmit = () => {
		if (!hasSelected && rejectReason.trim()) {
			setHasSelected(true);
			onConfirm({type: 'reject_with_reply', reason: rejectReason.trim()});
		}
	};

	return (
		<Box
			flexDirection="column"
			marginX={1}
			marginY={1}
			borderStyle={'round'}
			borderColor={'yellow'}
			paddingX={1}
		>
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
							Tool:{' '}
							<Text bold color="cyan">
								{toolName}
							</Text>
						</Text>
					</Box>

					{/* Display sensitive command warning */}
					{sensitiveCommandCheck.isSensitive && (
						<Box flexDirection="column" marginBottom={1}>
							<Box marginBottom={1}>
								<Text bold color="red">
									SENSITIVE COMMAND DETECTED
								</Text>
							</Box>

							<Box flexDirection="column" gap={0}>
								<Box>
									<Text dimColor>Pattern: </Text>
									<Text color="magenta" bold>
										{sensitiveCommandCheck.matchedCommand?.pattern}
									</Text>
								</Box>

								<Box marginTop={0}>
									<Text dimColor>Reason: </Text>
									<Text color="white">
										{sensitiveCommandCheck.matchedCommand?.description}
									</Text>
								</Box>
							</Box>

							<Box marginTop={1} paddingX={1} paddingY={0}>
								<Text color="yellow" italic>
									This command requires confirmation even in
									YOLO/Always-Approved mode
								</Text>
							</Box>
						</Box>
					)}

					{/* Display tool arguments in tree format */}
					{formattedArgs && formattedArgs.length > 0 && (
						<Box flexDirection="column" marginBottom={1}>
							<Text dimColor>Arguments:</Text>
							{formattedArgs.map((arg, index) => (
								<Box key={index} flexDirection="column">
									<Text color="gray" dimColor>
										{arg.isLast ? '└─' : '├─'} {arg.key}:{' '}
										<Text color="white">{arg.value}</Text>
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
							Tools:{' '}
							<Text bold color="cyan">
								{formattedAllTools.length} tools in parallel
							</Text>
						</Text>
					</Box>

					{formattedAllTools.map((tool, toolIndex) => (
						<Box
							key={toolIndex}
							flexDirection="column"
							marginBottom={toolIndex < formattedAllTools.length - 1 ? 1 : 0}
						>
							<Text color="cyan" bold>
								{toolIndex + 1}. {tool.name}
							</Text>
							{tool.args.length > 0 && (
								<Box flexDirection="column" paddingLeft={2}>
									{tool.args.map((arg, argIndex) => (
										<Text key={argIndex} color="gray" dimColor>
											{arg.isLast ? '└─' : '├─'} {arg.key}:{' '}
											<Text color="white">{arg.value}</Text>
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

			{!hasSelected && !showRejectInput && (
				<SelectInput items={items} onSelect={handleSelect} />
			)}

			{showRejectInput && !hasSelected && (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color="yellow">Enter rejection reason:</Text>
					</Box>
					<Box marginBottom={1}>
						<Text color="cyan">&gt; </Text>
						<TextInput
							value={rejectReason}
							onChange={setRejectReason}
							onSubmit={handleRejectReasonSubmit}
						/>
					</Box>
					<Box>
						<Text dimColor>Press Enter to submit</Text>
					</Box>
				</Box>
			)}

			{hasSelected && (
				<Box>
					<Text color="green">Confirmed</Text>
				</Box>
			)}
		</Box>
	);
}
