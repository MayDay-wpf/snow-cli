import {useEffect, useState, useCallback} from 'react';
import {exec} from 'child_process';
import {logger} from '../../utils/core/logger.js';

const log = logger.child('hooks:useBackgroundProcesses');

/** 僵尸进程自检间隔（毫秒）。 */
const PROCESS_LIVENESS_CHECK_INTERVAL_MS = 5000;
/** 已完成进程在后台面板中的保留时长（毫秒），超时自动清理。 */
const COMPLETED_PROCESS_RETENTION_MS = 60_000;

/**
 * 判断 PID 是否仍然存活。
 * signal 0 不实际发送信号，仅做存在性探测；EPERM 表示进程存在但无权限，仍视为存活。
 */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
	}
}

export interface BackgroundProcess {
	id: string;
	command: string;
	pid: number;
	status: 'running' | 'completed' | 'failed';
	startedAt: Date;
	completedAt?: Date;
	exitCode?: number;
}

// Global state for background processes (shared across components)
let globalProcesses: BackgroundProcess[] = [];
let globalSetProcesses: ((processes: BackgroundProcess[]) => void) | null =
	null;
let globalSetShowPanel: ((show: boolean) => void) | null = null;

/**
 * Hook to manage background processes
 * Used by ChatScreen to display and manage background processes
 */
export function useBackgroundProcesses() {
	const [processes, setProcesses] = useState<BackgroundProcess[]>([]);
	const [showPanel, setShowPanel] = useState(false);

	// Always update global setters
	globalSetProcesses = setProcesses;
	globalSetShowPanel = setShowPanel;

	// 自愈：进程的 close/error 事件可能因异常路径丢失，定期用 PID 存活探测兜底，
	// 避免僵尸 running 条目让 busy 指示（后台任务运行中...）永久驻留。
	// 同时自动清理已完成条目，防止面板无限累积。
	useEffect(() => {
		const timer = setInterval(() => {
			if (globalProcesses.length === 0) {
				return;
			}

			const now = Date.now();
			const staleRunningIds: string[] = [];
			let changed = false;

			const nextProcesses = globalProcesses
				.filter(p => {
					if (p.status !== 'completed' || !p.completedAt) {
						return true;
					}
					if (now - p.completedAt.getTime() < COMPLETED_PROCESS_RETENTION_MS) {
						return true;
					}
					changed = true;
					return false;
				})
				.map(p => {
					if (p.status !== 'running' || isProcessAlive(p.pid)) {
						return p;
					}
					changed = true;
					staleRunningIds.push(p.id);
					return {...p, status: 'completed' as const, completedAt: new Date()};
				});

			if (!changed) {
				return;
			}

			if (staleRunningIds.length > 0) {
				log.debug('Marked stale background processes as completed', {
					ids: staleRunningIds,
				});
			}

			globalProcesses = nextProcesses;
			if (globalSetProcesses) {
				globalSetProcesses(globalProcesses);
			}
		}, PROCESS_LIVENESS_CHECK_INTERVAL_MS);

		return () => clearInterval(timer);
	}, []);

	const addProcess = useCallback((command: string, pid: number) => {
		const process: BackgroundProcess = {
			id: `${pid}-${Date.now()}`,
			command,
			pid,
			status: 'running',
			startedAt: new Date(),
		};

		globalProcesses = [...globalProcesses, process];
		if (globalSetProcesses) {
			globalSetProcesses(globalProcesses);
		}

		return process.id;
	}, []);

	const updateProcessStatus = useCallback(
		(id: string, status: 'completed' | 'failed', exitCode?: number) => {
			globalProcesses = globalProcesses.map(p =>
				p.id === id
					? {
							...p,
							status,
							completedAt: new Date(),
							exitCode,
					  }
					: p,
			);

			if (globalSetProcesses) {
				globalSetProcesses(globalProcesses);
			}
		},
		[],
	);

	const killProcess = useCallback(
		(id: string) => {
			const process = globalProcesses.find(p => p.id === id);
			if (!process || process.status !== 'running') {
				return;
			}

			const {pid} = process;
			const isWindows = global.process.platform === 'win32';

			if (isWindows) {
				// Windows: Use taskkill to kill entire process tree
				exec(`taskkill /PID ${pid} /T /F 2>NUL`, {windowsHide: true}, () => {
					// Update status after kill
					updateProcessStatus(id, 'failed', 130);
				});
			} else {
				// Unix: Send SIGTERM first, then SIGKILL as fallback
				try {
					global.process.kill(pid, 'SIGTERM');

					// Force SIGKILL after a short delay to ensure termination
					// This handles processes that may ignore or delay responding to SIGTERM
					setTimeout(() => {
						try {
							// Check if process is still running by sending signal 0
							global.process.kill(pid, 0);
							// If we get here, process is still alive, send SIGKILL
							global.process.kill(pid, 'SIGKILL');
						} catch (e) {
							log.debug(
								'Process already dead or no permission on SIGKILL follow-up',
								{
									pid,
									error: e instanceof Error ? e.message : String(e),
								},
							);
						}
					}, 100);

					// Update status after kill
					updateProcessStatus(id, 'failed', 130);
				} catch (e) {
					log.debug('Process already dead or no permission on initial kill', {
						pid,
						error: e instanceof Error ? e.message : String(e),
					});
				}
			}
		},
		[updateProcessStatus],
	);

	const removeProcess = useCallback((id: string) => {
		globalProcesses = globalProcesses.filter(p => p.id !== id);
		if (globalSetProcesses) {
			globalSetProcesses(globalProcesses);
		}
	}, []);

	const clearCompleted = useCallback(() => {
		globalProcesses = globalProcesses.filter(p => p.status === 'running');
		if (globalSetProcesses) {
			globalSetProcesses(globalProcesses);
		}
	}, []);

	const enablePanel = useCallback(() => {
		if (globalSetShowPanel) {
			globalSetShowPanel(true);
		}
	}, []);

	const hidePanel = useCallback(() => {
		if (globalSetShowPanel) {
			globalSetShowPanel(false);
		}
	}, []);

	return {
		processes,
		showPanel,
		addProcess,
		updateProcessStatus,
		killProcess,
		removeProcess,
		clearCompleted,
		enablePanel,
		hidePanel,
	};
}

/**
 * Add a background process from anywhere (e.g., bash.ts)
 * This allows non-React code to add processes
 */
export function addBackgroundProcess(command: string, pid: number): string {
	const process: BackgroundProcess = {
		id: `${pid}-${Date.now()}`,
		command,
		pid,
		status: 'running',
		startedAt: new Date(),
	};

	globalProcesses = [...globalProcesses, process];
	if (globalSetProcesses) {
		globalSetProcesses(globalProcesses);
	}

	return process.id;
}

/**
 * Update background process status from anywhere
 */
export function updateBackgroundProcessStatus(
	id: string,
	status: 'completed' | 'failed',
	exitCode?: number,
) {
	globalProcesses = globalProcesses.map(p =>
		p.id === id
			? {
					...p,
					status,
					completedAt: new Date(),
					exitCode,
			  }
			: p,
	);

	if (globalSetProcesses) {
		globalSetProcesses(globalProcesses);
	}
}

/**
 * Show the background process panel (called when Ctrl+B is pressed)
 */
export function showBackgroundPanel() {
	if (globalSetShowPanel) {
		globalSetShowPanel(true);
	}
}

/**
 * Read the current background process list (non-React accessor).
 * Used by the task manager to display background processes alongside
 * sub-agents / teammates / MCP child processes.
 */
export function getBackgroundProcesses(): BackgroundProcess[] {
	return globalProcesses;
}
