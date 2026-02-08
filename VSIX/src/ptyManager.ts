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
	onExit: (code: number) => void;
}

export class PtyManager {
	private ptyProcess: any;
	private events: PtyManagerEvents | undefined;

	public start(
		cwd: string,
		events: PtyManagerEvents,
		startupCommand?: string,
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

			const pty = loadPty();
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

			// 延迟执行启动命令
			const cmd = startupCommand ?? 'snow';
			if (cmd) {
				setTimeout(() => {
					this.write(cmd + '\r');
				}, 500);
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
		if (this.ptyProcess) {
			this.ptyProcess.kill();
			this.ptyProcess = undefined;
		}
	}

	public isRunning(): boolean {
		return this.ptyProcess !== undefined;
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
