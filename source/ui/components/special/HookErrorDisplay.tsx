import React from 'react';
import {Box, Text} from 'ink';
import type {HookErrorDetails} from '../../../utils/execution/hookResultInterpreter.js';
import {HOOK_ACTION_ICONS, HOOK_DECOR_ICONS} from './hookIcons.js';

interface HookErrorDisplayProps {
	details: HookErrorDetails;
}

/**
 * 截断文本
 */
const truncate = (text: string, maxLength: number): string => {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength) + '...';
};

/**
 * Hook错误显示组件
 * 以树状结构显示Hook命令执行错误
 */
export const HookErrorDisplay: React.FC<HookErrorDisplayProps> = ({
	details,
}) => {
	const {type, exitCode, command, output, error} = details;

	// 组合输出
	const combinedOutput =
		[output, error].filter(Boolean).join('\n\n') || '(no output)';

	// 截断过长的内容
	const truncatedCommand = truncate(command, 150);
	const truncatedOutput = truncate(combinedOutput, 300);

	const isWarning = type === 'warning';
	const titleIcon = isWarning
		? HOOK_DECOR_ICONS.warning
		: HOOK_DECOR_ICONS.error;
	const title = isWarning
		? `${titleIcon} ${HOOK_DECOR_ICONS.hook} Hook Command Warning`
		: `${titleIcon} ${HOOK_DECOR_ICONS.hook} Hook Command Failed (Exit Code ${exitCode})`;
	const titleColor = isWarning ? 'yellow' : 'red';

	return (
		<Box flexDirection="column">
			<Text bold color={titleColor}>
				{title}
			</Text>
			<Box marginLeft={1}>
				<Text dimColor>
					{HOOK_DECOR_ICONS.treeBranch} {HOOK_DECOR_ICONS.gear}{' '}
					{HOOK_ACTION_ICONS.command}{' '}
				</Text>
				<Text>{truncatedCommand}</Text>
			</Box>
			<Box marginLeft={1}>
				<Text dimColor>
					{HOOK_DECOR_ICONS.treeEnd} {HOOK_DECOR_ICONS.output}{' '}
				</Text>
				<Text>{truncatedOutput}</Text>
			</Box>
		</Box>
	);
};
