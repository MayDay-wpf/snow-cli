import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {getSnowTerminalProxyEnv} from './terminalProxy';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
function loadPty(): any {
	return require('node-pty');
}

export interface PtyManagerEvents {
	onData: (data: string) => void;
	onExit: (code: number) => void;
}

export type ShellFamily = 'powershell' | 'cmd' | 'posix';

export type ResolvedShell = {
	path: string;
	args: string[];
	family: ShellFamily;
};

export function detectShellFamily(shellPath: string): ShellFamily {
	const name = path.basename(shellPath).toLowerCase().replace(/\.exe$/, '');
	if (name === 'cmd') {
		return 'cmd';
	}
	if (name === 'powershell' || name === 'pwsh') {
		return 'powershell';
	}
	return 'posix';
}

function defaultArgsForFamily(family: ShellFamily): string[] {
	switch (family) {
		case 'powershell':
			return ['-NoLogo', '-NoExit'];
		case 'cmd':
			return [];
		case 'posix':
			return ['-l'];
	}
}

function getFs(): typeof import('fs') {
	// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
	return require('fs');
}

function getEnvValue(name: string): string | undefined {
	const direct = process.env[name];
	if (typeof direct === 'string') {
		return direct;
	}

	const key = Object.keys(process.env).find(
		entry => entry.toLowerCase() === name.toLowerCase(),
	);
	const value = key ? process.env[key] : undefined;
	return typeof value === 'string' ? value : undefined;
}

function stripWrappingQuotes(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function expandShellPath(rawPath: string): string {
	return stripWrappingQuotes(rawPath)
		.replace(/\$\{env:([^}]+)\}/gi, (_match, name: string) => getEnvValue(name) ?? '')
		.replace(/%([^%]+)%/g, (_match, name: string) => getEnvValue(name) ?? '');
}

function shellPathExists(shellPath: string): boolean {
	try {
		return getFs().existsSync(shellPath);
	} catch {
		return false;
	}
}

function isAbsoluteShellPath(shellPath: string): boolean {
	return os.platform() === 'win32'
		? path.win32.isAbsolute(shellPath)
		: path.isAbsolute(shellPath);
}

function hasPathSeparator(value: string): boolean {
	return value.includes('/') || value.includes('\\');
}

function resolveExecutableFromPath(executable: string): string | undefined {
	if (!executable || isAbsoluteShellPath(executable) || hasPathSeparator(executable)) {
		return undefined;
	}

	const pathValue = getEnvValue('PATH');
	if (!pathValue) {
		return undefined;
	}

	const isWindows = os.platform() === 'win32';
	const hasExtension = path.extname(executable) !== '';
	const extensions = isWindows && !hasExtension
		? (getEnvValue('PATHEXT') || '.COM;.EXE;.BAT;.CMD')
			.split(';')
			.filter(Boolean)
		: [''];
	for (const directory of pathValue.split(path.delimiter)) {
		if (!directory) {
			continue;
		}
		for (const extension of extensions) {
			const candidate = path.join(directory, `${executable}${extension}`);
			if (shellPathExists(candidate)) {
				return candidate;
			}
		}
	}

	return undefined;
}

function resolveExistingShellPath(rawPath: string): string | undefined {
	const expanded = expandShellPath(rawPath);
	if (!expanded) {
		return undefined;
	}

	if (shellPathExists(expanded)) {
		return expanded;
	}

	return resolveExecutableFromPath(expanded);
}

export function resolveProfileShellPath(
	profile: Record<string, unknown>,
): string | undefined {
	const rawPath = profile.path;
	const rawPaths = Array.isArray(rawPath)
		? rawPath.filter((entry): entry is string => typeof entry === 'string')
		: typeof rawPath === 'string'
		? [rawPath]
		: [];

	for (const candidate of rawPaths) {
		const resolved = resolveExistingShellPath(candidate);
		if (resolved) {
			return resolved;
		}
	}

	const firstCandidate = rawPaths.map(expandShellPath).filter(Boolean)[0];
	if (
		firstCandidate &&
		os.platform() !== 'win32' &&
		!isAbsoluteShellPath(firstCandidate)
	) {
		return firstCandidate;
	}

	return undefined;
}

