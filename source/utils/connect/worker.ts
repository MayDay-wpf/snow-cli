import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {promises as fs, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {
	CONNECT_WORKER_MARKER,
	type ConnectWorkerEvent,
	type ConnectWorkerResponse,
} from './types.js';
import type {ConnectWorkerPayload} from './workerMain.js';

const TURN_TIMEOUT_MS = 30 * 60 * 1000;

export interface ConnectTurnOptions {
	prompt: string;
	sessionId?: string;
	workingDirectory: string;
	autoApprove: boolean;
	images?: Array<{data: string; mimeType: string}>;
	files?: string[];
	onEvent: (event: ConnectWorkerEvent) => void;
	onStderr?: (message: string) => void;
}

export interface ConnectTurnResult {
	ok: boolean;
	sessionId?: string;
	text?: string;
	error?: string;
}

export interface ConnectTurnHandle {
	done: Promise<ConnectTurnResult>;
	stop: () => void;
	respondApproval: (
		id: string,
		decision: 'approve' | 'reject' | 'always',
	) => void;
	respondQuestion: (
		id: string,
		selected: string[],
		customInput?: string,
	) => void;
}

export function startConnectTurn(
	options: ConnectTurnOptions,
): ConnectTurnHandle {
	const cliPath = process.argv[1] ?? '';
	const payload: ConnectWorkerPayload = {
		prompt: options.prompt,
		sessionId: options.sessionId,
		workingDirectory: options.workingDirectory,
		images: options.images,
		files: options.files,
		autoApprove: options.autoApprove,
	};
	// 图片与长提示词可能远超命令行长度上限，统一走临时文件传递。
	const payloadPath = path.join(
		tmpdir(),
		`snow-connect-${process.pid}-${Date.now()}-${Math.random()
			.toString(16)
			.slice(2)}.json`,
	);
	writeFileSync(payloadPath, JSON.stringify(payload), {mode: 0o600});

	const child: ChildProcessWithoutNullStreams = spawn(
		process.execPath,
		[cliPath, '--connect-worker', payloadPath],
		{
			cwd: options.workingDirectory || process.cwd(),
			env: {
				...process.env,
				SNOW_CONNECT_MODE: 'true',
				NO_COLOR: '1',
			},
			stdio: ['pipe', 'pipe', 'pipe'],
		},
	);

	let sessionId = options.sessionId;
	let finalText = '';
	let finalError = '';
	let settled = false;
	let doneEventSeen = false;
	let stderrTail = '';

	const timer = setTimeout(() => {
		if (settled) {
			return;
		}
		finalError = 'IM 回合超时（30 分钟）';
		try {
			child.kill('SIGTERM');
		} catch {
			// ignore
		}
		setTimeout(() => {
			if (!settled) {
				try {
					child.kill('SIGKILL');
				} catch {
					// ignore
				}
			}
		}, 2000).unref?.();
	}, TURN_TIMEOUT_MS);

	const stdoutReader = readline.createInterface({input: child.stdout});
	stdoutReader.on('line', line => {
		const index = line.indexOf(CONNECT_WORKER_MARKER);
		if (index === -1) {
			return;
		}
		const raw = line.slice(index + CONNECT_WORKER_MARKER.length).trim();
		if (!raw) {
			return;
		}
		try {
			const event = JSON.parse(raw) as ConnectWorkerEvent;
			if (event.type === 'session') {
				sessionId = event.sessionId;
			}
			if (event.type === 'delta') {
				finalText = event.text;
			}
			if (event.type === 'done') {
				doneEventSeen = true;
				finalText = event.text;
				sessionId = event.sessionId || sessionId;
			}
			if (event.type === 'error') {
				finalError = event.message;
			}
			options.onEvent(event);
		} catch {
			// 非协议行忽略
		}
	});

	child.stderr.on('data', chunk => {
		const text = chunk.toString();
		stderrTail = `${stderrTail}${text}`.slice(-4000);
		options.onStderr?.(text.trimEnd());
	});

	const done = new Promise<ConnectTurnResult>(resolve => {
		const finish = (code: number | null): void => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			try {
				stdoutReader.close();
			} catch {
				// ignore
			}
			if (doneEventSeen) {
				resolve({ok: true, sessionId, text: finalText});
				return;
			}
			const details =
				finalError || stderrTail.trim().split('\n').slice(-3).join('\n');
			resolve({
				ok: false,
				sessionId,
				text: finalText,
				error:
					details ||
					`Connect worker 已退出（code=${code ?? 'null'}），但没有返回结果`,
			});
		};

		child.on('error', error => {
			finalError = `启动 Connect worker 失败：${error.message}`;
			finish(null);
		});
		child.on('close', code => {
			void fs.unlink(payloadPath).catch(() => undefined);
			finish(code);
		});
	});

	const writeResponse = (response: ConnectWorkerResponse): void => {
		if (settled || !child.stdin.writable) {
			return;
		}
		try {
			child.stdin.write(`${JSON.stringify(response)}\n`);
		} catch {
			// ignore
		}
	};

	const stop = (): void => {
		if (settled) {
			return;
		}
		try {
			child.kill('SIGTERM');
		} catch {
			// ignore
		}
	};

	return {
		done,
		stop,
		respondApproval: (id, decision) =>
			writeResponse({type: 'approval', id, decision}),
		respondQuestion: (id, selected, customInput) =>
			writeResponse({type: 'question', id, selected, customInput}),
	};
}
