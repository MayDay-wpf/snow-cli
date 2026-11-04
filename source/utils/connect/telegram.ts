/**
 * Telegram Bot API 原生封装。
 *
 * 只使用 Node 内置 fetch（Node 22+），不依赖宿主注入的网络层；
 * 需要代理时由 CLI 进程自身的代理环境变量负责。
 */

export const DEFAULT_TELEGRAM_BASE_URL = 'https://api.telegram.org';
export const TELEGRAM_TEXT_LIMIT = 4000;
const DEFAULT_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export interface TelegramApiError extends Error {
	telegram: {
		code: number;
		description: string;
		retryAfter: number;
	};
}

export interface TelegramUpdate {
	update_id: number;
	message?: TelegramMessage;
	edited_message?: TelegramMessage;
	callback_query?: unknown;
}

export interface TelegramUser {
	id: number;
	is_bot?: boolean;
	first_name?: string;
	last_name?: string;
	username?: string;
}

export interface TelegramChat {
	id: number;
	type: 'private' | 'group' | 'supergroup' | 'channel';
	title?: string;
	username?: string;
}

export interface TelegramMessage {
	message_id: number;
	message_thread_id?: number;
	date: number;
	chat: TelegramChat;
	from?: TelegramUser;
	text?: string;
	caption?: string;
	entities?: Array<{type: string; offset: number; length: number}>;
	caption_entities?: Array<{type: string; offset: number; length: number}>;
	reply_to_message?: {
		message_id: number;
		from?: TelegramUser;
	};
	photo?: Array<{file_id: string; file_size?: number; width?: number; height?: number}>;
	document?: {
		file_id: string;
		file_name?: string;
		mime_type?: string;
		file_size?: number;
	};
	voice?: {file_id: string; mime_type?: string; file_size?: number};
	audio?: {file_id: string; file_name?: string; mime_type?: string; file_size?: number};
	video?: {file_id: string; file_name?: string; mime_type?: string; file_size?: number};
}

const sleep = (ms: number): Promise<void> =>
	new Promise(resolve => setTimeout(resolve, ms));

export function normalizeTelegramBaseUrl(value: string): string {
	const raw = String(value ?? '').trim();
	if (!raw) {
		return DEFAULT_TELEGRAM_BASE_URL;
	}
	const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
	return withScheme.replace(/\/+$/, '');
}

/** 按字符上限切分长文本，优先在换行处断开。 */
export function splitTelegramText(
	input: string,
	limit = TELEGRAM_TEXT_LIMIT,
): string[] {
	const text = String(input ?? '');
	if (text.length <= limit) {
		return [text];
	}

	const chunks: string[] = [];
	let rest = text;
	while (rest.length > limit) {
		let cut = rest.lastIndexOf('\n', limit);
		if (cut < Math.floor(limit / 2)) {
			cut = limit;
		}
		chunks.push(rest.slice(0, cut));
		rest = rest.slice(cut).replace(/^\n+/, '');
	}
	if (rest) {
		chunks.push(rest);
	}
	return chunks.length > 0 ? chunks : [''];
}

