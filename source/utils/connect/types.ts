/**
 * IM Connect（/connect）共享类型。
 *
 * 连接配置、运行状态与聊天绑定都保存在 ~/.snow 下的独立 JSON 文件里：
 * - connect.json        配置与凭据（文件权限 600）
 * - connect-state.json  面板展示的状态、统计与最近日志
 * - connect-runtime.json 持久化的聊天绑定与轮询游标
 */

export type ConnectChannelId = 'telegram' | 'feishu';

export type ConnectStatus =
	| 'disabled'
	| 'idle'
	| 'connecting'
	| 'online'
	| 'reconnecting'
	| 'error';

export type ConnectPushMode = 'final' | 'stream';

export interface TelegramConnectConfig {
	/** 是否启用 Telegram 渠道。 */
	enabled: boolean;
	/** BotFather 提供的 Bot Token；仅保存在本机，面板默认脱敏。 */
	token: string;
	/** Bot API 根地址，自建 Local Bot API Server 时可改。 */
	baseUrl: string;
	/** 允许所有私聊用户；关闭时仅允许 allowedUserIds。 */
	allowAllDirect: boolean;
	/** 私聊白名单（Telegram user id）。 */
	allowedUserIds: string[];
	/** 群组/话题里必须 @机器人 或回复机器人才响应。 */
	groupRequireMention: boolean;
	/** 把工具授权与提问转发到 IM；关闭时自动批准。 */
	forwardApprovals: boolean;
}

export interface FeishuConnectConfig {
	/** 是否启用飞书渠道。 */
	enabled: boolean;
	/** 企业自建应用 App ID。 */
	appId: string;
	/** 企业自建应用 App Secret；仅保存在本机，面板默认脱敏。 */
	appSecret: string;
	/** 飞书开放平台域名。 */
	domain: string;
	/** 允许所有私聊用户；关闭时仅允许 allowedOpenIds。 */
	allowAllDirect: boolean;
	/** 私聊白名单（飞书 open_id）。 */
	allowedOpenIds: string[];
	/** 群聊里必须 @机器人 才响应（受应用权限影响）。 */
	groupRequireMention: boolean;
	/** 把工具授权与提问转发到飞书；关闭时自动批准。 */
	forwardApprovals: boolean;
}

export interface ConnectConfig {
	/** IM 驱动的会话固定落在这个工作目录。空字符串表示使用启动 CLI 时的当前目录。 */
	workingDirectory: string;
	/** stream 会在回合过程中持续更新占位消息；final 只在回合结束时发送。 */
	pushMode: ConnectPushMode;
	telegram: TelegramConnectConfig;
	feishu: FeishuConnectConfig;
}

export interface ConnectChannelStats {
	received: number;
	delivered: number;
	denied: number;
	errors: number;
}

export interface ConnectChannelState {
	status: ConnectStatus;
	detail: string;
	/** Bot 用户名 / 飞书应用 ID 等可展示身份。 */
	account: string;
	/** 最近一次成功建立连接的本地时间戳。 */
	connectedAt: number;
	/** 最近一次收到消息的本地时间戳。 */
	lastMessageAt: number;
	stats: ConnectChannelStats;
}

export type ConnectChannelStatePatch = Omit<
	Partial<ConnectChannelState>,
	'stats'
> & {
	stats?: Partial<ConnectChannelStats>;
};

export interface ConnectLogEntry {
	at: number;
	channel: ConnectChannelId | 'system';
	level: 'info' | 'warn' | 'error';
	text: string;
}

export interface ConnectState {
	telegram: ConnectChannelState;
	feishu: ConnectChannelState;
	updatedAt: number;
	logs: ConnectLogEntry[];
}

export interface ConnectBinding {
	sessionId: string;
	title: string;
	updatedAt: number;
}

export interface ConnectRuntime {
	bindings: Record<string, ConnectBinding>;
	telegramCursor: {
		offset: number;
		botId: number;
	};
	feishuCursor: {
		eventId: string;
	};
}

export interface ConnectSnapshot {
	config: ConnectConfig;
	state: ConnectState;
	runtime: ConnectRuntime;
}

/** 渠道无关的入站消息。 */
export interface ConnectIncomingMessage {
	channel: ConnectChannelId;
	/** 绑定键：telegram 为 `<chatId>:<threadId>`，飞书为 chat_id。 */
	chatKey: string;
	chatId: string;
	messageId: string;
	userId: string;
	userName: string;
	text: string;
	isGroup: boolean;
	/** 回复消息时是否需要引用来源。 */
	replyToMessageId?: string;
	/** 待交给会话的图片（data URL / base64 由 worker 再处理）。 */
	images?: Array<{data: string; mimeType: string}>;
	/** 已落盘的附件绝对路径。 */
	files?: string[];
	/** 当前用户不在白名单或群聊未 @机器人，由路由层决定是否回复。 */
	accessDenied?: boolean;
}

export const CONNECT_WORKER_MARKER = '@@SNOW_CONNECT@@';

export type ConnectWorkerEvent =
	| {type: 'session'; sessionId: string; title: string}
	| {type: 'delta'; text: string}
	| {type: 'tool'; name: string; status: 'start' | 'done'}
	| {
			type: 'approval';
			id: string;
			toolName: string;
			arguments: string;
	  }
	| {
			type: 'question';
			id: string;
			question: string;
			options: string[];
			multiSelect: boolean;
	  }
	| {type: 'done'; text: string; sessionId: string}
	| {type: 'error'; message: string};

export type ConnectWorkerResponse =
	| {type: 'approval'; id: string; decision: 'approve' | 'reject' | 'always'}
	| {type: 'question'; id: string; selected: string[]; customInput?: string};

export const DEFAULT_TELEGRAM_CONFIG: TelegramConnectConfig = {
	enabled: false,
	token: '',
	baseUrl: 'https://api.telegram.org',
	allowAllDirect: false,
	allowedUserIds: [],
	groupRequireMention: true,
	forwardApprovals: true,
};

export const DEFAULT_FEISHU_CONFIG: FeishuConnectConfig = {
	enabled: false,
	appId: '',
	appSecret: '',
	domain: 'https://open.feishu.cn',
	allowAllDirect: false,
	allowedOpenIds: [],
	groupRequireMention: true,
	forwardApprovals: true,
};

export function createDefaultState(): ConnectState {
	const channel = (): ConnectChannelState => ({
		status: 'disabled',
		detail: '',
		account: '',
		connectedAt: 0,
		lastMessageAt: 0,
		stats: {received: 0, delivered: 0, denied: 0, errors: 0},
	});

	return {
		telegram: channel(),
		feishu: channel(),
		updatedAt: Date.now(),
		logs: [],
	};
}

export function createDefaultRuntime(): ConnectRuntime {
	return {
		bindings: {},
		telegramCursor: {offset: 0, botId: 0},
		feishuCursor: {eventId: ''},
	};
}

export function createDefaultConfig(workingDirectory: string): ConnectConfig {
	return {
		workingDirectory,
		pushMode: 'final',
		telegram: {...DEFAULT_TELEGRAM_CONFIG},
		feishu: {...DEFAULT_FEISHU_CONFIG},
	};
}
