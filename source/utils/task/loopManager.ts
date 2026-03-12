import {randomUUID} from 'crypto';
import {taskManager} from './taskManager.js';
import {executeTaskInBackground} from './taskExecutor.js';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_LOOPS = 50;
const ACTIVE_TASK_STATUSES = new Set(['pending', 'running', 'paused']);

type LoopExecutionTaskStatus =
	| 'pending'
	| 'running'
	| 'paused'
	| 'failed'
	| 'completed';

export interface LoopSchedule {
	prompt: string;
	intervalMs: number;
	intervalLabel: string;
}

export interface LoopJobSummary {
	id: string;
	prompt: string;
	intervalMs: number;
	intervalLabel: string;
	createdAt: number;
	nextRunAt: number;
	lastRunAt?: number;
	lastTaskId?: string;
	lastTaskStatus?: LoopExecutionTaskStatus;
	runCount: number;
	skippedCount: number;
	lastError?: string;
}

interface LoopJob extends LoopJobSummary {
	timer: NodeJS.Timeout;
}

function clampPositiveInteger(value: number): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new Error('Loop interval must be a positive number.');
	}

	return Math.max(1, Math.floor(value));
}

function unitToMilliseconds(value: number, unit: string): number {
	const normalized = unit.toLowerCase();
	const amount = clampPositiveInteger(value);

	switch (normalized) {
		case 's':
		case 'sec':
		case 'secs':
		case 'second':
		case 'seconds': {
			return amount * 1000;
		}
		case 'm':
		case 'min':
		case 'mins':
		case 'minute':
		case 'minutes': {
			return amount * 60 * 1000;
		}
		case 'h':
		case 'hr':
		case 'hrs':
		case 'hour':
		case 'hours': {
			return amount * 60 * 60 * 1000;
		}
		case 'd':
		case 'day':
		case 'days': {
			return amount * 24 * 60 * 60 * 1000;
		}
		default: {
			throw new Error(`Unsupported loop interval unit: ${unit}`);
		}
	}
}

function millisecondsToLabel(intervalMs: number): string {
	if (intervalMs % (24 * 60 * 60 * 1000) === 0) {
		return `${intervalMs / (24 * 60 * 60 * 1000)}d`;
	}

	if (intervalMs % (60 * 60 * 1000) === 0) {
		return `${intervalMs / (60 * 60 * 1000)}h`;
	}

	if (intervalMs % (60 * 1000) === 0) {
		return `${intervalMs / (60 * 1000)}m`;
	}

	return `${intervalMs / 1000}s`;
}

function formatTimestamp(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}

export function parseLoopSchedule(rawArgs?: string): LoopSchedule {
	const args = rawArgs?.trim() || '';
	if (!args) {
		throw new Error(
			'Usage: /loop 5m <prompt> | /loop <prompt> every 2 hours | /loop list | /loop cancel <id> | /loop tasks',
		);
	}

	if (/^\d+\s*[a-zA-Z]+$/.test(args)) {
		throw new Error('Loop prompt is required after the interval.');
	}

	const prefixMatch = args.match(/^(\d+)\s*([a-zA-Z]+)\s+([\s\S]+)$/);
	if (prefixMatch?.[1] && prefixMatch[2] && prefixMatch[3]) {
		const intervalMs = unitToMilliseconds(
			Number.parseInt(prefixMatch[1], 10),
			prefixMatch[2],
		);
		return {
			prompt: prefixMatch[3].trim(),
			intervalMs,
			intervalLabel: millisecondsToLabel(intervalMs),
		};
	}

	const suffixMatch = args.match(/^([\s\S]+?)\s+every\s+(\d+)\s*([a-zA-Z]+)$/i);
	if (suffixMatch?.[1] && suffixMatch[2] && suffixMatch[3]) {
		const intervalMs = unitToMilliseconds(
			Number.parseInt(suffixMatch[2], 10),
			suffixMatch[3],
		);
		return {
			prompt: suffixMatch[1].trim(),
			intervalMs,
			intervalLabel: millisecondsToLabel(intervalMs),
		};
	}

	return {
		prompt: args,
		intervalMs: DEFAULT_INTERVAL_MS,
		intervalLabel: millisecondsToLabel(DEFAULT_INTERVAL_MS),
	};
}

class LoopManager {
	private readonly loops = new Map<string, LoopJob>();

