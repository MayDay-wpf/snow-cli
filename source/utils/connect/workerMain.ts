import readline from 'node:readline';
import type {Message} from '../../ui/components/chat/MessageList.js';
import {isSensitiveCommand} from '../execution/sensitiveCommandManager.js';
import {
	CONNECT_WORKER_MARKER,
	type ConnectWorkerEvent,
	type ConnectWorkerResponse,
} from './types.js';

export interface ConnectWorkerPayload {
	prompt: string;
	sessionId?: string;
	workingDirectory?: string;
	images?: Array<{data: string; mimeType: string}>;
	files?: string[];
	autoApprove?: boolean;
}

const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

function emit(event: ConnectWorkerEvent): void {
	process.stdout.write(`${CONNECT_WORKER_MARKER}${JSON.stringify(event)}\n`);
}

function toUiMessages(sessionMessages: any[]): Message[] {
	return (sessionMessages ?? [])
		.filter(message => message && typeof message === 'object')
		.map(message => ({
			role:
				message.role === 'user' || message.role === 'assistant'
					? message.role
					: 'assistant',
			content:
				typeof message.content === 'string'
					? message.content
					: Array.isArray(message.content)
					? message.content
							.map((part: any) =>
								typeof part === 'string' ? part : part?.text ?? '',
							)
							.join('')
					: '',
			toolCall: message.tool_calls?.[0]
				? {
						name: message.tool_calls[0]?.function?.name ?? '',
						arguments: message.tool_calls[0]?.function?.arguments ?? {},
				  }
				: undefined,
			toolPending: message.role === 'tool',
		})) as Message[];
}

class ResponseBridge {
	private pending = new Map<string, (value: ConnectWorkerResponse) => void>();

	private counter = 0;

	constructor() {
		const rl = readline.createInterface({input: process.stdin});
		rl.on('line', line => {
			const text = line.trim();
			if (!text) {
				return;
			}
			try {
				const payload = JSON.parse(text) as ConnectWorkerResponse;
				if (!payload || typeof payload !== 'object') {
					return;
				}
				const resolver = this.pending.get(payload.id);
				if (resolver) {
					this.pending.delete(payload.id);
					resolver(payload);
				}
			} catch {
				// 父进程偶尔会写入非 JSON 内容（例如换行），忽略即可。
			}
		});
	}

	nextId(prefix: string): string {
		this.counter += 1;
		return `${prefix}-${Date.now()}-${this.counter}`;
	}

	wait(
		id: string,
		timeoutMs = APPROVAL_TIMEOUT_MS,
	): Promise<ConnectWorkerResponse | null> {
		return new Promise(resolve => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				resolve(null);
			}, timeoutMs);
			this.pending.set(id, value => {
				clearTimeout(timer);
				resolve(value);
			});
		});
	}
}

function normalizeFiles(prompt: string, files: string[] | undefined): string {
	const list = (files ?? []).filter(Boolean);
	if (list.length === 0) {
		return prompt;
	}
	const hints = list.map(file => `- ${file}`).join('\n');
	return `${prompt}\n\n用户通过 IM 发送了以下附件（已落盘，可直接读取）：\n${hints}`;
}

