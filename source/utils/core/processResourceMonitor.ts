import {execFile} from 'node:child_process';
import {logger} from './logger.js';

const log = logger.child('core:processResourceMonitor');

/**
 * Process Resource Monitor
 *
 * 采集 Snow CLI 主进程与子进程的 CPU / 内存占用，并提供跨平台的进程树终止能力。
 * 供 /taskmanager 资源管理器面板使用，行为类似浏览器的任务管理器。
 *
 * 注意：与同目录下的 resourceMonitor.ts（内存泄漏监控）职责不同，本文件专注于
 * 进程级资源采样与终止。
 */

export interface ProcessResource {
	/** CPU 占用百分比；无法获取时为 null */
	cpuPercent: number | null;
	/** 常驻内存（RSS，字节）；无法获取时为 null */
	memoryBytes: number | null;
}

const IS_WINDOWS = process.platform === 'win32';

// ── 主进程采样 ──────────────────────────────────────────────────────────
let lastCpuUsage = process.cpuUsage();
let lastCpuSampleAt = Date.now();

/**
 * 采样当前（主）Node.js 进程自上次调用以来的 CPU 占用百分比。
 * 首次调用没有历史样本，恒返回 0。
 */
export function getMainProcessCpuPercent(): number {
	const usage = process.cpuUsage();
	const now = Date.now();
	const elapsedMs = now - lastCpuSampleAt;
	const cpuMs =
		(usage.user - lastCpuUsage.user + (usage.system - lastCpuUsage.system)) /
		1000;
	lastCpuUsage = usage;
	lastCpuSampleAt = now;

	if (elapsedMs <= 0) {
		return 0;
	}

	const percent = (cpuMs / elapsedMs) * 100;
	return Math.max(0, Math.round(percent * 10) / 10);
}

export function getMainProcessMemoryBytes(): number {
	return process.memoryUsage().rss;
}

export function getMainProcessHeapUsedBytes(): number {
	return process.memoryUsage().heapUsed;
}

export function getMainProcessUptimeSeconds(): number {
	return Math.floor(process.uptime());
}

// ── 子进程采样 ──────────────────────────────────────────────────────────
/**
 * 批量采样指定 PID 的 CPU / 内存占用。
 * macOS/Linux 走 `ps`，Windows 走 `wmic`；失败时对应字段为 null。
 */
export async function sampleProcessResources(
	pids: number[],
): Promise<Map<number, ProcessResource>> {
	const result = new Map<number, ProcessResource>();
	const unique = Array.from(
		new Set(pids.filter(pid => Number.isInteger(pid) && pid > 0)),
	);

	if (unique.length === 0) {
		return result;
	}

	if (IS_WINDOWS) {
		await sampleWindowsProcesses(unique, result);
	} else {
		await sampleUnixProcesses(unique, result);
	}

	return result;
}

function sampleUnixProcesses(
	pids: number[],
	result: Map<number, ProcessResource>,
): Promise<void> {
	return new Promise(resolve => {
		execFile(
			'ps',
			['-o', 'pid=,%cpu=,rss=', '-p', pids.join(',')],
			{timeout: 5000, windowsHide: true},
			(_error, stdout) => {
				if (stdout) {
					for (const rawLine of stdout.split('\n')) {
						const parts = rawLine.trim().split(/\s+/);
						if (parts.length < 3) {
							continue;
						}

						const pid = Number.parseInt(parts[0]!, 10);
						const cpu = Number.parseFloat(parts[1]!);
						const rssKb = Number.parseInt(parts[2]!, 10);
						if (!Number.isFinite(pid)) {
							continue;
						}

						result.set(pid, {
							cpuPercent: Number.isFinite(cpu) ? cpu : null,
							// ps 的 rss 单位是 KB
							memoryBytes: Number.isFinite(rssKb) ? rssKb * 1024 : null,
						});
					}
				}
				resolve();
			},
		);
	});
}

function sampleWindowsProcesses(
	pids: number[],
	result: Map<number, ProcessResource>,
): Promise<void> {
	const wanted = new Set(pids);
	return new Promise(resolve => {
		// PercentProcessorTime 为性能计数器采样值；WorkingSet 为常驻内存（字节）。
		// wmic 在新版 Windows 上已弃用，但多数环境仍可用；失败时降级为 null。
		execFile(
			'wmic',
			[
				'path',
				'Win32_PerfFormattedData_PerfProc_Process',
				'get',
				'IDProcess,PercentProcessorTime,WorkingSet',
			],
			{timeout: 8000, windowsHide: true, maxBuffer: 8 * 1024 * 1024},
			(_error, stdout) => {
				if (stdout) {
					for (const rawLine of stdout.split('\n')) {
						const parts = rawLine.trim().split(/\s+/);
						if (parts.length < 3) {
							continue;
						}

						const pid = Number.parseInt(parts[0]!, 10);
						if (!Number.isFinite(pid) || !wanted.has(pid)) {
							continue;
						}

						const cpu = Number.parseInt(parts[1]!, 10);
						const memory = Number.parseInt(parts[2]!, 10);
						result.set(pid, {
							cpuPercent: Number.isFinite(cpu) ? cpu : null,
							memoryBytes: Number.isFinite(memory) ? memory : null,
						});
					}
				}
				resolve();
			},
		);
	});
}

// ── 进程树枚举 ──────────────────────────────────────────────────────────
export interface RawProcessInfo {
	pid: number;
	ppid: number;
	command: string;
}

