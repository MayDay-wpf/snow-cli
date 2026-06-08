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

export interface LoopSchedule {
	prompt: string;
	intervalMs: number;
	intervalLabel: string;
	mode: LoopMode;
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
}

interface LoopJob extends LoopJobSummary {
	timer: NodeJS.Timeout;
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

		return state;
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

export function parseLoopSchedule(rawArgs?: string): LoopSchedule {
	const raw = rawArgs?.trim() || '';
	const {args, mode} = normalizeLoopModeArgs(raw);
	if (!args) {
		throw new Error(
			'Usage: /loop 5m <prompt> | /loop daemon 5m <prompt> | /loop 8h30m <prompt> | /loop <prompt> every 2 hours | /loop list | /loop cancel <id> | /loop tasks',
		);
	}

	if (/^(?:\d+\s*[a-zA-Z]+\s*)+\s*$/.test(args)) {
		throw new Error('Loop prompt is required after the interval.');
	}

	const prefixMatch = args.match(/^((?:\d+\s*[a-zA-Z]+\s*)+?)\s+([\s\S]+)$/);
	if (prefixMatch?.[1] && prefixMatch[2]) {
		const intervalMs = parseDurationString(prefixMatch[1]);
		return {
			prompt: prefixMatch[2].trim(),
			intervalMs,
			intervalLabel: millisecondsToLabel(intervalMs),
			mode,
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
			mode,
		};
	}

	return {
		prompt: args,
		intervalMs: DEFAULT_INTERVAL_MS,
		intervalLabel: millisecondsToLabel(DEFAULT_INTERVAL_MS),
		mode,
	};
}

class LoopManager {
	private readonly loops = new Map<string, LoopJob>();

	createLoop(schedule: LoopSchedule): LoopJobSummary {
		if (schedule.mode === 'daemon') {
			return this.createDaemonLoop(schedule);
		}

		return this.createSessionLoop(schedule);
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
			clearInterval(loop.timer);
			this.loops.delete(loopId);
			return this.toSummary(loop);
		}

		return this.cancelDaemonLoop(loopId);
	}

	async runDaemonLoop(state: LoopDaemonState): Promise<void> {
		const loop: LoopJob = {
			...state,
			pid: process.pid,
			mode: 'daemon',
			timer: setInterval(() => {
				void this.triggerLoop(state.id);
			}, state.intervalMs),
		};

		this.loops.set(loop.id, loop);
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
			mode: 'session',
			timer,
		};

		this.loops.set(id, loop);
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
			nextRunAt: now + schedule.intervalMs,
			runCount: 0,
			skippedCount: 0,
			mode: 'daemon',
			logPath,
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
			loop.nextRunAt = Date.now() + loop.intervalMs;
			this.persistDaemonState(loop);
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

		this.persistDaemonState(loop);
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
		};
	}
}

export function formatLoopSummary(loop: LoopJobSummary): string {
	const lines = [
		`Loop ID: ${loop.id}`,
		`Mode: ${loop.mode}`,
		`Schedule: every ${loop.intervalLabel}`,
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
