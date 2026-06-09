import {spawn} from 'child_process';
import {randomUUID} from 'crypto';
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
import {taskManager} from './taskManager.js';
import {executeTaskInBackground} from './taskExecutor.js';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const MAX_ACTIVE_LOOPS = 50;
const ACTIVE_TASK_STATUSES = new Set(['pending', 'running', 'paused']);
const LOOP_DAEMON_DIR = join(homedir(), '.snow', 'loop-daemons');
const LOOP_DAEMON_LOG_DIR = join(homedir(), '.snow', 'loop-logs');

type LoopExecutionTaskStatus =
	| 'pending'
	| 'running'
	| 'paused'
	| 'failed'
	| 'completed';

export type LoopMode = 'session' | 'daemon';
export type LoopScheduleKind = 'interval' | 'dailyTime';

export interface LoopDailyTime {
	hour: number;
	minute: number;
	label: string;
}

export interface LoopSchedule {
	prompt: string;
	intervalMs: number;
	intervalLabel: string;
	mode: LoopMode;
	scheduleKind: LoopScheduleKind;
	dailyTime?: LoopDailyTime;
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
	mode: LoopMode;
	pid?: number;
	logPath?: string;
	scheduleKind: LoopScheduleKind;
	dailyTime?: LoopDailyTime;
}
interface LoopJob extends LoopJobSummary {
	timer?: NodeJS.Timeout;
}

interface LoopDaemonState extends LoopJobSummary {
	cwd: string;
}

function ensureLoopDaemonDirs(): void {
	if (!existsSync(LOOP_DAEMON_DIR)) {
		mkdirSync(LOOP_DAEMON_DIR, {recursive: true});
	}

	if (!existsSync(LOOP_DAEMON_LOG_DIR)) {
		mkdirSync(LOOP_DAEMON_LOG_DIR, {recursive: true});
	}
}

function getLoopDaemonFilePath(loopId: string): string {
	ensureLoopDaemonDirs();
	return join(LOOP_DAEMON_DIR, `${loopId}.json`);
}

function getLoopDaemonLogPath(loopId: string): string {
	ensureLoopDaemonDirs();
	return join(LOOP_DAEMON_LOG_DIR, `${loopId}.log`);
}

