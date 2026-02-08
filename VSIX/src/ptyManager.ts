import * as pty from 'node-pty';
import * as os from 'os';
import * as vscode from 'vscode';

export interface PtyManagerEvents {
	onData: (data: string) => void;
	onExit: (code: number) => void;
}

export class PtyManager {
	private ptyProcess: pty.IPty | undefined;
	private events: PtyManagerEvents | undefined;

	public start(cwd: string, events: PtyManagerEvents): void {
		if (this.ptyProcess) {
			return;
		}

		this.events = events;
		const shell = this.getDefaultShell();
		const shellArgs = this.getShellArgs();

		try {
			this.ptyProcess = pty.spawn(shell, shellArgs, {
				name: 'xterm-256color',
				cols: 80,
				rows: 30,
				cwd: cwd,
				env: process.env as {[key: string]: string},
			});

			this.ptyProcess.onData((data: string) => {
				this.events?.onData(data);
			});

			this.ptyProcess.onExit((e: {exitCode: number}) => {
				this.events?.onExit(e.exitCode);
				this.ptyProcess = undefined;
			});

			// 延迟执行 snow 命令
			setTimeout(() => {
				this.write('snow\r');
			}, 500);
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
		if (this.ptyProcess) {
			this.ptyProcess.kill();
			this.ptyProcess = undefined;
		}
	}

	public isRunning(): boolean {
		return this.ptyProcess !== undefined;
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
		if (os.platform() === 'win32') {
			const pwshType = this.detectWindowsPowerShell();
			if (pwshType === 'pwsh') {
				return 'pwsh.exe';
			}
			return 'powershell.exe';
		}
		return process.env.SHELL || '/bin/bash';
	}

	private getShellArgs(): string[] {
		if (os.platform() === 'win32') {
			// -NoLogo: 隐藏启动信息
			// -NoExit: 保持 Shell 运行
			return ['-NoLogo', '-NoExit'];
		}
		return ['-l'];
	}
}