	createLoop(schedule: LoopSchedule): LoopJobSummary {
		if (this.loops.size >= MAX_ACTIVE_LOOPS) {
			throw new Error(
				`Loop limit reached (${MAX_ACTIVE_LOOPS}). Cancel an existing loop before creating a new one.`,
			);
		}

		const id = randomUUID().replace(/-/g, '').slice(0, 8);
		const now = Date.now();
		const timer = setInterval(() => {
			void this.triggerLoop(id);
		}, schedule.intervalMs);
		timer.unref?.();

		const loop: LoopJob = {
			id,
			prompt: schedule.prompt,
			intervalMs: schedule.intervalMs,
			intervalLabel: schedule.intervalLabel,
			createdAt: now,
			nextRunAt: now + schedule.intervalMs,
			runCount: 0,
			skippedCount: 0,
			timer,
		};

		this.loops.set(id, loop);
		return this.toSummary(loop);
	}

	async listLoops(): Promise<LoopJobSummary[]> {
		const loops = [...this.loops.values()];
		await Promise.all(loops.map(async loop => this.syncTaskState(loop)));
		return loops
			.map(loop => this.toSummary(loop))
			.sort((a, b) => a.nextRunAt - b.nextRunAt);
	}

	async listTaskSummaries(): Promise<string[]> {
		const loops = await this.listLoops();
		const taskIds = loops
			.map(loop => loop.lastTaskId)
			.filter((taskId): taskId is string => Boolean(taskId));

		if (taskIds.length === 0) {
			return [];
		}

		const tasks = await Promise.all(
			taskIds.map(async taskId => taskManager.loadTask(taskId)),
		);
		return tasks
			.filter((task): task is NonNullable<typeof task> => Boolean(task))
			.map(task => `${task.id} • ${task.status} • ${task.title}`);
	}

	async cancelLoop(loopId: string): Promise<LoopJobSummary | null> {
		const loop = this.loops.get(loopId);
		if (!loop) {
			return null;
		}

		await this.syncTaskState(loop);
		clearInterval(loop.timer);
		this.loops.delete(loopId);
		return this.toSummary(loop);
	}

	private async syncTaskState(loop: LoopJob): Promise<void> {
		if (!loop.lastTaskId) {
			return;
		}

		const task = await taskManager.loadTask(loop.lastTaskId);
		if (!task) {
			loop.lastTaskStatus = undefined;
			return;
		}

		loop.lastTaskStatus = task.status;
		loop.lastError = task.error || loop.lastError;
	}

	private async triggerLoop(loopId: string): Promise<void> {
		const loop = this.loops.get(loopId);
		if (!loop) {
			return;
		}

		await this.syncTaskState(loop);
		if (loop.lastTaskStatus && ACTIVE_TASK_STATUSES.has(loop.lastTaskStatus)) {
			loop.skippedCount += 1;
			loop.nextRunAt = Date.now() + loop.intervalMs;
			return;
		}

		try {
			const task = await taskManager.createTask(loop.prompt);
			await executeTaskInBackground(task.id, loop.prompt);
			loop.lastTaskId = task.id;
			loop.lastTaskStatus = 'pending';
			loop.lastRunAt = Date.now();
			loop.nextRunAt = loop.lastRunAt + loop.intervalMs;
			loop.runCount += 1;
			loop.lastError = undefined;
		} catch (error) {
			loop.lastRunAt = Date.now();
			loop.nextRunAt = loop.lastRunAt + loop.intervalMs;
			loop.lastError =
				error instanceof Error ? error.message : 'Unknown loop execution error';
		}
	}

	private toSummary(loop: LoopJob): LoopJobSummary {
		return {
			id: loop.id,
			prompt: loop.prompt,
			intervalMs: loop.intervalMs,
			intervalLabel: loop.intervalLabel,
			createdAt: loop.createdAt,
			nextRunAt: loop.nextRunAt,
			lastRunAt: loop.lastRunAt,
			lastTaskId: loop.lastTaskId,
			lastTaskStatus: loop.lastTaskStatus,
			runCount: loop.runCount,
			skippedCount: loop.skippedCount,
			lastError: loop.lastError,
		};
	}
}

export function formatLoopSummary(loop: LoopJobSummary): string {
	const lines = [
		`${loop.id} • every ${loop.intervalLabel}`,
		`Prompt: ${loop.prompt}`,
		`Created: ${formatTimestamp(loop.createdAt)}`,
		`Next run: ${formatTimestamp(loop.nextRunAt)}`,
		`Runs: ${loop.runCount}`,
		`Skipped: ${loop.skippedCount}`,
	];

	if (loop.lastRunAt) {
		lines.push(`Last run: ${formatTimestamp(loop.lastRunAt)}`);
	}

	if (loop.lastTaskId) {
		lines.push(
			`Last task: ${loop.lastTaskId} (${loop.lastTaskStatus || 'unknown'})`,
		);
	}

	if (loop.lastError) {
		lines.push(`Last error: ${loop.lastError}`);
	}

	return lines.join('\n');
}

export const loopManager = new LoopManager();
