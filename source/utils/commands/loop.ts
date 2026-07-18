import {
	registerCommand,
	type CommandResult,
} from '../execution/commandExecutor.js';
import {
	formatLoopSchedule,
	formatLoopSummary,
	loopManager,
	parseLoopSchedule,
} from '../task/loopManager.js';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

function format(template: string, params: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (_, key) =>
		key in params ? params[key]! : `{${key}}`,
	);
}

registerCommand('loop', {
	execute: async (args?: string): Promise<CommandResult> => {
		const lang = getCurrentLanguage();
		const t = translations[lang]?.commandPanel?.commandOutput?.loop;
		const fallback = translations.en.commandPanel.commandOutput.loop;
		const m = (key: keyof typeof fallback): string =>
			(t?.[key] as string) || fallback[key];

		const trimmedArgs = args?.trim();
		if (!trimmedArgs) {
			return {
				success: false,
				message: m('usage'),
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
								m('openingTaskManager'),
								'',
								m('relatedLoopTasks'),
								...taskSummaries,
						  ].join('\n')
						: m('openingTaskManager'),
			};
		}

		if (trimmedArgs === 'list') {
			const loops = await loopManager.listLoops();
			if (loops.length === 0) {
				return {
					success: true,
					message: m('noActiveLoops'),
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
					message: format(m('loopNotFound'), {id: cancelMatch[1]}),
				};
			}

			const scheduleText = formatLoopSchedule(loop);
			return {
				success: true,
				message: format(m('cancelled'), {
					id: loop.id,
					interval: scheduleText,
					schedule: scheduleText,
				}),
			};
		}

		const schedule = parseLoopSchedule(trimmedArgs);
		const loop = loopManager.createLoop(schedule);
		const scheduleText = formatLoopSchedule(loop);
		const modeNote =
			loop.mode === 'daemon' ? m('daemonScopedNote') : m('sessionScopedNote');
		return {
			success: true,
			message: [
				format(m('created'), {id: loop.id}),
				format(m('scheduleEvery'), {
					interval: scheduleText,
					schedule: scheduleText,
				}),
				format(m('promptLabel'), {prompt: loop.prompt}),
				format(m('nextRun'), {
					time: new Date(loop.nextRunAt).toLocaleString(),
				}),
				modeNote,
				loop.logPath ? format(m('logPath'), {path: loop.logPath}) : undefined,
				m('usageHint'),
			]
				.filter((line): line is string => Boolean(line))
				.join('\n'),
		};
	},
});

export default {};