function detectPowerShellPath(): string {
	return resolveExecutableFromPath('pwsh.exe') ??
		resolveExecutableFromPath('powershell.exe') ??
		'powershell.exe';
}

function windowsFallback(): ResolvedShell {
	const p = detectPowerShellPath();
	return {path: p, args: ['-NoLogo', '-NoExit'], family: 'powershell'};
}

function posixFallback(): ResolvedShell {
	const shellPath = process.env.SHELL || '/bin/bash';
	return {path: shellPath, args: ['-l'], family: detectShellFamily(shellPath)};
}

function resolveAutoFromVSCode(): ResolvedShell | undefined {
	const platform = os.platform();
	const platformKey = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
	const integratedConfig = vscode.workspace.getConfiguration('terminal.integrated');
	const defaultProfileName = integratedConfig.get<string>(`defaultProfile.${platformKey}`, '');
	if (!defaultProfileName) {
		return undefined;
	}
	const profiles =
		integratedConfig.get<Record<string, Record<string, unknown>>>(
			`profiles.${platformKey}`,
		) || {};
	const profile = profiles[defaultProfileName];
	if (!profile) {
		return undefined;
	}
	const shellPath = resolveProfileShellPath(profile);
	if (!shellPath) {
		return undefined;
	}
	const family = detectShellFamily(shellPath);
	const args = Array.isArray(profile.args)
		? (profile.args as string[])
		: defaultArgsForFamily(family);
	return {path: shellPath, args, family};
}

/**
 * @param input  'auto' → follow VS Code default profile;
 *               otherwise treated as a shell executable path (absolute or basename).
 *               If the path doesn't exist, falls back to PowerShell (Windows) or $SHELL (others).
 */
export function resolveShellProfile(input?: string): ResolvedShell {
	const isWindows = os.platform() === 'win32';
	const fallback = isWindows ? windowsFallback : posixFallback;

	if (!input || input === 'auto') {
		return resolveAutoFromVSCode() ?? fallback();
	}

	const expandedInput = expandShellPath(input);
	if (isAbsoluteShellPath(expandedInput) && !shellPathExists(expandedInput)) {
		return fallback();
	}

	const resolvedFromPath = resolveExecutableFromPath(expandedInput);
	const shellPath = resolvedFromPath ?? expandedInput;
	const family = detectShellFamily(shellPath);
	return {path: shellPath, args: defaultArgsForFamily(family), family};
}

export class PtyManager {
	private ptyProcess: any;
	private events: PtyManagerEvents | undefined;
	private startupSendTimer: NodeJS.Timeout | undefined;
	private resolvedShell: ResolvedShell | undefined;

	public setResolvedShell(shell: ResolvedShell): void {
		this.resolvedShell = shell;
	}

	public getShellFamily(): ShellFamily {
		return this.resolvedShell?.family ?? 'posix';
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
		const shell = this.resolvedShell?.path ?? (process.env.SHELL || '/bin/bash');
		const shellArgs = this.resolvedShell?.args ?? ['-l'];
		const proxyEnv = getSnowTerminalProxyEnv();
		const spawnEnv = {
			...process.env,
			...(proxyEnv ?? {}),
		} as {[key: string]: string};

		try {
			this.fixSpawnHelperPermissions();

			const cols = this.normalizeDimension(initialSize?.cols, 80);
			const rows = this.normalizeDimension(initialSize?.rows, 30);

			const pty = loadPty();
			const processInstance = pty.spawn(shell, shellArgs, {
				name: 'xterm-256color',
				cols,
				rows,
				cwd: cwd,
				env: spawnEnv,
			});
			this.ptyProcess = processInstance;

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
			// ignore resize errors
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
}
