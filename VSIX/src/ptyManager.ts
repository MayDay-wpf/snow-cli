import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

// Lazy-load node-pty to prevent extension activation failure
// when the native module is incompatible with the current Electron ABI
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
function loadPty(): any {
	return require('node-pty');
}

export interface PtyManagerEvents {
	onData: (data: string) => void;
	onExit: (code: number, context?: {suppressed?: boolean; reason?: string}) => void;
}

export type ShellType = 'auto' | 'powershell' | 'cmd';

export class PtyManager {
	private ptyProcess: any;
	private events: PtyManagerEvents | undefined;
	private startupSendTimer: NodeJS.Timeout | undefined;
	private shellType: ShellType = 'powershell';

	public setShellType(type: ShellType): void {
		this.shellType = type;
	}

	public start(
		cwd: string,
		events: PtyManagerEvents,
		startupCommand?: string,
		initialSize?: {cols: number; rows: number},
	): void {
		if (this.ptyProcess) {
			return;
		}

		this.events = events;
		const shell = this.getDefaultShell();
		const shellArgs = this.getShellArgs();

		try {
			// Ensure spawn-helper has execute permission (may be lost during VSIX extraction)
			this.fixSpawnHelperPermissions();

			const cols = this.normalizeDimension(initialSize?.cols, 80);
			const rows = this.normalizeDimension(initialSize?.rows, 30);

			const pty = loadPty();
			const processInstance = pty.spawn(shell, shellArgs, {
				name: 'xterm-256color',
				cols,
				rows,
				cwd: cwd,
				env: process.env as {[key: string]: string},
			});
			this.ptyProcess = processInstance;

			// Send startup command as soon as terminal starts producing output,
			// with a short fallback timer in case no early output is emitted.
			const cmd = startupCommand ?? 'snow';
			let startupSent = false;
			const sendStartupCommand = () => {
				if (startupSent || !cmd) {
					return;
				}
				if (this.ptyProcess !== processInstance) {
					return;
				}
				startupSent = true;
				if (this.startupSendTimer) {
					clearTimeout(this.startupSendTimer);
					this.startupSendTimer = undefined;
				}
				processInstance.write(cmd + '\r');
			};

			processInstance.onData((data: string) => {
				if (this.ptyProcess !== processInstance) {
					return;
				}
				sendStartupCommand();
				this.events?.onData(data);
			});

			processInstance.onExit((e: {exitCode: number}) => {
				if (this.ptyProcess !== processInstance) {
					return;
				}
				if (this.startupSendTimer) {
					clearTimeout(this.startupSendTimer);
					this.startupSendTimer = undefined;
				}
				this.ptyProcess = undefined;
				this.events?.onExit(e.exitCode);
			});

			if (cmd) {
				this.startupSendTimer = setTimeout(() => {
					this.startupSendTimer = undefined;
					sendStartupCommand();
				}, 200);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to start terminal: ${message}`);
		}
	}

	public write(data: string): void {
		this.ptyProcess?.write(data);
	}

	public resize(cols: number, rows: number): void {
		try {
			this.ptyProcess?.resize(cols, rows);
		} catch {
			// 忽略 resize 错误
		}
	}

	public kill(): void {
		if (this.startupSendTimer) {
			clearTimeout(this.startupSendTimer);
			this.startupSendTimer = undefined;
		}
		if (this.ptyProcess) {
			this.ptyProcess.kill();
			this.ptyProcess = undefined;
		}
	}

	public isRunning(): boolean {
		return this.ptyProcess !== undefined;
	}

	private normalizeDimension(value: number | undefined, fallback: number): number {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return fallback;
		}
		const normalized = Math.floor(value);
		return normalized > 0 ? normalized : fallback;
	}

	/**
	 * Fix spawn-helper execute permission that may be lost during VSIX extraction
	 */
	private fixSpawnHelperPermissions(): void {
		if (os.platform() === 'win32') return;
		try {
			const fs = require('fs');
			const dirs = [
				'build/Release',
				'build/Debug',
				`prebuilds/${process.platform}-${process.arch}`,
			];
			for (const dir of dirs) {
				for (const rel of ['..', '.']) {
					const helperPath = path.join(
						__dirname,
						'..',
						'node_modules',
						'node-pty',
						'lib',
						rel,
						dir,
						'spawn-helper',
					);
					if (fs.existsSync(helperPath)) {
						fs.chmodSync(helperPath, 0o755);
						return;
					}
				}
			}
		} catch {
			// Ignore permission fix errors
		}
	}

	/**
	 * 检测 Windows 环境下的 PowerShell 版本
	 * 优先使用 pwsh（PowerShell 7+），回退到 powershell.exe（Windows PowerShell 5.x）
	 */
	private detectWindowsPowerShell(): 'pwsh' | 'powershell' | null {
		const psModulePath = process.env['PSModulePath'] || '';
		if (!psModulePath) return null;

		// PowerShell Core (pwsh) typically has paths containing "PowerShell\7" or similar
		if (
			psModulePath.includes('PowerShell\\7') ||
			psModulePath.includes('powershell\\7')
		) {
			return 'pwsh';
		}

		// Windows PowerShell 5.x has WindowsPowerShell in path
		if (psModulePath.toLowerCase().includes('windowspowershell')) {
			return 'powershell';
		}

		// Has PSModulePath but can't determine version, assume PowerShell
		return 'powershell';
	}

	private getDefaultShell(): string {
		if (os.platform() !== 'win32') {
			return process.env.SHELL || '/bin/bash';
		}

		switch (this.shellType) {
			case 'cmd':
				return 'cmd.exe';
			case 'powershell': {
				const pwshType = this.detectWindowsPowerShell();
				return pwshType === 'pwsh' ? 'pwsh.exe' : 'powershell.exe';
			}
			case 'auto':
			default: {
				const pwshType = this.detectWindowsPowerShell();
				return pwshType === 'pwsh' ? 'pwsh.exe' : 'powershell.exe';
			}
		}
	}

	private getShellArgs(): string[] {
		if (os.platform() !== 'win32') {
			return ['-l'];
		}

		if (this.shellType === 'cmd') {
			return [];
		}
		return ['-NoLogo', '-NoExit'];
	}
}
