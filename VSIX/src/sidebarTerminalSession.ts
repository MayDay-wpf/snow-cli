import {PtyManager, ShellType} from './ptyManager';

export type SidebarTerminalSize = {cols: number; rows: number};

export type SidebarTerminalTabState = {
	id: string;
	title: string;
	isActive: boolean;
	isRunning: boolean;
	isRestarting: boolean;
	exitCode?: number;
};

type SidebarTerminalSessionOptions = {
	id: string;
	title: string;
	outputBufferMaxBytes: number;
	outputTruncationNotice: string;
};

type SidebarTerminalSessionStartHandlers = {
	onData: (data: string) => void;
	onExit: (event: {
		code: number;
		processNonce: number;
		suppressed: boolean;
	}) => void;
};

export class SidebarTerminalSession {
	public readonly id: string;
	public readonly title: string;

	private readonly ptyManager = new PtyManager();
	private readonly suppressedExitProcessNonces = new Set<number>();
	private readonly outputBufferMaxBytes: number;
	private readonly outputTruncationNotice: string;
	private transcriptChunks: string[] = [];
	private transcriptBytes = 0;
	private transcriptTruncated = false;
	private processNonce = 0;
	private lastExitCode: number | undefined;
	private restarting = false;

	constructor(options: SidebarTerminalSessionOptions) {
		this.id = options.id;
		this.title = options.title;
		this.outputBufferMaxBytes = options.outputBufferMaxBytes;
		this.outputTruncationNotice = options.outputTruncationNotice;
	}

	public setShellType(shellType: ShellType): void {
		this.ptyManager.setShellType(shellType);
	}

	public start(
		cwd: string,
		startupCommand: string | undefined,
		size: SidebarTerminalSize | undefined,
		handlers: SidebarTerminalSessionStartHandlers,
	): {started: boolean; processNonce: number} {
		const processNonce = ++this.processNonce;
		this.lastExitCode = undefined;
		this.ptyManager.start(
			cwd,
			{
				onData: data => {
					handlers.onData(data);
				},
				onExit: code => {
					const suppressed = this.suppressedExitProcessNonces.delete(
						processNonce,
					);
					if (!suppressed) {
						this.lastExitCode = code;
					}
					handlers.onExit({code, processNonce, suppressed});
				},
			},
			startupCommand,
			size,
		);
		return {started: this.ptyManager.isRunning(), processNonce};
	}

	public write(data: string): void {
		this.ptyManager.write(data);
	}

	public resize(cols: number, rows: number): void {
		this.ptyManager.resize(cols, rows);
	}

	public kill(): void {
		this.ptyManager.kill();
	}

	public isRunning(): boolean {
		return this.ptyManager.isRunning();
	}

	public isRestarting(): boolean {
		return this.restarting;
	}

	public setRestarting(restarting: boolean): void {
		this.restarting = restarting;
		if (restarting) {
			this.lastExitCode = undefined;
		}
	}

	public suppressCurrentExitBanner(): void {
		if (this.processNonce > 0) {
			this.suppressedExitProcessNonces.add(this.processNonce);
		}
	}

	public clearTranscript(): void {
		this.transcriptChunks = [];
		this.transcriptBytes = 0;
		this.transcriptTruncated = false;
		this.lastExitCode = undefined;
	}

	public appendOutput(data: string): void {
		if (!data) {
			return;
		}
		this.transcriptChunks.push(data);
		this.transcriptBytes += data.length;
		if (this.transcriptBytes <= this.outputBufferMaxBytes) {
			return;
		}
		const fullData = this.transcriptChunks.join('');
		const tail = fullData.slice(-this.outputBufferMaxBytes);
		this.transcriptChunks = [tail];
		this.transcriptBytes = tail.length;
		this.transcriptTruncated = true;
	}

	public appendExitBanner(code: number): void {
		this.lastExitCode = code;
		this.appendOutput(`\r\n\r\n[Process exited with code ${code}]\r\n`);
	}

	public getTranscript(): string {
		const transcript = this.transcriptChunks.join('');
		return this.transcriptTruncated
			? `${this.outputTruncationNotice}${transcript}`
			: transcript;
	}

	public toTabState(isActive: boolean): SidebarTerminalTabState {
		return {
			id: this.id,
			title: this.title,
			isActive,
			isRunning: this.isRunning(),
			isRestarting: this.restarting,
			exitCode: this.lastExitCode,
		};
	}
}
