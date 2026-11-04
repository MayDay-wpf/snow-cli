import {createFeishuChannel, type FeishuChannel} from './feishuChannel.js';
import {createConnectRouter, type ConnectAdapter} from './router.js';
import {
	appendConnectLog,
	clearConnectLogs,
	getConnectSnapshot,
	loadConnectConfig,
	loadConnectRuntime,
	loadConnectState,
	patchConnectState,
	saveConnectConfig,
	updateTelegramCursor,
} from './store.js';
import {
	createTelegramChannel,
	type TelegramChannel,
} from './telegramChannel.js';
import type {
	ConnectChannelId,
	ConnectChannelState,
	ConnectChannelStatePatch,
	ConnectConfig,
	ConnectPushMode,
	ConnectRuntime,
	ConnectSnapshot,
	ConnectState,
} from './types.js';
const CONFIG_POLL_MS = 2000;
type ChannelPatch = ConnectChannelStatePatch;

class ConnectService {
	private started = false;
	private starting: Promise<void> | null = null;
	private config: ConnectConfig | null = null;
	private state: ConnectState | null = null;
	private runtime: ConnectRuntime | null = null;
	private timer: NodeJS.Timeout | null = null;
	private telegram: TelegramChannel | null = null;
	private feishu: FeishuChannel | null = null;
	private stopRouters: Array<() => void> = [];
	private lastConfigKey = '';

	async start(): Promise<void> {
		if (this.started) {
			return;
		}
		if (this.starting) {
			return this.starting;
		}
		this.starting = this.doStart();
		try {
			await this.starting;
		} catch (error) {
			// 初始化失败时允许下次重新尝试，而不是永久停在“已启动”状态。
			this.started = false;
			this.telegram = null;
			this.feishu = null;
			throw error;
		} finally {
			this.starting = null;
		}
	}

	private async doStart(): Promise<void> {
		this.started = true;
		this.config = await loadConnectConfig();
		this.state = await loadConnectState();
		this.runtime = await loadConnectRuntime();
		this.lastConfigKey = JSON.stringify(this.config);

		let telegramRouter: ReturnType<typeof createConnectRouter> | null = null;
		let feishuRouter: ReturnType<typeof createConnectRouter> | null = null;

		const telegramAdapter: ConnectAdapter = {
			channel: 'telegram',
			sendText: async (chatKey, text, replyToMessageId) => {
				await this.telegram?.sendText(chatKey, text, replyToMessageId);
			},
			sendTyping: async chatKey => {
				await this.telegram?.sendTyping(chatKey);
			},
			createStream: async (chatKey, _replyToMessageId) => {
				if (!this.telegram) {
					throw new Error('Telegram 渠道尚未初始化');
				}
				return this.telegram.createStream(chatKey) as Promise<{
					update: (text: string) => Promise<void>;
					finish: (text: string) => Promise<void>;
				}>;
			},
		};

		const feishuAdapter: ConnectAdapter = {
			channel: 'feishu',
			sendText: async (chatKey, text) => {
				await this.feishu?.sendText(chatKey, text);
			},
		};

		telegramRouter = createConnectRouter({
			adapter: telegramAdapter,
			getForwardApprovals: () => this.config?.telegram.forwardApprovals ?? true,
			getPushMode: (): ConnectPushMode => this.config?.pushMode ?? 'final',
			getWorkingDirectory: () => this.getWorkingDirectory(),
			patchState: patch => this.patchChannel('telegram', patch),
			bumpStat: name => this.bumpStat('telegram', name),
			log: (level, text) => this.log('telegram', level, text),
		});

		feishuRouter = createConnectRouter({
			adapter: feishuAdapter,
			getForwardApprovals: () => this.config?.feishu.forwardApprovals ?? true,
			getPushMode: (): ConnectPushMode => 'final',
			getWorkingDirectory: () => this.getWorkingDirectory(),
			patchState: patch => this.patchChannel('feishu', patch),
			bumpStat: name => this.bumpStat('feishu', name),
			log: (level, text) => this.log('feishu', level, text),
		});

		const telegramRouterRef = telegramRouter;
		const feishuRouterRef = feishuRouter;

		this.telegram = createTelegramChannel({
			getConfig: () =>
				this.config?.telegram ?? {
					enabled: false,
					token: '',
					baseUrl: 'https://api.telegram.org',
					allowAllDirect: false,
					allowedUserIds: [],
					groupRequireMention: true,
					forwardApprovals: true,
				},
			getCursor: () => this.runtime?.telegramCursor ?? {offset: 0, botId: 0},
			saveCursor: async (offset, botId) => {
				if (this.runtime) {
					this.runtime.telegramCursor = {offset, botId};
				}
				await updateTelegramCursor(offset, botId);
			},
			onIncoming: message => telegramRouterRef.handleIncoming(message),
			patchState: patch => this.patchChannel('telegram', patch),
			bumpStat: name => this.bumpStat('telegram', name),
			log: (level, text) => this.log('telegram', level, text),
		});

		this.feishu = createFeishuChannel({
			getConfig: () =>
				this.config?.feishu ?? {
					enabled: false,
					appId: '',
					appSecret: '',
					domain: 'https://open.feishu.cn',
					allowAllDirect: false,
					allowedOpenIds: [],
					groupRequireMention: true,
					forwardApprovals: true,
				},
			onIncoming: message => feishuRouterRef.handleIncoming(message),
			patchState: patch => this.patchChannel('feishu', patch),
			bumpStat: name => this.bumpStat('feishu', name),
			log: (level, text) => this.log('feishu', level, text),
		});

		this.stopRouters = [
			() => telegramRouter?.stop(),
			() => feishuRouter?.stop(),
		];

		await this.applyConfig();
		this.timer = setInterval(() => {
			void this.reloadConfigIfChanged();
		}, CONFIG_POLL_MS);
		this.timer.unref?.();
	}