/**
 * 枚举以 rootPid 为根的整棵进程树（不含 root 自身）。
 * macOS/Linux 走 `ps -axo pid=,ppid=,command=`，Windows 走 `wmic ... /format:csv`。
 *
 * 这是任务管理器发现"子进程"的主要来源：不依赖各模块是否主动登记到
 * processManager，因此 MCP stdio 服务器、浏览器、子代理 worker、shell 等
 * 都能被如实列出。
 */
export async function listDescendantProcesses(
	rootPid: number,
): Promise<RawProcessInfo[]> {
	const all = IS_WINDOWS
		? await listWindowsProcesses()
		: await listUnixProcesses();

	if (all.length === 0) {
		return [];
	}

	const childrenByParent = new Map<number, RawProcessInfo[]>();
	for (const proc of all) {
		const siblings = childrenByParent.get(proc.ppid);
		if (siblings) {
			siblings.push(proc);
		} else {
			childrenByParent.set(proc.ppid, [proc]);
		}
	}

	const result: RawProcessInfo[] = [];
	const visited = new Set<number>([rootPid]);
	const queue: number[] = [rootPid];
	while (queue.length > 0) {
		const parent = queue.shift()!;
		const children = childrenByParent.get(parent);
		if (!children) {
			continue;
		}
		for (const child of children) {
			if (visited.has(child.pid)) {
				continue;
			}
			visited.add(child.pid);
			result.push(child);
			queue.push(child.pid);
		}
	}

	return result;
}

function listUnixProcesses(): Promise<RawProcessInfo[]> {
	return new Promise(resolve => {
		execFile(
			'ps',
			['-axo', 'pid=,ppid=,command='],
			{timeout: 5000, windowsHide: true, maxBuffer: 8 * 1024 * 1024},
			(_error, stdout) => {
				const result: RawProcessInfo[] = [];
				if (stdout) {
					for (const rawLine of stdout.split('\n')) {
						const line = rawLine.trimStart();
						if (!line) {
							continue;
						}
						const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
						if (!match) {
							continue;
						}
						const pid = Number.parseInt(match[1]!, 10);
						const ppid = Number.parseInt(match[2]!, 10);
						if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
							continue;
						}
						result.push({pid, ppid, command: (match[3] ?? '').trim()});
					}
				}
				resolve(result);
			},
		);
	});
}

function listWindowsProcesses(): Promise<RawProcessInfo[]> {
	return new Promise(resolve => {
		execFile(
			'wmic',
			[
				'process',
				'get',
				'ProcessId,ParentProcessId,CommandLine',
				'/format:csv',
			],
			{timeout: 8000, windowsHide: true, maxBuffer: 16 * 1024 * 1024},
			(_error, stdout) => {
				const result: RawProcessInfo[] = [];
				if (stdout) {
					const lines = stdout.split('\n').filter(line => line.trim());
					const header = lines.shift();
					if (header) {
						const columns = header
							.trim()
							.split(',')
							.map(column => column.trim().toLowerCase());
						const pidIndex = columns.indexOf('processid');
						const ppidIndex = columns.indexOf('parentprocessid');
						const commandIndex = columns.indexOf('commandline');
						if (pidIndex >= 0 && ppidIndex >= 0) {
							for (const line of lines) {
								const cells = parseCsvLine(line);
								const pid = Number.parseInt(cells[pidIndex] ?? '', 10);
								const ppid = Number.parseInt(cells[ppidIndex] ?? '', 10);
								if (!Number.isFinite(pid) || !Number.isFinite(ppid)) {
									continue;
								}
								result.push({
									pid,
									ppid,
									command:
										commandIndex >= 0 ? (cells[commandIndex] ?? '').trim() : '',
								});
							}
						}
					}
				}
				resolve(result);
			},
		);
	});
}

function parseCsvLine(line: string): string[] {
	const cells: string[] = [];
	let current = '';
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const char = line[i]!;
		if (inQuotes) {
			if (char === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += char;
			}
		} else if (char === '"') {
			inQuotes = true;
		} else if (char === ',') {
			cells.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	cells.push(current);
	return cells;
}

// ── 进程终止 ────────────────────────────────────────────────────────────
/**
 * 终止指定 PID 的进程（含子进程树）。
 * Windows 使用 taskkill /T /F；Unix 先 SIGTERM，超时后 SIGKILL。
 */
export function killProcessTree(pid: number): void {
	if (!Number.isInteger(pid) || pid <= 0) {
		return;
	}

	if (IS_WINDOWS) {
		execFile(
			'taskkill',
			['/PID', String(pid), '/T', '/F'],
			{windowsHide: true},
			() => {
				// 忽略错误：进程可能已退出或无权访问
			},
		);
		return;
	}

	try {
		process.kill(pid, 'SIGTERM');
	} catch {
		// 进程已不存在
		return;
	}

	const timer = setTimeout(() => {
		try {
			// signal 0 用于探测进程是否仍存活
			process.kill(pid, 0);
			process.kill(pid, 'SIGKILL');
		} catch (error) {
			// 进程已退出
			log.debug('processResourceMonitor process kill 0/SIGKILL skipped (process exited)', {error, pid});
		}
	}, 800);

	if (typeof timer.unref === 'function') {
		timer.unref();
	}
}

/**
 * 将字节数格式化为人类可读的字符串（B / KB / MB / GB）。
 */
export function formatBytes(bytes: number | null): string {
	if (bytes === null || !Number.isFinite(bytes) || bytes < 0) {
		return '-';
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex++;
	}
	const rounded =
		value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${rounded} ${units[unitIndex]}`;
}

/**
 * 将 CPU 百分比格式化为字符串。
 */
export function formatCpuPercent(percent: number | null): string {
	if (percent === null || !Number.isFinite(percent)) {
		return '-';
	}
	return `${Math.round(percent * 10) / 10}%`;
}