export async function runConnectWorker(
	payload: ConnectWorkerPayload,
): Promise<number> {
	// 保证 stdout 只输出协议行；依赖里的 console.log 重定向到 stderr。
	console.log = (...args: unknown[]) => {
		process.stderr.write(`${args.map(String).join(' ')}\n`);
	};
	console.info = console.log;

	if (payload.workingDirectory) {
		try {
			process.chdir(payload.workingDirectory);
		} catch {
			// 工作目录无效时继续使用父进程当前目录。
		}
	}

	// sessionManager 在构造时读取当前工作目录，必须在 chdir 之后再加载。
	const {sessionManager} = await import('../session/sessionManager.js');

	let session = payload.sessionId
		? await sessionManager.loadSession(payload.sessionId)
		: null;
	if (!session) {
		session = await sessionManager.createNewSession();
	}
	emit({
		type: 'session',
		sessionId: session.id,
		title: session.title || 'New Chat',
	});

	const messages = toUiMessages(session.messages ?? []);
	let lastAssistantText = '';
	let lastEmittedText = '';
	const bridge = new ResponseBridge();
	const alwaysApproved = new Set<string>();
	const autoApprove = Boolean(payload.autoApprove);
	const controller = new AbortController();

	process.on('SIGTERM', () => {
		controller.abort();
		process.exit(0);
	});
	process.on('SIGINT', () => {
		controller.abort();
		process.exit(0);
	});

	const savedMessageIds = new Set<string>();
	const saveMessage = async (message: any): Promise<void> => {
		const messageId = `${message.role}-${String(message.content ?? '').slice(
			0,
			50,
		)}-${message.tool_calls?.[0]?.id ?? ''}-${Math.floor(Date.now() / 5000)}`;
		if (savedMessageIds.has(messageId)) {
			return;
		}
		savedMessageIds.add(messageId);
		await sessionManager.addMessage({
			...message,
			timestamp: Date.now(),
		});
	};

	const setMessages = (updater: any): void => {
		const next =
			typeof updater === 'function' ? updater([...messages]) : updater;
		if (!Array.isArray(next)) {
			return;
		}
		messages.length = 0;
		messages.push(...next);

		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i];
			if (!message || message.role !== 'assistant') {
				continue;
			}
			if (message.toolPending || message.isExecuting) {
				continue;
			}
			const content = String(message.content ?? '');
			if (
				!content ||
				content.startsWith('⚡') ||
				content.startsWith('✓') ||
				content.startsWith('✗')
			) {
				continue;
			}
			if (content !== lastEmittedText) {
				lastEmittedText = content;
				lastAssistantText = content;
				emit({type: 'delta', text: content});
			}
			break;
		}
	};

	const requestToolConfirmation = async (
		toolCall: any,
	): Promise<
		| 'approve'
		| 'approve_always'
		| 'reject'
		| {type: 'reject_with_reply'; reason: string}
	> => {
		if (autoApprove || alwaysApproved.has(toolCall.function.name)) {
			return 'approve';
		}

		// 与桌面端一致：普通工具自动执行，只有敏感终端命令需要远端确认。
		if (toolCall.function.name !== 'terminal-execute') {
			return 'approve';
		}
		try {
			const args = JSON.parse(toolCall.function.arguments || '{}');
			if (!isSensitiveCommand(String(args?.command ?? '')).isSensitive) {
				return 'approve';
			}
		} catch {
			// 参数解析失败时按敏感命令处理，交给用户确认。
		}

		const id = bridge.nextId('approval');
		emit({
			type: 'approval',
			id,
			toolName: toolCall.function.name,
			arguments: toolCall.function.arguments,
		});
		const response = await bridge.wait(id);
		if (!response || response.type !== 'approval') {
			return 'reject';
		}
		if (response.decision === 'always') {
			alwaysApproved.add(toolCall.function.name);
			return 'approve_always';
		}
		return response.decision === 'approve' ? 'approve' : 'reject';
	};

	const requestUserQuestion = async (
		question: string,
		options: string[],
		_toolCall: any,
		multiSelect?: boolean,
	) => {
		const id = bridge.nextId('question');
		emit({
			type: 'question',
			id,
			question,
			options,
			multiSelect: Boolean(multiSelect),
		});
		const response = await bridge.wait(id);
		if (!response || response.type !== 'question') {
			return {selected: multiSelect ? [] : ''};
		}
		const selected = response.selected ?? [];
		return {
			selected: multiSelect ? selected : selected[0] ?? '',
			...(response.customInput ? {customInput: response.customInput} : {}),
		};
	};

	try {
		const {handleConversationWithTools} = await import(
			'../../hooks/conversation/useConversation.js'
		);

		await handleConversationWithTools({
			userContent: normalizeFiles(payload.prompt, payload.files),
			imageContents: payload.images?.map(image => ({
				type: 'image' as const,
				data: image.data,
				mimeType: image.mimeType,
			})),
			controller,
			messages,
			saveMessage,
			setMessages,
			setStreamTokenCount: () => undefined,
			requestToolConfirmation,
			requestUserQuestion,
			isToolAutoApproved: (toolName: string) =>
				autoApprove ||
				alwaysApproved.has(toolName) ||
				toolName !== 'terminal-execute',
			addMultipleToAlwaysApproved: (toolNames: string[]) => {
				for (const name of toolNames) {
					alwaysApproved.add(name);
				}
			},
			yoloModeRef: {current: autoApprove},
			setContextUsage: () => undefined,
			useBasicModel: false,
			getPendingMessages: () => [],
			clearPendingMessages: () => undefined,
			setIsStreaming: () => undefined,
			setIsReasoning: () => undefined,
			setRetryStatus: () => undefined,
		});

		emit({
			type: 'done',
			text: lastAssistantText || '(本轮没有产生文本回复)',
			sessionId: session.id,
		});
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		emit({type: 'error', message});
		return 1;
	}
}
