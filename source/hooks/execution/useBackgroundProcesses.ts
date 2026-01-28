import {useState, useCallback} from 'react';
import {exec} from 'child_process';

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
						} catch {
							// Process already dead or no permission, ignore
						}
					}, 100);

					// Update status after kill
					updateProcessStatus(id, 'failed', 130);
				} catch {
					// Process already dead or no permission
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