	private getWorkingDirectory(): string {
		return this.config?.workingDirectory?.trim() || process.cwd();
	}

	private async reloadConfigIfChanged(): Promise<void> {
		try {
			const config = await loadConnectConfig();
			const key = JSON.stringify(config);
			if (key !== this.lastConfigKey) {
				this.lastConfigKey = key;
				this.config = config;
				await appendConnectLog(
					'system',
					'info',
					'检测到 /connect 配置变更，正在热更新渠道',
				);
				await this.applyConfig();
			}
		} catch {
			// 配置读取失败时保持现状，下一轮继续尝试。
		}
	}

	private async applyConfig(): Promise<void> {
		if (!this.config) {
			this.config = await loadConnectConfig();
		}
		await this.telegram?.start();
		await this.feishu?.start();
	}

	async refreshNow(): Promise<void> {
		this.config = await loadConnectConfig();
		this.lastConfigKey = JSON.stringify(this.config);
		await this.applyConfig();
	}

	async stop(): Promise<void> {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.telegram?.stop();
		this.feishu?.stop();
		for (const stop of this.stopRouters) {
			stop();
		}
		this.stopRouters = [];
		this.telegram = null;
		this.feishu = null;
		this.started = false;
	}

	async restart(): Promise<void> {
		await this.stop();
		await this.start();
	}

	async getSnapshot(): Promise<ConnectSnapshot> {
		const snapshot = await getConnectSnapshot();
		this.config = snapshot.config;
		this.state = snapshot.state;
		this.runtime = snapshot.runtime;
		return snapshot;
	}

	async saveConfig(config: ConnectConfig): Promise<void> {
		await saveConnectConfig(config);
		this.config = config;
		this.lastConfigKey = JSON.stringify(config);
		await this.applyConfig();
	}

	async patchChannel(
		channel: ConnectChannelId,
		patch: ChannelPatch,
	): Promise<void> {
		const next = await patchConnectState(channel, patch);
		this.state = next;
	}

	async bumpStat(
		channel: ConnectChannelId,
		name: keyof ConnectChannelState['stats'],
	): Promise<void> {
		const current = this.state?.[channel]?.stats?.[name] ?? 0;
		const stats: Partial<ConnectChannelState['stats']> = {};
		stats[name] = current + 1;
		await this.patchChannel(channel, {stats});
	}

	async log(
		channel: ConnectChannelId,
		level: 'info' | 'warn' | 'error',
		text: string,
	): Promise<void> {
		await appendConnectLog(channel, level, text);
	}

	async clearLogs(): Promise<void> {
		await clearConnectLogs();
	}

	isStarted(): boolean {
		return this.started;
	}
}

export const connectService = new ConnectService();