/** 去掉 Markdown 代码围栏标记，避免在纯文本里出现大量 ```。 */
export function markdownToPlain(input: string): string {
	return String(input ?? '')
		.replace(/\r\n?/g, '\n')
		.replace(/^```[^\n]*$/gm, '')
		.replace(/`([^`\n]+)`/g, '$1')
		.replace(/\*\*([^*\n]+)\*\*/g, '$1')
		.replace(/__([^_\n]+)__/g, '$1')
		.replace(/~~([^~\n]+)~~/g, '$1');
}

function createError(method: string, parsed: any): TelegramApiError {
	const description = String(
		parsed?.description ?? parsed?.message ?? 'Unknown Telegram error',
	);
	const error = new Error(`Telegram ${method} 失败：${description}`) as TelegramApiError;
	error.telegram = {
		code: Number(parsed?.error_code ?? 0),
		description,
		retryAfter: Number(parsed?.parameters?.retry_after ?? 0),
	};
	return error;
}

export function createTelegramApi(baseUrl: string) {
	let domain = normalizeTelegramBaseUrl(baseUrl);
	const gates = new Map<string, number>();

	const setBaseUrl = (value: string): void => {
		domain = normalizeTelegramBaseUrl(value);
		gates.clear();
	};

	/** Telegram 每个聊天约 1 条/秒，发送与编辑共用同一个闸门。 */
	const gate = async (chatId?: string | number): Promise<void> => {
		if (chatId === undefined || chatId === null || chatId === '') {
			return;
		}
		const key = String(chatId);
		const now = Date.now();
		const next = gates.get(key) ?? 0;
		if (next > now) {
			await sleep(next - now);
		}
		gates.set(key, Date.now() + 1100);
	};

	const call = async <T = any>(
		token: string,
		method: string,
		payload: Record<string, unknown> = {},
		options: {timeoutMs?: number; chatId?: string | number} = {},
	): Promise<T> => {
		if (!token) {
			throw new Error('尚未配置 Telegram Bot Token');
		}
		const {timeoutMs = 30000, chatId} = options;
		if (chatId !== undefined) {
			await gate(chatId);
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await fetch(`${domain}/bot${token}/${method}`, {
				method: 'POST',
				headers: {'Content-Type': 'application/json; charset=utf-8'},
				body: JSON.stringify(payload),
				signal: controller.signal,
			});
			const raw = await response.text();
			let parsed: any = null;
			try {
				parsed = raw ? JSON.parse(raw) : null;
			} catch {
				parsed = null;
			}
			if (!parsed) {
				throw new Error(
					`Telegram ${method} 返回异常（HTTP ${response.status}）：${raw.slice(0, 200)}`,
				);
			}
			if (parsed.ok !== true) {
				const error = createError(method, parsed);
				if (
					error.telegram.code === 429 &&
					error.telegram.retryAfter > 0 &&
					chatId !== undefined
				) {
					gates.set(String(chatId), Date.now() + error.telegram.retryAfter * 1000);
				}
				throw error;
			}
			return parsed.result as T;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`Telegram ${method} 请求超时`);
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	};

	const getMe = (token: string) =>
		call<{id: number; username?: string; first_name?: string; is_bot?: boolean}>(
			token,
			'getMe',
			{},
			{timeoutMs: 20000},
		);

	const deleteWebhook = (token: string) =>
		call(token, 'deleteWebhook', {drop_pending_updates: false}, {timeoutMs: 20000});

	const getUpdates = (
		token: string,
		options: {offset?: number; limit?: number; timeout?: number} = {},
	): Promise<TelegramUpdate[]> => {
		const {offset = 0, limit = 100, timeout = 20} = options;
		return call<TelegramUpdate[]>(
			token,
			'getUpdates',
			{offset, limit, timeout, allowed_updates: ['message']},
			{timeoutMs: (timeout + 20) * 1000},
		);
	};

	const sendMessage = (
		token: string,
		options: {
			chatId: string | number;
			threadId?: number;
			text: string;
			replyToMessageId?: number;
		},
	) =>
		call<{message_id: number}>(
			token,
			'sendMessage',
			{
				chat_id: options.chatId,
				text: options.text,
				...(options.threadId ? {message_thread_id: options.threadId} : {}),
				link_preview_options: {is_disabled: true},
				...(options.replyToMessageId
					? {
							reply_parameters: {
								message_id: options.replyToMessageId,
								allow_sending_without_reply: true,
							},
					  }
					: {}),
			},
			{chatId: options.chatId},
		);

	const editMessageText = (
		token: string,
		options: {
			chatId: string | number;
			messageId: number;
			text: string;
		},
	) =>
		call(
			token,
			'editMessageText',
			{
				chat_id: options.chatId,
				message_id: options.messageId,
				text: options.text,
				link_preview_options: {is_disabled: true},
			},
			{chatId: options.chatId},
		);

	const sendChatAction = (
		token: string,
		options: {chatId: string | number; threadId?: number},
	) =>
		call(
			token,
			'sendChatAction',
			{
				chat_id: options.chatId,
				action: 'typing',
				...(options.threadId ? {message_thread_id: options.threadId} : {}),
			},
			{timeoutMs: 20000},
		);

	const getFile = (token: string, fileId: string) =>
		call<{file_id: string; file_path?: string; file_size?: number}>(
			token,
			'getFile',
			{file_id: fileId},
			{timeoutMs: 20000},
		);

	const downloadFile = async (
		token: string,
		filePath: string,
		maxBytes = DEFAULT_MAX_DOWNLOAD_BYTES,
	): Promise<Buffer> => {
		const url = `${domain}/file/bot${token}/${String(filePath)
			.split('/')
			.map(segment => encodeURIComponent(segment))
			.join('/')}`;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 60000);
		try {
			const response = await fetch(url, {signal: controller.signal});
			if (!response.ok) {
				throw new Error(`下载 Telegram 文件失败（HTTP ${response.status}）`);
			}
			const length = Number(response.headers.get('content-length') ?? 0);
			if (length > maxBytes) {
				throw new Error('Telegram 文件超过大小上限');
			}
			const buffer = Buffer.from(await response.arrayBuffer());
			if (buffer.length > maxBytes) {
				throw new Error('Telegram 文件超过大小上限');
			}
			return buffer;
		} finally {
			clearTimeout(timer);
		}
	};

	const setMyCommands = (
		token: string,
		commands: Array<{command: string; description: string}>,
		languageCode?: string,
	) =>
		call(
			token,
			'setMyCommands',
			{commands, ...(languageCode ? {language_code: languageCode} : {})},
			{timeoutMs: 20000},
		);

	return {
		setBaseUrl,
		getMe,
		deleteWebhook,
		getUpdates,
		sendMessage,
		editMessageText,
		sendChatAction,
		getFile,
		downloadFile,
		setMyCommands,
	};
}

export type TelegramApi = ReturnType<typeof createTelegramApi>;
