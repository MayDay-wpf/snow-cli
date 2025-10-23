import React from 'react';
import {Box, Text} from 'ink';
import type {Message} from './MessageList.js';
import Spinner from 'ink-spinner';

interface Props {
	messages: Message[];
}

/**
 * 显示正在执行的工具调用(只显示耗时工具)
 * 这些消息有 toolPending: true 标记
 */
export default function PendingToolCalls({messages}: Props) {
	// 筛选出正在执行的工具调用消息
	const pendingTools = messages.filter(
		msg => msg.role === 'assistant' && msg.toolPending === true,
	);

	if (pendingTools.length === 0) {
		return null;
	}

	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor="cyan"
			paddingX={1}
		>
			<Text color="cyan" bold>
				<Spinner type="dots" /> Executing Tools ({pendingTools.length})
			</Text>
			{pendingTools.map((tool, index) => (
				<Box key={index} marginLeft={1} marginY={0}>
					<Text color="yellow" bold>
						{index + 1}.
					</Text>
					<Box marginLeft={1}>
						<Text color="gray">{tool.content}</Text>
					</Box>
					{/* 显示工具参数 */}
					{tool.toolDisplay && tool.toolDisplay.args.length > 0 && (
						<Box flexDirection="column" marginLeft={2}>
							{tool.toolDisplay.args.slice(0, 3).map((arg, argIndex) => (
								<Text key={argIndex} color="gray" dimColor>
									{arg.key}: {arg.value.length > 50 ? `${arg.value.substring(0, 50)}...` : arg.value}
								</Text>
							))}
							{tool.toolDisplay.args.length > 3 && (
								<Text color="gray" dimColor>
									... and {tool.toolDisplay.args.length - 3} more args
								</Text>
							)}
						</Box>
					)}
				</Box>
			))}
		</Box>
	);
}
