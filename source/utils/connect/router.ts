import {getActiveProfileName} from '../config/configManager.js';
import {sessionManager} from '../session/sessionManager.js';
import {getBinding, removeBinding, setBinding} from './store.js';
import type {ConnectTurnHandle} from './worker.js';
import {startConnectTurn} from './worker.js';
import type {
	ConnectChannelId,
	ConnectChannelState,
	ConnectIncomingMessage,
	ConnectPushMode,
} from './types.js';

export interface ConnectAdapter {
	channel: ConnectChannelId;
	sendText: (
		chatKey: string,
		text: string,
		replyToMessageId?: string,
	) => Promise<void>;
	sendTyping?: (chatKey: string) => Promise<void>;
	createStream?: (
		chatKey: string,
		replyToMessageId?: string,
	) => Promise<{
		update: (text: string) => Promise<void>;
		finish: (text: string) => Promise<void>;
	}>;
}

export interface ConnectRouterOptions {
	adapter: ConnectAdapter;
	getForwardApprovals: () => boolean;
	getPushMode: () => ConnectPushMode;
	getWorkingDirectory: () => string;
	patchState: (
		patch: Partial<ConnectChannelState> & {
			stats?: Partial<ConnectChannelState['stats']>;
		},
	) => Promise<void>;
	bumpStat: (name: keyof ConnectChannelState['stats']) => Promise<void>;
	log: (level: 'info' | 'warn' | 'error', text: string) => Promise<void>;
}

interface PendingApproval {
	id: string;
	turn: ConnectTurnHandle;
	toolName: string;
}

interface PendingQuestion {
	id: string;
	turn: ConnectTurnHandle;
	options: string[];
	multiSelect: boolean;
}

interface ChatRuntime {
	turn: ConnectTurnHandle | null;
	stream: Awaited<
		ReturnType<NonNullable<ConnectAdapter['createStream']>>
	> | null;
	queue: ConnectIncomingMessage[];
	pendingApproval: PendingApproval | null;
	pendingQuestion: PendingQuestion | null;
	lastStreamUpdateAt: number;
}

const APPROVE_PATTERN =
	/^(批准|同意|允许|可以|通过|确认|yes|y|ok|approve|allow)$/i;
const REJECT_PATTERN = /^(拒绝|不同意|不允许|否|no|n|reject|deny|cancel)$/i;
const ALWAYS_PATTERN = /^(始终|总是|永远|always)$/i;
const MAX_QUEUE = 5;

function chatRuntimeId(channel: ConnectChannelId, chatKey: string): string {
	return `${channel}:${chatKey}`;
}

function describeToolArguments(raw: string): string {
	const text = String(raw ?? '').trim();
	if (!text) {
		return '';
	}
	try {
		const parsed = JSON.parse(text);
		const command = parsed?.command ?? parsed?.file_path ?? parsed?.path;
		if (typeof command === 'string' && command.trim()) {
			return command.trim().slice(0, 300);
		}
		return JSON.stringify(parsed).slice(0, 300);
	} catch {
		return text.slice(0, 300);
	}
}

function helpText(): string {
	return [
		'Snow CLI IM Connect',
		'',
		'直接发送消息即可交给绑定会话处理。',
		'',
		'命令：',
		'/new      新建会话并绑定本聊天',
		'/stop     中止当前回合',
		'/status   查看连接与绑定状态',
		'/unbind   解除本聊天与会话的绑定',
		'/help     显示本帮助',
		'',
		'工具授权：回复「批准」「拒绝」或「始终」。',
		'选择题：回复序号（如 1,3）或直接输入自定义答案。',
	].join('\n');
}

