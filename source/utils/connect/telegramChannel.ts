import {promises as fs} from 'node:fs';
import path from 'node:path';
import {getGlobalSnowDir} from '../core/snowContext.js';
import {
	createTelegramApi,
	markdownToPlain,
	splitTelegramText,
	type TelegramApi,
	type TelegramApiError,
	type TelegramMessage,
	type TelegramUpdate,
} from './telegram.js';
import type {
	ConnectChannelState,
	ConnectIncomingMessage,
	TelegramConnectConfig,
} from './types.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_STREAM_CHARS = 3900;
const TYPING_INTERVAL_MS = 4000;

interface TelegramChannelOptions {
	getConfig: () => TelegramConnectConfig;
	getCursor: () => {offset: number; botId: number};
	saveCursor: (offset: number, botId: number) => Promise<void>;
	onIncoming: (message: ConnectIncomingMessage) => Promise<void>;
	patchState: (
		patch: Partial<ConnectChannelState> & {
			stats?: Partial<ConnectChannelState['stats']>;
		},
	) => Promise<void>;
	bumpStat: (name: keyof ConnectChannelState['stats']) => Promise<void>;
	log: (level: 'info' | 'warn' | 'error', text: string) => Promise<void>;
}

export interface TelegramStream {
	update: (text: string) => Promise<void>;
	finish: (text: string) => Promise<void>;
}

export interface TelegramChannel {
	start: () => Promise<void>;
	stop: () => void;
	restart: () => Promise<void>;
	sendText: (
		chatKey: string,
		text: string,
		replyToMessageId?: string,
	) => Promise<void>;
	sendTyping: (chatKey: string) => Promise<void>;
	createStream: (chatKey: string) => Promise<TelegramStream>;
	getBotUsername: () => string;
	isRunning: () => boolean;
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise(resolve => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			'abort',
			() => {
				clearTimeout(timer);
				resolve();
			},
			{once: true},
		);
	});

