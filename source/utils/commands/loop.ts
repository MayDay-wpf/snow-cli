import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	formatLoopSummary,
	loopManager,
	parseLoopSchedule,
} from '../task/loopManager.js';

const LOOP_USAGE =
	'Usage: /loop 5m <prompt> | /loop <prompt> every 2 hours | /loop list | /loop cancel <id> | /loop tasks';

registerCommand('loop', {
	execute: async (args?: string): Promise<CommandResult> => {
		const trimmedArgs = args?.trim();
		if (!trimmedArgs) {
			return {
				success: false,
				message: LOOP_USAGE,
			};
		}

		if (trimmedArgs === 'tasks') {
			const taskSummaries = await loopManager.listTaskSummaries();
			return {
				success: true,
				action: 'showTaskManager',
				message:
					taskSummaries.length > 0
						? [
								'Opening task manager...',
								'',
								'Related loop tasks:',
								...taskSummaries,
						  ].join('\n')
						: 'Opening task manager...',
			};
		}

		if (trimmedArgs === 'list') {
			const loops = await loopManager.listLoops();
			if (loops.length === 0) {
				return {
					success: true,
					message:
						'No active loops. Create one with /loop 5m <prompt> or /loop <prompt> every 2 hours.',
				};
			}

			return {
				success: true,
				message: loops.map(formatLoopSummary).join('\n\n'),
			};
		}

		const cancelMatch = trimmedArgs.match(
			/^(?:cancel|stop)\s+([a-zA-Z0-9_-]+)$/i,
		);
		if (cancelMatch?.[1]) {
			const loop = await loopManager.cancelLoop(cancelMatch[1]);
			if (!loop) {
				return {
					success: false,
					message: `Loop not found: ${cancelMatch[1]}`,
				};
			}

			return {
				success: true,
				message: `Cancelled loop ${loop.id} (every ${loop.intervalLabel})`,
			};
		}

		const schedule = parseLoopSchedule(trimmedArgs);
		const loop = loopManager.createLoop(schedule);
		return {
			success: true,
			message: [
				`Loop created: ${loop.id}`,
				`Schedule: every ${loop.intervalLabel}`,
				`Prompt: ${loop.prompt}`,
				`Next run: ${new Date(loop.nextRunAt).toLocaleString()}`,
				'Session-scoped only: loop jobs stop when Snow CLI exits.',
				'Use /loop list to inspect jobs or /loop cancel <id> to stop one.',
			].join('\n'),
		};
	},
});

export default {};
