import type {MCPTool} from '../utils/execution/mcpToolsManager.js';

export interface SchedulerTaskArgs {
	/**
	 * 等待时长（秒），范围 1-3600
	 */
	duration: number;
	/**
	 * 任务描述文本
	 */
	description: string;
}

export interface SchedulerTaskResult {
	/**
	 * 任务是否成功完成
	 */
	success: boolean;
	/**
	 * 任务描述
	 */
	description: string;
	/**
	 * 实际等待时长（秒）
	 */
	actualDuration: number;
	/**
	 * 任务完成时间
	 */
	completedAt: string;
}

export const mcpTools: MCPTool[] = [
	{
		type: 'function',
		function: {
			name: 'scheduler-schedule_task',
			description:
				"Schedule a task to be executed after a specified duration. When called, this tool blocks the AI workflow, displays a countdown interface, and returns the task information upon completion. Useful for delayed execution scenarios like reminders or scheduled processing. IMPORTANT: This tool only accepts duration in seconds. If the user specifies a specific time (e.g., '3 PM', '15:30') instead of a duration, you MUST first use terminal-execute tool to run 'date +%s' (Unix) or 'powershell -Command [DateTimeOffset]::Now.ToUnixTimeSeconds()' (Windows) to get the current timestamp, then calculate the seconds until the target time, and use that calculated duration with this tool.",
			parameters: {
				type: 'object',
				properties: {
					duration: {
						type: 'number',
						description:
							'Wait duration in seconds. Minimum 1 second, maximum 3600 seconds (1 hour). If user specifies a specific time (e.g., "3 PM", "15:30"), use terminal-execute to get current timestamp first, then calculate seconds from now to the target time.',
						minimum: 1,
						maximum: 3600,
					},
					description: {
						type: 'string',
						description:
							"Task description explaining the purpose of this scheduled task. Will be displayed in the countdown interface and task result. Example: 'Remind me to check emails at 3 PM'.",
					},
				},
				required: ['duration', 'description'],
			},
		},
	},
];