export function createConnectRouter(options: ConnectRouterOptions) {
	const runtimes = new Map<string, ChatRuntime>();

	const getRuntime = (message: ConnectIncomingMessage): ChatRuntime => {
		const id = chatRuntimeId(message.channel, message.chatKey);
		let runtime = runtimes.get(id);
		if (!runtime) {
			runtime = {
				turn: null,
				stream: null,
				queue: [],
				pendingApproval: null,
				pendingQuestion: null,
				lastStreamUpdateAt: 0,
			};
			runtimes.set(id, runtime);
		}
		return runtime;
	};

	const sendText = async (
		message: ConnectIncomingMessage,
		text: string,
	): Promise<void> => {
		await options.adapter.sendText(
			message.chatKey,
			text,
			message.replyToMessageId,
		);
		await options.bumpStat('delivered').catch(() => undefined);
	};

	const handleCommand = async (
		message: ConnectIncomingMessage,
		runtime: ChatRuntime,
		commandLine: string,
	): Promise<boolean> => {
		const [rawCommand, ...rest] = commandLine.trim().split(/\s+/);
		const command = String(rawCommand ?? '').toLowerCase();
		const argument = rest.join(' ').trim();

		switch (command) {
			case '/help':
			case '/start': {
				await sendText(message, helpText());
				return true;
			}
			case '/status': {
				const binding = await getBinding(message.channel, message.chatKey);
				const lines = [
					'Snow CLI IM Connect',
					`渠道：${message.channel}`,
					`聊天：${message.chatKey}`,
					`绑定会话：${
						binding ? binding.sessionId : '未绑定（下一条消息会自动新建）'
					}`,
					binding?.title ? `会话标题：${binding.title}` : '',
					`当前回合：${runtime.turn ? '运行中' : '空闲'}`,
					`排队消息：${runtime.queue.length}`,
					`工作目录：${options.getWorkingDirectory()}`,
					`模型档案：${getActiveProfileName()}`,
					`待授权：${
						runtime.pendingApproval ? runtime.pendingApproval.toolName : '无'
					}`,
					`待回答：${runtime.pendingQuestion ? '有' : '无'}`,
				].filter(Boolean);
				await sendText(message, lines.join('\n'));
				return true;
			}
			case '/new': {
				runtime.turn?.stop();
				runtime.turn = null;
				runtime.stream = null;
				runtime.queue = [];
				runtime.pendingApproval = null;
				runtime.pendingQuestion = null;
				await removeBinding(message.channel, message.chatKey);
				await sendText(
					message,
					argument
						? `已解除绑定。下一条消息会在新会话中处理，标题提示：${argument}`
						: '已解除绑定。下一条消息会自动新建会话。',
				);
				return true;
			}
			case '/stop': {
				if (!runtime.turn) {
					await sendText(message, '当前没有运行中的回合。');
					return true;
				}
				runtime.turn.stop();
				runtime.turn = null;
				runtime.stream = null;
				runtime.pendingApproval = null;
				runtime.pendingQuestion = null;
				await sendText(message, '已中止当前回合。');
				return true;
			}
			case '/unbind': {
				runtime.turn?.stop();
				runtime.turn = null;
				runtime.stream = null;
				runtime.queue = [];
				runtime.pendingApproval = null;
				runtime.pendingQuestion = null;
				await removeBinding(message.channel, message.chatKey);
				await sendText(message, '已解除本聊天与会话的绑定。');
				return true;
			}
			case '/model': {
				await sendText(
					message,
					`当前全局 API 档案：${getActiveProfileName()}\nIM 会话跟随全局配置；切换请在本机终端使用 /profiles 或 /models。`,
				);
				return true;
			}
			default:
				return false;
		}
	};

	const resolveApproval = async (
		message: ConnectIncomingMessage,
		runtime: ChatRuntime,
		text: string,
	): Promise<boolean> => {
		const pending = runtime.pendingApproval;
		if (!pending) {
			return false;
		}
		const value = text.trim();
		if (APPROVE_PATTERN.test(value)) {
			pending.turn.respondApproval(pending.id, 'approve');
			runtime.pendingApproval = null;
			await sendText(message, '已批准。');
			return true;
		}
		if (REJECT_PATTERN.test(value)) {
			pending.turn.respondApproval(pending.id, 'reject');
			runtime.pendingApproval = null;
			await sendText(message, '已拒绝。');
			return true;
		}
		if (ALWAYS_PATTERN.test(value)) {
			pending.turn.respondApproval(pending.id, 'always');
			runtime.pendingApproval = null;
			await sendText(message, '已批准，并在本回合内始终允许该工具。');
			return true;
		}
		await sendText(message, '请回复「批准」「拒绝」或「始终」。');
		return true;
	};

	const resolveQuestion = async (
		message: ConnectIncomingMessage,
		runtime: ChatRuntime,
		text: string,
	): Promise<boolean> => {
		const pending = runtime.pendingQuestion;
		if (!pending) {
			return false;
		}
		const value = text.trim();
		if (!value) {
			return false;
		}

		const indexes = value
			.split(/[,\s，]+/)
			.map(part => Number(part))
			.filter(part => Number.isInteger(part) && part > 0);

		const selected: string[] = [];
		if (indexes.length > 0) {
			for (const index of indexes) {
				const option = pending.options[index - 1];
				if (option) {
					selected.push(option);
				}
			}
		}
		if (selected.length === 0) {
			for (const option of pending.options) {
				if (option && value.includes(option)) {
					selected.push(option);
				}
			}
		}

		const customInput = selected.length === 0 ? value : undefined;
		if (!pending.multiSelect && selected.length > 1) {
			selected.splice(1);
		}
		if (!pending.multiSelect && selected.length === 0 && !customInput) {
			await sendText(message, '请回复选项序号或直接输入答案。');
			return true;
		}

		pending.turn.respondQuestion(pending.id, selected, customInput);
		runtime.pendingQuestion = null;
		await sendText(message, '已提交回答。');
		return true;
	};

	const processQueue = async (runtime: ChatRuntime): Promise<void> => {
		if (runtime.turn || runtime.queue.length === 0) {
			return;
		}
		const next = runtime.queue.shift();
		if (next) {
			await startTurn(next, runtime);
		}
	};

	const startTurn = async (
		message: ConnectIncomingMessage,
		runtime: ChatRuntime,
	): Promise<void> => {
		const binding = await getBinding(message.channel, message.chatKey);
		const prompt =
			message.text ||
			(message.images?.length || message.files?.length
				? '请查看我发送的附件。'
				: '');
		if (!prompt) {
			return;
		}

		const useStream =
			options.getPushMode() === 'stream' &&
			typeof options.adapter.createStream === 'function';

		if (useStream) {
			try {
				runtime.stream = await options.adapter.createStream!(
					message.chatKey,
					message.replyToMessageId,
				);
			} catch (error) {
				await options.log(
					'warn',
					`创建流式占位消息失败：${
						error instanceof Error ? error.message : String(error)
					}`,
				);
				runtime.stream = null;
			}
		}

		await options.adapter.sendTyping?.(message.chatKey).catch(() => undefined);

		let turn: ConnectTurnHandle;
		try {
			turn = startConnectTurn({
				prompt,
				sessionId: binding?.sessionId,
				workingDirectory: options.getWorkingDirectory(),
				autoApprove: !options.getForwardApprovals(),
				images: message.images,
				files: message.files,
				onStderr: text => {
					void options.log('warn', `worker: ${text.slice(0, 500)}`);
				},
				onEvent: event => {
					if (event.type === 'session') {
						void setBinding(message.channel, message.chatKey, {
							sessionId: event.sessionId,
							title: event.title,
							updatedAt: Date.now(),
						});
						return;
					}
					if (event.type === 'delta') {
						const now = Date.now();
						if (runtime.stream && now - runtime.lastStreamUpdateAt >= 1000) {
							runtime.lastStreamUpdateAt = now;
							void runtime.stream.update(event.text).catch(() => undefined);
						}
						return;
					}
					if (event.type === 'approval') {
						runtime.pendingApproval = {
							id: event.id,
							turn,
							toolName: event.toolName,
						};
						const detail = describeToolArguments(event.arguments);
						void sendText(
							message,
							[
								`工具授权请求：${event.toolName}`,
								detail ? `参数：${detail}` : '',
								'',
								'回复「批准」「拒绝」或「始终」。',
							]
								.filter(Boolean)
								.join('\n'),
						).catch(() => undefined);
						return;
					}
					if (event.type === 'question') {
						runtime.pendingQuestion = {
							id: event.id,
							turn,
							options: event.options ?? [],
							multiSelect: Boolean(event.multiSelect),
						};
						const lines = [
							'需要你回答：',
							event.question,
							'',
							...(event.options ?? []).map(
								(option, index) => `${index + 1}. ${option}`,
							),
							'',
							event.multiSelect
								? '回复序号（多个用逗号分隔），或直接输入自定义答案。'
								: '回复序号，或直接输入自定义答案。',
						];
						void sendText(message, lines.join('\n')).catch(() => undefined);
						return;
					}
					if (event.type === 'error') {
						void options.log('error', `回合失败：${event.message}`);
					}
				},
			});
		} catch (error) {
			const messageText = `处理失败：${
				error instanceof Error ? error.message : String(error)
			}`;
			if (runtime.stream) {
				await runtime.stream.finish(messageText).catch(() => undefined);
				runtime.stream = null;
			} else {
				await sendText(message, messageText).catch(() => undefined);
			}
			await options.bumpStat('errors').catch(() => undefined);
			return;
		}

		runtime.turn = turn;

		const result = await turn.done;
		const wasCurrent = runtime.turn === turn;
		if (!wasCurrent) {
			// 回合已被 /stop、/new 或 /unbind 主动终止：不要再发送结果或覆盖状态。
			return;
		}
		runtime.turn = null;

		if (result.ok) {
			const finalText = result.text || '(本轮没有产生文本回复)';
			if (runtime.stream) {
				await runtime.stream.finish(finalText).catch(async error => {
					await options.log(
						'warn',
						`发送最终回复失败：${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				});
				runtime.stream = null;
			} else {
				await sendText(message, finalText).catch(async error => {
					await options.log(
						'warn',
						`发送最终回复失败：${
							error instanceof Error ? error.message : String(error)
						}`,
					);
				});
			}
			await options.bumpStat('delivered').catch(() => undefined);
			if (result.sessionId) {
				let title = '';
				try {
					const session = await sessionManager.getSessionForExport(
						result.sessionId,
					);
					title = session?.title ?? '';
				} catch {
					title = '';
				}
				await setBinding(message.channel, message.chatKey, {
					sessionId: result.sessionId,
					title,
					updatedAt: Date.now(),
				});
			}
		} else {
			if (runtime.stream) {
				await runtime.stream
					.finish(`处理失败：${result.error ?? '未知错误'}`)
					.catch(() => undefined);
				runtime.stream = null;
			} else {
				await sendText(
					message,
					`处理失败：${result.error ?? '未知错误'}`,
				).catch(() => undefined);
			}
			await options.bumpStat('errors').catch(() => undefined);
		}

		await processQueue(runtime);
	};

	const handleIncoming = async (
		message: ConnectIncomingMessage,
	): Promise<void> => {
		const runtime = getRuntime(message);

		if (message.accessDenied) {
			await options.bumpStat('denied').catch(() => undefined);
			await sendText(
				message,
				'你不在该 Snow CLI 实例的 IM 允许名单中。请在本机 /connect 面板中添加你的用户标识。',
			).catch(() => undefined);
			return;
		}

		const text = message.text.trim();
		if (!text && !message.images?.length && !message.files?.length) {
			return;
		}

		if (text.startsWith('/')) {
			if (await resolveApproval(message, runtime, text)) {
				return;
			}
			if (await resolveQuestion(message, runtime, text)) {
				return;
			}
			if (await handleCommand(message, runtime, text)) {
				return;
			}
		} else {
			if (await resolveApproval(message, runtime, text)) {
				return;
			}
			if (await resolveQuestion(message, runtime, text)) {
				return;
			}
		}

		if (runtime.turn) {
			if (runtime.queue.length >= MAX_QUEUE) {
				await sendText(message, '排队消息过多，请稍后再试。');
				return;
			}
			runtime.queue.push(message);
			await sendText(message, '已收到，将在当前回合结束后处理。');
			return;
		}

		await startTurn(message, runtime);
	};

	const stop = (): void => {
		for (const runtime of runtimes.values()) {
			runtime.turn?.stop();
			runtime.turn = null;
			runtime.stream = null;
			runtime.queue = [];
			runtime.pendingApproval = null;
			runtime.pendingQuestion = null;
		}
		runtimes.clear();
	};

	return {handleIncoming, stop};
}