function isProcessAlive(pid?: number): boolean {
	if (!pid) {
		return false;
	}

	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readLoopDaemonState(filePath: string): LoopDaemonState | null {
	try {
		const state: LoopDaemonState = JSON.parse(readFileSync(filePath, 'utf-8'));
		if (!isProcessAlive(state.pid)) {
			unlinkSync(filePath);
			return null;
		}

		return {
			...state,
			scheduleKind: state.scheduleKind ?? 'interval',
		};
	} catch {
		try {
			unlinkSync(filePath);
		} catch {}

		return null;
	}
}

function writeLoopDaemonState(state: LoopDaemonState): void {
	writeFileSync(
		getLoopDaemonFilePath(state.id),
		JSON.stringify(state, null, 2),
	);
}

function writeLoopDaemonLog(loopId: string, message: string): void {
	try {
		const timestamp = new Date().toISOString();
		writeFileSync(getLoopDaemonLogPath(loopId), `[${timestamp}] ${message}\n`, {
			flag: 'a',
		});
	} catch {}
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

/**
 * Parse a combined duration string (e.g. "8h30m", "1h15m30s", "1d12h") into total milliseconds.
 * Each unit segment is forwarded to unitToMilliseconds for validation and conversion.
 */
function parseDurationString(durationStr: string): number {
	const pattern = /(\d+)\s*([a-zA-Z]+)/g;
	let match: RegExpExecArray | null;
	let totalMs = 0;
	while ((match = pattern.exec(durationStr)) !== null) {
		const value = Number.parseInt(match[1]!, 10);
		const unit = match[2]!;
		totalMs += unitToMilliseconds(value, unit);
	}
	if (totalMs <= 0) {
		throw new Error('Invalid duration string.');
	}
	return totalMs;
}

function formatTimestamp(timestamp: number): string {
	return new Date(timestamp).toLocaleString();
}

function normalizeLoopModeArgs(rawArgs: string): {
	args: string;
	mode: LoopMode;
} {
	let args = rawArgs.trim();
	let mode: LoopMode = 'session';

	if (/^daemon\s+/i.test(args)) {
		mode = 'daemon';
		args = args.replace(/^daemon\s+/i, '').trim();
	}

	if (/(?:^|\s)--daemon(?:\s|$)/i.test(args)) {
		mode = 'daemon';
		args = args.replace(/(?:^|\s)--daemon(?=\s|$)/gi, ' ').trim();
	}

	return {args, mode};
}

function parseDailyTime(timeText: string): LoopDailyTime {
	const match = timeText.match(/^(\d{1,2}):(\d{2})$/);
	if (!match?.[1] || !match[2]) {
		throw new Error('Daily loop time must use HH:mm format.');
	}

	const hour = Number.parseInt(match[1], 10);
	const minute = Number.parseInt(match[2], 10);
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
		throw new Error('Daily loop time must be between 00:00 and 23:59.');
	}

	return {
		hour,
		minute,
		label: `${hour.toString().padStart(2, '0')}:${minute
			.toString()
			.padStart(2, '0')}`,
	};
}

function createIntervalSchedule(
	prompt: string,
	intervalMs: number,
	mode: LoopMode,
): LoopSchedule {
	return {
		prompt: prompt.trim(),
		intervalMs,
		intervalLabel: millisecondsToLabel(intervalMs),
		mode,
		scheduleKind: 'interval',
	};
}

function createDailyTimeSchedule(
	prompt: string,
	timeText: string,
	mode: LoopMode,
): LoopSchedule {
	const dailyTime = parseDailyTime(timeText);
	return {
		prompt: prompt.trim(),
		intervalMs: 24 * 60 * 60 * 1000,
		intervalLabel: dailyTime.label,
		mode,
		scheduleKind: 'dailyTime',
		dailyTime,
	};
}

export function parseLoopSchedule(rawArgs?: string): LoopSchedule {
	const raw = rawArgs?.trim() || '';
	const {args, mode} = normalizeLoopModeArgs(raw);
	if (!args) {
		throw new Error(
			'Usage: /loop 5m <prompt> | /loop daemon 5m <prompt> | /loop daily 09:30 <prompt> | /loop at 09:30 <prompt> | /loop every day at 09:30 <prompt> | /loop <prompt> every day at 09:30 | /loop list | /loop cancel <id> | /loop tasks',
		);
	}

	if (/^(?:\d+\s*[a-zA-Z]+\s*)+\s*$/.test(args)) {
		throw new Error('Loop prompt is required after the interval.');
	}

	const dailyPrefixMatch = args.match(/^(?:daily|at)\s+(\S+)\s+([\s\S]+)$/i);
	if (dailyPrefixMatch?.[1] && dailyPrefixMatch[2]) {
		return createDailyTimeSchedule(
			dailyPrefixMatch[2],
			dailyPrefixMatch[1],
			mode,
		);
	}

	if (/^(?:daily|at)\s+/i.test(args)) {
		throw new Error(
			'Daily loop time and prompt are required. Example: /loop daily 09:30 <prompt>',
		);
	}

	const dailyEveryPrefixMatch = args.match(
		/^every\s+day\s+at\s+(\S+)\s+([\s\S]+)$/i,
	);
	if (dailyEveryPrefixMatch?.[1] && dailyEveryPrefixMatch[2]) {
		return createDailyTimeSchedule(
			dailyEveryPrefixMatch[2],
			dailyEveryPrefixMatch[1],
			mode,
		);
	}

	const dailySuffixMatch = args.match(
		/^([\s\S]+?)\s+every\s+day\s+at\s+(\S+)$/i,
	);
	if (dailySuffixMatch?.[1] && dailySuffixMatch[2]) {
		return createDailyTimeSchedule(
			dailySuffixMatch[1],
			dailySuffixMatch[2],
			mode,
		);
	}

	const prefixMatch = args.match(/^((?:\d+\s*[a-zA-Z]+\s*)+?)\s+([\s\S]+)$/);
	if (prefixMatch?.[1] && prefixMatch[2]) {
		const intervalMs = parseDurationString(prefixMatch[1]);
		return createIntervalSchedule(prefixMatch[2], intervalMs, mode);
	}

	const suffixMatch = args.match(/^([\s\S]+?)\s+every\s+(\d+)\s*([a-zA-Z]+)$/i);
	if (suffixMatch?.[1] && suffixMatch[2] && suffixMatch[3]) {
		const intervalMs = unitToMilliseconds(
			Number.parseInt(suffixMatch[2], 10),
			suffixMatch[3],
		);
		return createIntervalSchedule(suffixMatch[1], intervalMs, mode);
	}

	return createIntervalSchedule(args, DEFAULT_INTERVAL_MS, mode);
}

class LoopManager {
	private readonly loops = new Map<string, LoopJob>();

	createLoop(schedule: LoopSchedule): LoopJobSummary {
		if (schedule.mode === 'daemon') {
			return this.createDaemonLoop(schedule);
		}

		return this.createSessionLoop(schedule);
	}

	private calculateNextRunAt(
		loop: Pick<LoopJobSummary, 'scheduleKind' | 'dailyTime' | 'intervalMs'>,
		from = Date.now(),
	): number {
		if (loop.scheduleKind !== 'dailyTime' || !loop.dailyTime) {
			return from + loop.intervalMs;
		}

		const next = new Date(from);
		next.setHours(loop.dailyTime.hour, loop.dailyTime.minute, 0, 0);
		if (next.getTime() <= from) {
			next.setDate(next.getDate() + 1);
		}

		return next.getTime();
	}

	private scheduleTimer(loop: LoopJob): void {
		const delayMs = Math.max(1, loop.nextRunAt - Date.now());
		loop.timer = setTimeout(() => {
			void this.triggerLoop(loop.id);
		}, delayMs);
		loop.timer.unref?.();
	}

	async listLoops(): Promise<LoopJobSummary[]> {
		const loops = [...this.loops.values()];
		await Promise.all(loops.map(async loop => this.syncTaskState(loop)));
		const sessionLoops = loops.map(loop => this.toSummary(loop));
		const daemonLoops = await this.listDaemonLoops();

		return [...sessionLoops, ...daemonLoops].sort(
			(a, b) => a.nextRunAt - b.nextRunAt,
		);
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
		if (loop) {
			await this.syncTaskState(loop);
			if (loop.timer) {
				clearTimeout(loop.timer);
			}

			this.loops.delete(loopId);
			return this.toSummary(loop);
		}

		return this.cancelDaemonLoop(loopId);
	}

	async runDaemonLoop(state: LoopDaemonState): Promise<void> {
		const loop: LoopJob = {
			...state,
			scheduleKind: state.scheduleKind ?? 'interval',
			pid: process.pid,
			mode: 'daemon',
		};

		loop.nextRunAt = this.calculateNextRunAt(loop);
		this.loops.set(loop.id, loop);
		this.scheduleTimer(loop);
		writeLoopDaemonState({...this.toSummary(loop), cwd: state.cwd});
		writeLoopDaemonLog(loop.id, `Loop daemon started. PID: ${process.pid}`);

		process.on('SIGTERM', () => {
			writeLoopDaemonLog(loop.id, 'Loop daemon received SIGTERM.');
			try {
				unlinkSync(getLoopDaemonFilePath(loop.id));
			} catch {}

			process.exit(0);
		});

		process.on('SIGINT', () => {
			writeLoopDaemonLog(loop.id, 'Loop daemon received SIGINT.');
			try {
				unlinkSync(getLoopDaemonFilePath(loop.id));
			} catch {}

			process.exit(0);
		});

		await new Promise(() => {});
	}

	private createSessionLoop(schedule: LoopSchedule): LoopJobSummary {
		if (this.loops.size >= MAX_ACTIVE_LOOPS) {
			throw new Error(
				`Loop limit reached (${MAX_ACTIVE_LOOPS}). Cancel an existing loop before creating a new one.`,
			);
		}

		const id = randomUUID().replace(/-/g, '').slice(0, 8);
		const now = Date.now();
		const loop: LoopJob = {
			id,
			prompt: schedule.prompt,
			intervalMs: schedule.intervalMs,
			intervalLabel: schedule.intervalLabel,
			createdAt: now,
			nextRunAt: this.calculateNextRunAt(schedule, now),
			runCount: 0,
			skippedCount: 0,
			mode: 'session',
			scheduleKind: schedule.scheduleKind,
			dailyTime: schedule.dailyTime,
		};

		this.loops.set(id, loop);
		this.scheduleTimer(loop);
		return this.toSummary(loop);
	}

	private createDaemonLoop(schedule: LoopSchedule): LoopJobSummary {
		const id = randomUUID().replace(/-/g, '').slice(0, 8);
		const now = Date.now();
		const logPath = getLoopDaemonLogPath(id);
		const state: LoopDaemonState = {
			id,
			prompt: schedule.prompt,
			intervalMs: schedule.intervalMs,
			intervalLabel: schedule.intervalLabel,
			createdAt: now,
			nextRunAt: this.calculateNextRunAt(schedule, now),
			runCount: 0,
			skippedCount: 0,
			mode: 'daemon',
			logPath,
			scheduleKind: schedule.scheduleKind,
			dailyTime: schedule.dailyTime,
			cwd: process.cwd(),
		};

		const scriptPath = process.argv[1] || '';
		const payload = Buffer.from(JSON.stringify(state), 'utf-8').toString(
			'base64',
		);
		const commandArgs = ['--loop-daemon-execute', payload];
		const isDev = scriptPath.includes('source');
		const command = isDev ? 'npx' : process.execPath;
		const args = isDev
			? ['tsx', scriptPath, ...commandArgs]
			: [scriptPath, ...commandArgs];
		const child = spawn(command, args, {
			detached: true,
			stdio: ['ignore', 'ignore', 'ignore'],
			windowsHide: true,
			cwd: state.cwd,
			env: {...process.env, SNOW_LOOP_DAEMON: 'true', SNOW_LOOP_ID: id},
		});

		child.unref();
		state.pid = child.pid;
		writeLoopDaemonState(state);
		writeLoopDaemonLog(
			id,
			`Loop daemon spawned. PID: ${child.pid ?? 'unknown'}`,
		);

		return state;
	}

	private async listDaemonLoops(): Promise<LoopJobSummary[]> {
		ensureLoopDaemonDirs();
		return readdirSync(LOOP_DAEMON_DIR)
			.filter(file => file.endsWith('.json'))
			.map(file => readLoopDaemonState(join(LOOP_DAEMON_DIR, file)))
			.filter((state): state is LoopDaemonState => Boolean(state))
			.map(state => ({
				id: state.id,
				prompt: state.prompt,
				intervalMs: state.intervalMs,
				intervalLabel: state.intervalLabel,
				createdAt: state.createdAt,
				nextRunAt: state.nextRunAt,
				lastRunAt: state.lastRunAt,
				lastTaskId: state.lastTaskId,
				lastTaskStatus: state.lastTaskStatus,
				runCount: state.runCount,
				skippedCount: state.skippedCount,
				lastError: state.lastError,
				mode: 'daemon',
				pid: state.pid,
				logPath: state.logPath,
				scheduleKind: state.scheduleKind,
				dailyTime: state.dailyTime,
			}));
	}

	private async cancelDaemonLoop(
		loopId: string,
	): Promise<LoopJobSummary | null> {
		const filePath = getLoopDaemonFilePath(loopId);
		if (!existsSync(filePath)) {
			return null;
		}

		const state = readLoopDaemonState(filePath);
		if (!state) {
			return null;
		}

		if (state.pid) {
			try {
				process.kill(state.pid, 'SIGTERM');
			} catch (error) {
				state.lastError =
					error instanceof Error ? error.message : 'Failed to stop loop daemon';
			}
		}

		try {
			unlinkSync(filePath);
		} catch {}

		return state;
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
			loop.nextRunAt = this.calculateNextRunAt(loop);
			this.persistDaemonState(loop);
			this.scheduleTimer(loop);
			return;
		}

		try {
			const task = await taskManager.createTask(loop.prompt);
			await executeTaskInBackground(task.id, loop.prompt);
			loop.lastTaskId = task.id;
			loop.lastTaskStatus = 'pending';
			loop.lastRunAt = Date.now();
			loop.nextRunAt = this.calculateNextRunAt(loop, loop.lastRunAt);
			loop.runCount += 1;
			loop.lastError = undefined;
		} catch (error) {
			loop.lastRunAt = Date.now();
			loop.nextRunAt = this.calculateNextRunAt(loop, loop.lastRunAt);
			loop.lastError =
				error instanceof Error ? error.message : 'Unknown loop execution error';
		}

		this.persistDaemonState(loop);
		this.scheduleTimer(loop);
	}

	private persistDaemonState(loop: LoopJob): void {
		if (loop.mode !== 'daemon') {
			return;
		}

		writeLoopDaemonState({...this.toSummary(loop), cwd: process.cwd()});
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
			mode: loop.mode,
			pid: loop.pid,
			logPath: loop.logPath,
			scheduleKind: loop.scheduleKind,
			dailyTime: loop.dailyTime,
		};
	}
}

export function formatLoopSchedule(
	loop: Pick<LoopJobSummary, 'scheduleKind' | 'intervalLabel'>,
): string {
	return loop.scheduleKind === 'dailyTime'
		? `daily at ${loop.intervalLabel}`
		: `every ${loop.intervalLabel}`;
}

export function formatLoopSummary(loop: LoopJobSummary): string {
	const lines = [
		`Loop ID: ${loop.id}`,
		`Mode: ${loop.mode}`,
		`Schedule: ${formatLoopSchedule(loop)}`,
		`Prompt: ${loop.prompt}`,
		`Created: ${formatTimestamp(loop.createdAt)}`,
		`Next run: ${formatTimestamp(loop.nextRunAt)}`,
		`Runs: ${loop.runCount}`,
		`Skipped: ${loop.skippedCount}`,
	];

	if (loop.pid) {
		lines.push(`PID: ${loop.pid}`);
	}

	if (loop.logPath) {
		lines.push(`Log: ${loop.logPath}`);
	}

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