function dateStamp(): string {
	const now = new Date();
	const pad = (value: number) => String(value).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
		now.getDate(),
	)}`;
}

function sanitizeName(name: string): string {
	const base = String(name ?? '')
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
		.trim();
	return (base || 'attachment').slice(0, 80);
}

function parseChatKey(chatKey: string): {chatId: string; threadId: number} {
	const index = chatKey.indexOf(':');
	if (index === -1) {
		return {chatId: chatKey, threadId: 0};
	}
	return {
		chatId: chatKey.slice(0, index),
		threadId: Number(chatKey.slice(index + 1)) || 0,
	};
}

function detectImageMime(filePath: string, fallback: string): string {
	const lower = filePath.toLowerCase();
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.bmp')) return 'image/bmp';
	return fallback || 'image/jpeg';
}

function stripMention(text: string, username: string): string {
	if (!username) {
		return text.trim();
	}
	const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return text.replace(new RegExp(`@${escaped}`, 'gi'), '').trim();
}

function hasMention(
	message: TelegramMessage,
	botId: number,
	botUsername: string,
): boolean {
	if (message.reply_to_message?.from?.id === botId) {
		return true;
	}
	if (!botUsername) {
		return false;
	}
	const text = message.text ?? message.caption ?? '';
	const lower = text.toLowerCase();
	if (lower.includes(`@${botUsername.toLowerCase()}`)) {
		return true;
	}
	const entities = message.entities ?? message.caption_entities ?? [];
	for (const entity of entities) {
		if (entity.type !== 'mention' && entity.type !== 'text_mention') {
			continue;
		}
		const value = text.slice(entity.offset, entity.offset + entity.length);
		if (value.toLowerCase() === `@${botUsername.toLowerCase()}`) {
			return true;
		}
	}
	return false;
}

export function createTelegramChannel(
	options: TelegramChannelOptions,
): TelegramChannel {
	let api: TelegramApi | null = null;
	let controller: AbortController | null = null;
	let generation = 0;
	let running = false;
	let botId = 0;
	let botUsername = '';
	let lastTokenFingerprint = '';
	let currentApiBase = '';

	const ensureApi = (): TelegramApi => {
		const config = options.getConfig();
		if (!api || currentApiBase !== config.baseUrl) {
			api = createTelegramApi(config.baseUrl);
			currentApiBase = config.baseUrl;
		}
		return api;
	};

	const stop = (): void => {
		generation += 1;
		running = false;
		controller?.abort();
		controller = null;
	};

	const patchStatus = async (
		patch: Partial<ConnectChannelState> & {
			stats?: Partial<ConnectChannelState['stats']>;
		},
	): Promise<void> => {
		await options.patchState(patch);
	};

	const registerCommands = async (token: string): Promise<void> => {
		const client = ensureApi();
		try {
			await client.setMyCommands(token, [
				{command: 'new', description: '新建会话并绑定本聊天'},
				{command: 'stop', description: '中止当前回合'},
				{command: 'status', description: '查看连接与绑定状态'},
				{command: 'unbind', description: '解除本聊天与会话的绑定'},
				{command: 'help', description: '显示帮助'},
			]);
		} catch (error) {
			await options.log(
				'warn',
				`注册 Telegram 命令菜单失败（不影响使用）：${describe(error)}`,
			);
		}
	};

	const parseAndDispatch = async (update: TelegramUpdate): Promise<void> => {
		const message = update.message;
		if (!message || !message.from || message.from.is_bot) {
			return;
		}
		const config = options.getConfig();
		if (!config.enabled) {
			return;
		}

		let text = (message.text ?? message.caption ?? '').trim();
		const group = message.chat.type !== 'private';
		if (group && config.groupRequireMention) {
			if (!hasMention(message, botId, botUsername)) {
				await options.log(
					'info',
					`群聊消息未 @机器人，已忽略（chat=${message.chat.id}）`,
				);
				return;
			}
			text = stripMention(text, botUsername);
		}

		const accessDenied =
			!group &&
			!config.allowAllDirect &&
			!config.allowedUserIds.map(String).includes(String(message.from.id));

		const chatKey = `${message.chat.id}:${message.message_thread_id ?? 0}`;
		const displayName =
			message.from.username ||
			[message.from.first_name, message.from.last_name]
				.filter(Boolean)
				.join(' ') ||
			String(message.from.id);

		if (accessDenied) {
			await patchStatus({lastMessageAt: Date.now()}).catch(() => undefined);
			await options.bumpStat('received').catch(() => undefined);
			await options.onIncoming({
				channel: 'telegram',
				chatKey,
				chatId: String(message.chat.id),
				messageId: String(message.message_id),
				userId: String(message.from.id),
				userName: displayName,
				text,
				isGroup: group,
				accessDenied: true,
			});
			return;
		}

		const images: Array<{data: string; mimeType: string}> = [];
		const files: string[] = [];

		const download = async (
			fileId: string,
			fileName: string,
			mimeType: string,
			asImage: boolean,
		): Promise<void> => {
			const client = ensureApi();
			const configNow = options.getConfig();
			if (!configNow.token) {
				return;
			}
			try {
				const info = await client.getFile(configNow.token, fileId);
				if (!info.file_path) {
					return;
				}
				const size = Number(info.file_size ?? 0);
				if (size > MAX_ATTACHMENT_BYTES) {
					files.push('');
					text += `\n[附件 ${fileName} 超过 20MB，已跳过]`;
					return;
				}
				const buffer = await client.downloadFile(
					configNow.token,
					info.file_path,
					MAX_ATTACHMENT_BYTES,
				);
				const resolvedMime = detectImageMime(info.file_path, mimeType);
				if (asImage && buffer.length <= MAX_IMAGE_BYTES) {
					images.push({
						data: buffer.toString('base64'),
						mimeType: resolvedMime,
					});
					return;
				}
				const dir = path.join(
					getGlobalSnowDir().native,
					'connect-inbox',
					'telegram',
					dateStamp(),
				);
				await fs.mkdir(dir, {recursive: true});
				const target = path.join(
					dir,
					`${Date.now()}-${sanitizeName(fileName || 'attachment')}`,
				);
				await fs.writeFile(target, buffer);
				files.push(target);
			} catch (error) {
				text += `\n[附件下载失败：${describe(error)}]`;
				await options.log('warn', `Telegram 附件下载失败：${describe(error)}`);
			}
		};

		if (message.photo && message.photo.length > 0) {
			const largest = message.photo[message.photo.length - 1]!;
			await download(largest.file_id, 'photo.jpg', 'image/jpeg', true);
		}
		if (message.document) {
			const doc = message.document;
			await download(
				doc.file_id,
				doc.file_name || 'document',
				doc.mime_type || 'application/octet-stream',
				String(doc.mime_type ?? '').startsWith('image/'),
			);
		}
		if (message.voice) {
			await download(
				message.voice.file_id,
				'voice.ogg',
				message.voice.mime_type || 'audio/ogg',
				false,
			);
		}
		if (message.audio) {
			await download(
				message.audio.file_id,
				message.audio.file_name || 'audio',
				message.audio.mime_type || 'audio/mpeg',
				false,
			);
		}
		if (message.video) {
			await download(
				message.video.file_id,
				message.video.file_name || 'video',
				message.video.mime_type || 'video/mp4',
				false,
			);
		}

		if (!text && images.length === 0 && files.length === 0) {
			return;
		}

		await patchStatus({
			lastMessageAt: Date.now(),
		}).catch(() => undefined);
		await options.bumpStat('received').catch(() => undefined);

		await options.onIncoming({
			channel: 'telegram',
			chatKey,
			chatId: String(message.chat.id),
			messageId: String(message.message_id),
			userId: String(message.from.id),
			userName:
				message.from.username ||
				[message.from.first_name, message.from.last_name]
					.filter(Boolean)
					.join(' ') ||
				String(message.from.id),
			text,
			isGroup: group,
			replyToMessageId: String(message.message_id),
			images: images.length > 0 ? images : undefined,
			files: files.filter(Boolean),
		});
	};

	const pollLoop = async (
		token: string,
		startOffset: number,
	): Promise<void> => {
		const mine = generation;
		const client = ensureApi();
		let offset = startOffset;
		let backoff = 2000;
		let webhookCleared = false;

		while (running && mine === generation && !controller?.signal.aborted) {
			if (!webhookCleared) {
				try {
					await client.deleteWebhook(token);
					webhookCleared = true;
					await patchStatus({
						status: 'connecting',
						detail: '已移除 webhook，正在建立长轮询',
					});
				} catch (error) {
					await options.log('warn', `移除 webhook 失败：${describe(error)}`);
				}
			}

			try {
				const updates = await client.getUpdates(token, {offset});
				if (!running || mine !== generation || controller?.signal.aborted) {
					return;
				}
				backoff = 2000;
				await patchStatus({status: 'online', detail: ''});

				for (const update of updates) {
					if (!running || mine !== generation || controller?.signal.aborted) {
						return;
					}
					const updateId = Number(update.update_id ?? 0);
					if (updateId >= offset) {
						offset = updateId + 1;
					}
					try {
						await parseAndDispatch(update);
					} catch (error) {
						await options.log(
							'error',
							`处理 Telegram 更新失败：${describe(error)}`,
						);
					}
					await options.saveCursor(offset, botId).catch(() => undefined);
				}
			} catch (error) {
				if (!running || mine !== generation || controller?.signal.aborted) {
					return;
				}
				const info = (error as TelegramApiError)?.telegram;
				const message = describe(error);
				if (info?.code === 401 || /unauthorized/i.test(message)) {
					await options.log('error', 'Bot Token 无效或已被吊销，长轮询停止');
					await patchStatus({
						status: 'error',
						detail: 'Bot Token 无效或已被吊销',
					});
					await options.bumpStat('errors').catch(() => undefined);
					stop();
					return;
				}
				if (info?.code === 409) {
					webhookCleared = false;
					await options.log(
						'warn',
						'getUpdates 冲突（409）：可能有另一个实例在轮询，或 webhook 被重新设置',
					);
					await patchStatus({
						status: 'reconnecting',
						detail: '与其他实例冲突，正在重试',
					});
					await sleep(backoff, controller?.signal);
					continue;
				}
				if (info?.code === 429) {
					const waitMs = Math.max(1000, Number(info.retryAfter ?? 3) * 1000);
					await options.log(
						'warn',
						`Telegram 限流，等待 ${Math.round(waitMs / 1000)} 秒`,
					);
					await patchStatus({
						status: 'reconnecting',
						detail: '限流中，等待重试',
					});
					await sleep(waitMs, controller?.signal);
					continue;
				}
				await options.log('warn', `Telegram 长轮询失败：${message}`);
				await patchStatus({
					status: 'reconnecting',
					detail: message.slice(0, 160),
				});
				await options.bumpStat('errors').catch(() => undefined);
				await sleep(backoff, controller?.signal);
				backoff = Math.min(30000, Math.round(backoff * 1.8));
			}
		}
	};

	const start = async (): Promise<void> => {
		const config = options.getConfig();
		if (!config.enabled) {
			stop();
			await patchStatus({status: 'disabled', detail: '渠道已停用'});
			return;
		}
		if (!config.token) {
			stop();
			await patchStatus({status: 'idle', detail: '尚未配置 Bot Token'});
			return;
		}

		const fingerprint = `${config.baseUrl}|${config.token.slice(-8)}`;
		if (running && fingerprint === lastTokenFingerprint) {
			return;
		}

		stop();
		lastTokenFingerprint = fingerprint;
		controller = new AbortController();
		running = true;
		generation += 1;
		const mine = generation;

		try {
			const client = ensureApi();
			await patchStatus({status: 'connecting', detail: '正在校验 Bot Token'});
			const me = await client.getMe(config.token);
			if (!running || mine !== generation) {
				return;
			}
			botId = Number(me.id ?? 0);
			botUsername = String(me.username ?? '');
			await patchStatus({
				status: 'connecting',
				account: botUsername ? `@${botUsername}` : String(botId),
				detail: 'Bot 校验通过，正在建立长轮询',
				connectedAt: Date.now(),
			});
			await options.log(
				'info',
				`Telegram Bot 校验通过：@${botUsername || botId}`,
			);
			await registerCommands(config.token);
			const cursor = options.getCursor();
			const offset =
				Number(cursor.botId) === botId ? Number(cursor.offset) || 0 : 0;
			if (Number(cursor.botId) !== botId) {
				await options.saveCursor(0, botId).catch(() => undefined);
			}
			void pollLoop(config.token, offset);
		} catch (error) {
			stop();
			await patchStatus({
				status: 'error',
				detail: `Bot Token 校验失败：${describe(error)}`,
			});
			await options.bumpStat('errors').catch(() => undefined);
			await options.log('error', `Bot Token 校验失败：${describe(error)}`);
		}
	};

	const restart = async (): Promise<void> => {
		stop();
		lastTokenFingerprint = '';
		await start();
	};

	const sendText = async (
		chatKey: string,
		text: string,
		replyToMessageId?: string,
	): Promise<void> => {
		const config = options.getConfig();
		if (!config.token) {
			throw new Error('尚未配置 Telegram Bot Token');
		}
		const client = ensureApi();
		const {chatId, threadId} = parseChatKey(chatKey);
		const plain = markdownToPlain(text);
		const chunks = splitTelegramText(plain);
		let first = true;
		for (const chunk of chunks) {
			await client.sendMessage(config.token, {
				chatId,
				threadId: threadId || undefined,
				text: chunk,
				replyToMessageId:
					first && replyToMessageId ? Number(replyToMessageId) : undefined,
			});
			first = false;
		}
	};

	const sendTyping = async (chatKey: string): Promise<void> => {
		const config = options.getConfig();
		if (!config.token) {
			return;
		}
		const client = ensureApi();
		const {chatId, threadId} = parseChatKey(chatKey);
		await client.sendChatAction(config.token, {
			chatId,
			threadId: threadId || undefined,
		});
	};

	const createStream = async (chatKey: string): Promise<TelegramStream> => {
		const config = options.getConfig();
		const client = ensureApi();
		const {chatId, threadId} = parseChatKey(chatKey);
		let messageId = 0;
		let lastText = '';
		let typingTimer: NodeJS.Timeout | null = null;

		if (config.token) {
			const sent = await client.sendMessage(config.token, {
				chatId,
				threadId: threadId || undefined,
				text: '正在思考...',
			});
			messageId = Number(sent?.message_id ?? 0);
			typingTimer = setInterval(() => {
				void sendTyping(chatKey).catch(() => undefined);
			}, TYPING_INTERVAL_MS);
		}

		const stopTyping = () => {
			if (typingTimer) {
				clearInterval(typingTimer);
				typingTimer = null;
			}
		};

		return {
			update: async (text: string) => {
				if (!config.token || !messageId) {
					return;
				}
				const plain = markdownToPlain(text);
				const tail =
					plain.length > MAX_STREAM_CHARS
						? `...\n${plain.slice(-MAX_STREAM_CHARS)}`
						: plain;
				if (!tail.trim() || tail === lastText) {
					return;
				}
				lastText = tail;
				try {
					await client.editMessageText(config.token, {
						chatId,
						messageId,
						text: tail,
					});
				} catch (error) {
					const message = describe(error);
					if (!/not modified/i.test(message)) {
						await options.log('warn', `更新 Telegram 流式消息失败：${message}`);
					}
				}
			},
			finish: async (text: string) => {
				stopTyping();
				const plain = markdownToPlain(text);
				const chunks = splitTelegramText(plain);
				if (!config.token) {
					return;
				}
				if (messageId) {
					try {
						await client.editMessageText(config.token, {
							chatId,
							messageId,
							text: chunks[0] ?? '',
						});
					} catch (error) {
						if (!/not modified/i.test(describe(error))) {
							await options.log(
								'warn',
								`更新 Telegram 最终消息失败：${describe(error)}`,
							);
						}
					}
					for (let i = 1; i < chunks.length; i++) {
						await client.sendMessage(config.token, {
							chatId,
							threadId: threadId || undefined,
							text: chunks[i]!,
						});
					}
				} else {
					for (const chunk of chunks) {
						await client.sendMessage(config.token, {
							chatId,
							threadId: threadId || undefined,
							text: chunk,
						});
					}
				}
				stopTyping();
			},
		};
	};

	return {
		start,
		stop,
		restart,
		sendText,
		sendTyping,
		createStream,
		getBotUsername: () => botUsername,
		isRunning: () => running,
	};
}
