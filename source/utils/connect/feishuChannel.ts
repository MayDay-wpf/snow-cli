import {promises as fs} from 'node:fs';
import path from 'node:path';
import {getGlobalSnowDir} from '../core/snowContext.js';
import {createFeishuApi, type FeishuApi} from './feishu.js';
import {createFeishuConnection} from './feishuConnection.js';
import type {
	ConnectChannelState,
	ConnectIncomingMessage,
	FeishuConnectConfig,
} from './types.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

interface FeishuChannelOptions {
	getConfig: () => FeishuConnectConfig;
	onIncoming: (message: ConnectIncomingMessage) => Promise<void>;
	patchState: (
		patch: Partial<ConnectChannelState> & {
			stats?: Partial<ConnectChannelState['stats']>;
		},
	) => Promise<void>;
	bumpStat: (name: keyof ConnectChannelState['stats']) => Promise<void>;
	log: (level: 'info' | 'warn' | 'error', text: string) => Promise<void>;
}

export interface FeishuChannel {
	start: () => Promise<void>;
	stop: () => void;
	restart: () => Promise<void>;
	sendText: (chatKey: string, text: string) => Promise<void>;
	isRunning: () => boolean;
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

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

function detectImageMime(fileName: string): string {
	const lower = fileName.toLowerCase();
	if (lower.endsWith('.png')) return 'image/png';
	if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
	if (lower.endsWith('.gif')) return 'image/gif';
	if (lower.endsWith('.webp')) return 'image/webp';
	if (lower.endsWith('.bmp')) return 'image/bmp';
	return 'image/jpeg';
}

function stripMentions(text: string, mentions: Array<{key?: string}>): string {
	let next = text;
	for (const mention of mentions) {
		if (mention.key) {
			next = next.split(mention.key).join('');
		}
	}
	return next.trim();
}

export function createFeishuChannel(
	options: FeishuChannelOptions,
): FeishuChannel {
	let api: FeishuApi | null = null;
	let connection: ReturnType<typeof createFeishuConnection> | null = null;
	let running = false;
	let fingerprint = '';
	let currentDomain = '';
	const seenEvents = new Set<string>();
	const seenOrder: string[] = [];

	const ensureApi = (config: FeishuConnectConfig): FeishuApi => {
		if (!api || currentDomain !== config.domain) {
			api = createFeishuApi(config.domain);
			currentDomain = config.domain;
		}
		return api;
	};

	const seen = (eventId: string): boolean => {
		if (!eventId) {
			return false;
		}
		if (seenEvents.has(eventId)) {
			return true;
		}
		seenEvents.add(eventId);
		seenOrder.push(eventId);
		while (seenOrder.length > 500) {
			const old = seenOrder.shift();
			if (old) {
				seenEvents.delete(old);
			}
		}
		return false;
	};

	const saveAttachment = async (
		client: FeishuApi,
		config: FeishuConnectConfig,
		messageId: string,
		fileKey: string,
		fileName: string,
		asImage: boolean,
	): Promise<{
		image?: {data: string; mimeType: string};
		file?: string;
		error?: string;
	}> => {
		try {
			const type = asImage ? 'image' : 'file';
			const {buffer} = await client.downloadResource(
				config.appId,
				config.appSecret,
				messageId,
				fileKey,
				type,
				MAX_ATTACHMENT_BYTES,
			);
			const mime = asImage
				? detectImageMime(fileName)
				: 'application/octet-stream';
			if (asImage && buffer.length <= MAX_IMAGE_BYTES) {
				return {image: {data: buffer.toString('base64'), mimeType: mime}};
			}
			const dir = path.join(
				getGlobalSnowDir().native,
				'connect-inbox',
				'feishu',
				dateStamp(),
			);
			await fs.mkdir(dir, {recursive: true});
			const target = path.join(
				dir,
				`${Date.now()}-${sanitizeName(fileName || 'attachment')}`,
			);
			await fs.writeFile(target, buffer);
			return {file: target};
		} catch (error) {
			return {error: describe(error)};
		}
	};

	const handleEvent = async (event: any): Promise<void> => {
		const eventType = event?.header?.event_type ?? event?.event?.type;
		if (eventType !== 'im.message.receive_v1') {
			return;
		}
		const eventId = String(event?.header?.event_id ?? '');
		if (seen(eventId)) {
			return;
		}

		const config = options.getConfig();
		if (!config.enabled) {
			return;
		}

		const payload = event?.event ?? {};
		const message = payload.message;
		const sender = payload.sender;
		if (!message || !sender) {
			return;
		}
		if (sender.sender_type === 'app' || sender.sender_type === 'bot') {
			return;
		}

		const chatId = String(message.chat_id ?? '');
		const messageId = String(message.message_id ?? '');
		if (!chatId || !messageId) {
			return;
		}

		const chatType = String(message.chat_type ?? 'p2p');
		const isGroup = chatType !== 'p2p';
		const senderId =
			sender?.sender_id?.open_id ?? sender?.sender_id?.user_id ?? '';
		const mentions = Array.isArray(message.mentions) ? message.mentions : [];
		if (isGroup && config.groupRequireMention && mentions.length === 0) {
			await options.log(
				'info',
				`飞书群聊消息未 @机器人，已忽略（chat=${chatId}）`,
			);
			return;
		}

		const accessDenied =
			!isGroup &&
			!config.allowAllDirect &&
			!config.allowedOpenIds.map(String).includes(String(senderId));

		if (accessDenied) {
			await options
				.patchState({lastMessageAt: Date.now()})
				.catch(() => undefined);
			await options.bumpStat('received').catch(() => undefined);
			await options.onIncoming({
				channel: 'feishu',
				chatKey: chatId,
				chatId,
				messageId,
				userId: String(senderId),
				userName: String(senderId),
				text: '',
				isGroup,
				accessDenied: true,
			});
			return;
		}

		let text = '';
		const images: Array<{data: string; mimeType: string}> = [];
		const files: string[] = [];
		const client = ensureApi(config);
		const messageType = String(message.message_type ?? 'text');

		const parseContent = (): any => {
			try {
				return JSON.parse(String(message.content ?? '{}'));
			} catch {
				return {};
			}
		};

		const content = parseContent();
		const collectAttachment = async (
			fileKey: string,
			fileName: string,
			asImage: boolean,
		): Promise<void> => {
			if (!fileKey) {
				return;
			}
			const result = await saveAttachment(
				client,
				config,
				messageId,
				fileKey,
				fileName,
				asImage,
			);
			if (result.image) {
				images.push(result.image);
			} else if (result.file) {
				files.push(result.file);
			} else if (result.error) {
				text += `\n[附件下载失败：${result.error}]`;
				await options.log('warn', `飞书附件下载失败：${result.error}`);
			}
		};

		if (messageType === 'text') {
			text = String(content.text ?? '');
			text = stripMentions(text, mentions);
		} else if (messageType === 'image') {
			await collectAttachment(
				String(content.image_key ?? ''),
				'image.jpg',
				true,
			);
		} else if (messageType === 'file') {
			await collectAttachment(
				String(content.file_key ?? ''),
				String(content.file_name ?? 'file'),
				false,
			);
		} else if (messageType === 'audio' || messageType === 'media') {
			await collectAttachment(
				String(content.file_key ?? ''),
				String(content.file_name ?? 'media'),
				false,
			);
		} else if (messageType === 'post') {
			const blocks = Array.isArray(content.content) ? content.content : [];
			const lines: string[] = [];
			if (content.title) {
				lines.push(String(content.title));
			}
			for (const paragraph of blocks) {
				if (!Array.isArray(paragraph)) {
					continue;
				}
				const parts: string[] = [];
				for (const node of paragraph) {
					if (node?.tag === 'text') {
						parts.push(String(node.text ?? ''));
					} else if (node?.tag === 'a') {
						parts.push(String(node.text ?? ''));
					} else if (node?.tag === 'img' || node?.tag === 'media') {
						await collectAttachment(
							String(node.image_key ?? node.file_key ?? ''),
							String(node.file_name ?? 'image.jpg'),
							node.tag === 'img',
						);
					}
				}
				const line = parts.join('').trim();
				if (line) {
					lines.push(line);
				}
			}
			text = stripMentions(lines.join('\n'), mentions);
		}

		if (!text && images.length === 0 && files.length === 0) {
			return;
		}

		await options
			.patchState({lastMessageAt: Date.now()})
			.catch(() => undefined);
		await options.bumpStat('received').catch(() => undefined);

		await options.onIncoming({
			channel: 'feishu',
			chatKey: chatId,
			chatId,
			messageId,
			userId: String(senderId),
			userName: String(senderId),
			text,
			isGroup,
			replyToMessageId: messageId,
			images: images.length > 0 ? images : undefined,
			files: files.filter(Boolean),
			accessDenied,
		});
	};

	const start = async (): Promise<void> => {
		const config = options.getConfig();
		if (!config.enabled) {
			running = false;
			connection?.stop();
			connection = null;
			await options.patchState({status: 'disabled', detail: '渠道已停用'});
			return;
		}
		if (!config.appId || !config.appSecret) {
			running = false;
			connection?.stop();
			connection = null;
			await options.patchState({
				status: 'idle',
				detail: '尚未配置 App ID / App Secret',
			});
			return;
		}

		const nextFingerprint = `${config.domain}|${
			config.appId
		}|${config.appSecret.slice(-8)}`;
		if (running && nextFingerprint === fingerprint) {
			return;
		}

		running = true;
		fingerprint = nextFingerprint;
		connection?.stop();
		const client = ensureApi(config);
		client.resetToken();

		connection = createFeishuConnection({
			domain: config.domain,
			log: message => {
				void options.log('info', message);
			},
			onEvent: handleEvent,
			onStatus: ({status, detail}) => {
				void options.patchState({
					status,
					detail: detail ?? '',
					...(status === 'online' ? {connectedAt: Date.now()} : {}),
				});
			},
		});

		await options.patchState({
			status: 'connecting',
			account: config.appId,
			detail: '正在建立飞书长连接',
		});
		await options.log('info', `正在建立飞书长连接（App ID: ${config.appId}）`);
		await connection.start({appId: config.appId, appSecret: config.appSecret});
	};

	const stop = (): void => {
		running = false;
		connection?.stop();
		connection = null;
		fingerprint = '';
	};

	const restart = async (): Promise<void> => {
		stop();
		await start();
	};

	const sendText = async (chatKey: string, text: string): Promise<void> => {
		const config = options.getConfig();
		if (!config.appId || !config.appSecret) {
			throw new Error('尚未配置飞书 App ID / App Secret');
		}
		const client = ensureApi(config);
		await client.sendText(config.appId, config.appSecret, chatKey, text);
	};

	return {
		start,
		stop,
		restart,
		sendText,
		isRunning: () => running,
	};
}
