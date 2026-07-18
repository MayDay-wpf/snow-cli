import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import type {Message} from './MessageList.js';
import Spinner from 'ink-spinner';
import {
	formatDurationMs,
	formatElapsedTime,
	MIN_TOOL_DURATION_DISPLAY_MS,
} from '../../../utils/core/textUtils.js';

interface Props {
	messages: Message[];
}

/**
 * 动态渲染正在执行的两步工具（toolPending: true）。
 * 从 Static 中排除后，在此展示实时运行时间，避免完成后残留 pending。
 */
export default function PendingToolCalls({messages}: Props) {
	const pendingTools = messages.filter(
		msg =>
			(msg.role === 'assistant' || msg.role === 'subagent') &&
			msg.toolPending === true,
	);

	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (pendingTools.length === 0) {
			return;
		}
		const timer = setInterval(() => {
			setNow(Date.now());
		}, 1000);
		return () => clearInterval(timer);
	}, [pendingTools.length]);

	if (pendingTools.length === 0) {
		return null;
	}

	return (
		<Box flexDirection="column">
			{pendingTools.map((tool, index) => {
				const startedAt =
					typeof tool.toolStartedAt === 'number' ? tool.toolStartedAt : undefined;
				const elapsedMs =
					startedAt !== undefined ? Math.max(0, now - startedAt) : 0;
				const elapsedSeconds = Math.floor(elapsedMs / 1000);
				const showElapsed =
					startedAt !== undefined && elapsedMs >= MIN_TOOL_DURATION_DISPLAY_MS;
				const elapsedLabel = showElapsed
					? formatElapsedTime(Math.max(elapsedSeconds, 1)) ||
					  formatDurationMs(elapsedMs)
					: '';

				return (
					<Box key={tool.toolCallId || `pending-tool-${index}`}>
						<Text color="yellow">
							<Spinner type="dots" />{' '}
						</Text>
						<Text color="yellow">{tool.content || 'Running tool'}</Text>
						{elapsedLabel ? (
							<Text color="cyan" dimColor>
								{' '}
								({elapsedLabel})
							</Text>
						) : null}
					</Box>
				);
			})}
		</Box>
	);
}
