import * as vscode from 'vscode';
import {ShellType} from './ptyManager';
import {
	SidebarTerminalSession,
	SidebarTerminalTabState,
} from './sidebarTerminalSession';
import {startupCommandManager} from './startupCommandManager';
import {formatTerminalPathPayload} from './terminalPathFormatter';

type LaunchPolicy = 'ensure' | 'restart';
type Trigger =
	| 'viewReady'
	| 'viewRecreate'
	| 'openOrFocus'
	| 'manualRestart'
	| 'visibility'
	| 'configChange';

type LifecycleAction = {
	trigger: Trigger;
	policy: LaunchPolicy;
	focus: boolean;
	requestWebviewFocus: boolean;
	resetFrontend: boolean;
	suppressExitBanner: boolean;
};
type LifecycleActionTemplate = Omit<LifecycleAction, 'trigger'>;
type EnsureOptions = {focus?: boolean};
type RestartOptions = {
	reason?: 'manualRestart' | 'configChange';
	resetFrontend?: boolean;
};
type ReloadFrontendOptions = {focusAfterReady?: boolean};

type OutputLogLevel = 'debug' | 'info' | 'warn' | 'error';
type LogScope = 'SidebarTerminal' | 'Frontend';
type FrontendLogMessage = {
	type: 'frontendLog';
	level: OutputLogLevel;
	message: string;
	details?: string;
};

type TerminalConfig = {
	shellType: ShellType;
	fontFamily: string;
	fontSize: number;
	fontWeight: string;
	lineHeight: number;
};

type NormalizedFontConfig = Omit<TerminalConfig, 'shellType'>;

type RendererHealthStage =
	| 'degraded'
	| 'webgl-retry-scheduled'
	| 'webgl-restored'
	| 'escalation-requested';

type RendererHealthStats = {
	activeRendererMode?: string;
	sinceLastRenderMs?: number;
	sinceLastOutputMs?: number;
	sinceLastWriteParsedMs?: number;
	sinceLastWriteCallbackMs?: number;
	rendererRecoveryCycleId?: number;
	rendererRecoveryAttemptId?: number;
	rendererHealthSuspendedForMs?: number;
	lastWebglFailureReason?: string;
	scheduledRecoveryDelayMs?: number;
};

type RendererHealthStatField = {
	key: keyof RendererHealthStats;
	valueType: 'string' | 'number';
	detailLabel: string;
};

const RENDERER_HEALTH_STAT_FIELDS: readonly RendererHealthStatField[] = [
	{key: 'activeRendererMode', valueType: 'string', detailLabel: 'mode'},
	{key: 'rendererRecoveryCycleId', valueType: 'number', detailLabel: 'cycle'},
	{key: 'rendererRecoveryAttemptId', valueType: 'number', detailLabel: 'attempt'},
	{key: 'sinceLastRenderMs', valueType: 'number', detailLabel: 'sinceRenderMs'},
	{key: 'sinceLastOutputMs', valueType: 'number', detailLabel: 'sinceOutputMs'},
	{key: 'sinceLastWriteParsedMs', valueType: 'number', detailLabel: 'sinceWriteParsedMs'},
	{key: 'sinceLastWriteCallbackMs', valueType: 'number', detailLabel: 'sinceWriteCbMs'},
	{key: 'rendererHealthSuspendedForMs', valueType: 'number', detailLabel: 'suspendedMs'},
	{key: 'scheduledRecoveryDelayMs', valueType: 'number', detailLabel: 'retryDelayMs'},
	{key: 'lastWebglFailureReason', valueType: 'string', detailLabel: 'lastFailure'},
];

type ExtensionToWebviewMessage =
	| {type: 'output'; tabId: string; data: string}
	| {type: 'clear'; tabId?: string}
	| {type: 'fit'}
	| {type: 'focus'}
	| {type: 'syncTabs'; tabs: SidebarTerminalTabState[]}
	| {type: 'replaceTerminalContent'; tabId: string; data: string}
	| {
			type: 'updateFont';
			fontFamily: string;
			fontSize: number;
			fontWeight: string;
			lineHeight: number;
	  }
	| {type: 'exit'; tabId: string; code: number};

type WebviewToExtensionMessage =
	| {type: 'ready'}
	| {type: 'input'; data: string}
	| {type: 'resize'; cols: number; rows: number}
	| {type: 'switchTab'; tabId: string}
	| {type: 'closeTab'; tabId: string}
	| {type: 'dropPaths'; uris: string[]}
	| {
			type: 'rendererHealth';
			stage: RendererHealthStage;
			reason?: string;
			stats?: RendererHealthStats;
	  }
	| FrontendLogMessage;

const RESOURCE_ROOT_SEGMENTS: readonly (readonly string[])[] = [
	['res'],
	['node_modules', '@xterm'],
];

const XTERM_SCRIPT_SEGMENTS: readonly (readonly string[])[] = [
	['node_modules', '@xterm', 'xterm', 'lib', 'xterm.js'],
	['node_modules', '@xterm', 'addon-fit', 'lib', 'addon-fit.js'],
	['node_modules', '@xterm', 'addon-web-links', 'lib', 'addon-web-links.js'],
	['node_modules', '@xterm', 'addon-webgl', 'lib', 'addon-webgl.js'],
	['node_modules', '@xterm', 'addon-unicode11', 'lib', 'addon-unicode11.js'],
];

const XTERM_CSS_SEGMENTS = [
	'node_modules',
	'@xterm',
	'xterm',
	'css',
	'xterm.css',
] as const;
const SIDEBAR_STYLE_SEGMENTS = ['res', 'sidebarTerminal.css'] as const;
const SIDEBAR_SCRIPT_SEGMENTS = ['res', 'sidebarTerminal.js'] as const;

const OUTPUT_BUFFER_MAX_BYTES = 2 * 1024 * 1024;
const OUTPUT_TRUNCATION_NOTICE =
	'\r\n[Output truncated while terminal view was unavailable]\r\n';
const FOCUS_RETRY_DELAYS_MS = [0, 80, 240] as const;

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 32;
const LINE_HEIGHT_MIN = 0.8;
const LINE_HEIGHT_MAX = 2.0;

const OUTPUT_CHANNEL_NAME = 'Snow CLI';
const SIDEBAR_LOG_SCOPE: LogScope = 'SidebarTerminal';
const FRONTEND_LOG_SCOPE: LogScope = 'Frontend';
const INVALID_MESSAGE_LOG_THROTTLE_MS = 5000;
const RESTART_SETTLE_DELAY_MS = 150;
const RESTART_FRONTEND_FALLBACK_MS = 3000;
const MANUAL_RESTART_DEBOUNCE_MS = 1500;
const MAX_SIDEBAR_TERMINAL_TABS = 5;

const SHOW_RENDERER_TEST_CONTROLS = false;

const DEFAULT_ACTION: LifecycleActionTemplate = {
	policy: 'ensure',
	focus: false,
	requestWebviewFocus: false,
	resetFrontend: false,
	suppressExitBanner: false,
};

const TRIGGER_ACTIONS: Record<Trigger, LifecycleActionTemplate> = {
	viewReady: {
		...DEFAULT_ACTION,
	},
	visibility: {
		...DEFAULT_ACTION,
		requestWebviewFocus: true,
	},
	openOrFocus: {
		...DEFAULT_ACTION,
		focus: true,
		requestWebviewFocus: true,
	},
	manualRestart: {
		policy: 'restart',
		focus: false,
		requestWebviewFocus: true,
		resetFrontend: false,
		suppressExitBanner: true,
	},
	viewRecreate: {
		policy: 'restart',
		focus: false,
		requestWebviewFocus: false,
		resetFrontend: false,
		suppressExitBanner: true,
	},
	configChange: {
		policy: 'restart',
		focus: false,
		requestWebviewFocus: false,
		resetFrontend: true,
		suppressExitBanner: false,
	},
};


function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function asOptionalNonEmptyString(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const normalized = value.trim();
	return normalized ? normalized : undefined;
}

function normalizeFrontendLogLevel(value: unknown): OutputLogLevel {
	switch (value) {
		case 'debug':
		case 'info':
		case 'warn':
		case 'error':
			return value;
		default:
			return 'info';
	}
}

function summarizeForLog(value: string, maxLength = 160): string {
	const normalized = value.replace(/\s+/g, ' ').trim();
	return normalized.length > maxLength
		? `${normalized.slice(0, maxLength - 3)}...`
		: normalized;
}

function describeWebviewMessage(rawMessage: unknown): string {
	if (!isRecord(rawMessage)) {
		return `non-object:${typeof rawMessage}`;
	}

	const type = typeof rawMessage.type === 'string' ? rawMessage.type : 'unknown';
	const summary = [`type=${type}`];
	const message = asOptionalNonEmptyString(rawMessage.message);
	const data = asOptionalNonEmptyString(rawMessage.data);
	const reason = asOptionalNonEmptyString(rawMessage.reason);

	if (message) {
		summary.push(`message=${summarizeForLog(message)}`);
	} else if (data) {
		summary.push(`data=${summarizeForLog(data)}`);
	} else if (reason) {
		summary.push(`reason=${summarizeForLog(reason)}`);
	}

	return summary.join(', ');
}

function formatUnknownError(error: unknown): string {
	if (error instanceof Error) {
		return error.stack || error.message;
	}
	return typeof error === 'string' ? error : String(error);
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeRendererHealthStage(
	value: unknown,
): RendererHealthStage | undefined {
	switch (value) {
		case 'degraded':
		case 'webgl-retry-scheduled':
		case 'webgl-restored':
		case 'escalation-requested':
			return value;
		default:
			return undefined;
	}
}

function parseRendererHealthStatValue(
	value: unknown,
	valueType: RendererHealthStatField['valueType'],
): string | number | undefined {
	return valueType === 'string'
		? asOptionalNonEmptyString(value)
		: asOptionalFiniteNumber(value);
}

function parseRendererHealthStats(value: unknown): RendererHealthStats | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	const stats: RendererHealthStats = {};
	for (const field of RENDERER_HEALTH_STAT_FIELDS) {
		const parsedValue = parseRendererHealthStatValue(
			value[field.key],
			field.valueType,
		);
		if (typeof parsedValue !== 'undefined') {
			(stats as Record<string, unknown>)[field.key] = parsedValue;
		}
	}
	return Object.keys(stats).length > 0 ? stats : undefined;
}

function parseWebviewMessage(rawMessage: unknown): WebviewToExtensionMessage | undefined {
	if (!isRecord(rawMessage) || typeof rawMessage.type !== 'string') {
		return undefined;
	}

	switch (rawMessage.type) {
		case 'ready':
			return {type: 'ready'};
		case 'input':
			if (typeof rawMessage.data === 'string') {
				return {type: 'input', data: rawMessage.data};
			}
			return undefined;
		case 'resize':
			if (
				typeof rawMessage.cols === 'number' &&
				typeof rawMessage.rows === 'number' &&
				Number.isFinite(rawMessage.cols) &&
				Number.isFinite(rawMessage.rows)
			) {
				return {
					type: 'resize',
					cols: rawMessage.cols,
					rows: rawMessage.rows,
				};
			}
			return undefined;
		case 'switchTab': {
			const tabId = asOptionalNonEmptyString(rawMessage.tabId);
			if (!tabId) {
				return undefined;
			}
			return {type: 'switchTab', tabId};
		}
		case 'closeTab': {
			const tabId = asOptionalNonEmptyString(rawMessage.tabId);
			if (!tabId) {
				return undefined;
			}
			return {type: 'closeTab', tabId};
		}
		case 'rendererHealth': {
			const stage = normalizeRendererHealthStage(rawMessage.stage);
			if (!stage) {
				return undefined;
			}
			return {
				type: 'rendererHealth',
				stage,
				reason: asOptionalNonEmptyString(rawMessage.reason),
				stats: parseRendererHealthStats(rawMessage.stats),
			};
		}
		case 'dropPaths': {
			if (!Array.isArray(rawMessage.uris)) {
				return undefined;
			}
			const uris = (rawMessage.uris as unknown[]).filter(
				(uri): uri is string => typeof uri === 'string' && uri.length > 0,
			);
			if (uris.length === 0) {
				return undefined;
			}
			return {type: 'dropPaths', uris};
		}
		case 'frontendLog': {
			const message = asOptionalNonEmptyString(rawMessage.message);
			if (!message) {
				return undefined;
			}
			return {
				type: 'frontendLog',
				level: normalizeFrontendLogLevel(rawMessage.level),
				message,
				details: asOptionalNonEmptyString(rawMessage.details),
			};
		}
		default:
			return undefined;
	}
}

function mergeActions(
	base: LifecycleAction,
	incoming: LifecycleAction,
): LifecycleAction {
	const policy: LaunchPolicy =
		base.policy === 'restart' || incoming.policy === 'restart'
			? 'restart'
			: 'ensure';
	const trigger =
		incoming.policy === 'restart'
			? incoming.trigger
			: base.policy === 'restart'
				? base.trigger
				: incoming.trigger;

	return {
		trigger,
		policy,
		focus: base.focus || incoming.focus,
		requestWebviewFocus:
			base.requestWebviewFocus || incoming.requestWebviewFocus,
		resetFrontend: base.resetFrontend || incoming.resetFrontend,
		suppressExitBanner: base.suppressExitBanner || incoming.suppressExitBanner,
	};
}

class PendingLifecycleQueue {
	private pendingAction: LifecycleAction | undefined;

	public queue(action: LifecycleAction): void {
		this.pendingAction = this.pendingAction
			? mergeActions(this.pendingAction, action)
			: {...action};
	}

	public mergeWithPending(current: LifecycleAction): LifecycleAction {
		if (!this.pendingAction) {
			return current;
		}
		const merged = mergeActions(this.pendingAction, current);
		this.pendingAction = undefined;
		return merged;
	}

	public take(): LifecycleAction | undefined {
		const action = this.pendingAction;
		this.pendingAction = undefined;
		return action;
	}

	public clear(): void {
		this.pendingAction = undefined;
	}
}

export class SidebarTerminalProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'snowCliTerminal';

	private view?: vscode.WebviewView;
	private readonly outputChannel: vscode.OutputChannel;
	private readonly lifecycleQueue = new PendingLifecycleQueue();
	private readonly sessions = new Map<string, SidebarTerminalSession>();
	private sessionOrder: string[] = [];
	private activeSessionId: string | undefined;
	private sessionCounter = 0;
	private webviewReady = false;
	private hasResolvedViewOnce = false;
	private ensureRunningTimer: NodeJS.Timeout | undefined;
	private latestTerminalSize: {cols: number; rows: number} | undefined;
	private focusRetryTimers = new Set<NodeJS.Timeout>();
	private lastRendererStallNoticeAt = 0;
	private lastAutoRendererRecoveryAt = 0;
	private lastInvalidWebviewMessageLogAt = 0;
	private lastKnownRendererMode: string | undefined;
	private lastKnownRendererIssue: string | undefined;
	private webviewHtmlVersion = 0;
	private pendingFocusAfterFrontendReload = false;
	private restartInProgress = false;
	private restartCompletionTimer: NodeJS.Timeout | undefined;
	private lastManualRestartRequestedAt = 0;
	private disposed = false;

	constructor(private readonly extensionUri: vscode.Uri) {
		this.outputChannel = vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
		this.ensureActiveSessionExists();
		this.applyShellType();
		this.logSidebarInfo('Sidebar terminal provider initialized.');
	}

	private writeOutputLog(
		level: OutputLogLevel,
		scope: LogScope,
		message: string,
		details?: string,
	): void {
		if (this.disposed) {
			return;
		}

		this.outputChannel.appendLine(
			`[${new Date().toISOString()}] [${level.toUpperCase()}] [${scope}] ${message}`,
		);
		if (!details) {
			return;
		}
		for (const line of details.split(/\r?\n/)) {
			this.outputChannel.appendLine(line ? `  ${line}` : '  ');
		}
	}

	private logSidebar(
		level: OutputLogLevel,
		message: string,
		details?: string,
	): void {
		this.writeOutputLog(level, SIDEBAR_LOG_SCOPE, message, details);
	}

	private logSidebarInfo(message: string, details?: string): void {
		this.logSidebar('info', message, details);
	}

	private logSidebarWarn(message: string, details?: string): void {
		this.logSidebar('warn', message, details);
	}

	private logSidebarError(message: string, details?: string): void {
		this.logSidebar('error', message, details);
	}

	private logInvalidWebviewMessage(rawMessage: unknown): void {
		const now = Date.now();
		if (
			now - this.lastInvalidWebviewMessageLogAt <
			INVALID_MESSAGE_LOG_THROTTLE_MS
		) {
			return;
		}
		this.lastInvalidWebviewMessageLogAt = now;
		this.logSidebarWarn(
			'Ignored invalid webview message.',
			describeWebviewMessage(rawMessage),
		);
	}

	private getTerminalConfig(): TerminalConfig {
		const cfg = vscode.workspace.getConfiguration('snow-cli.terminal');
		return {
			shellType: cfg.get<ShellType>('shellType', 'auto'),
			fontFamily: cfg.get<string>('fontFamily', ''),
			fontSize: cfg.get<number>('fontSize', 14),
			fontWeight: cfg.get<string>('fontWeight', 'normal'),
			lineHeight: cfg.get<number>('lineHeight', 1.0),
		};
	}

	private normalizeFontConfig(config: TerminalConfig): NormalizedFontConfig {
		return {
			fontFamily: config.fontFamily || 'monospace',
			fontSize: clampNumber(config.fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX),
			fontWeight: config.fontWeight || 'normal',
			lineHeight: clampNumber(
				config.lineHeight,
				LINE_HEIGHT_MIN,
				LINE_HEIGHT_MAX,
			),
		};
	}

	private applyShellType(): void {
		const {shellType} = this.getTerminalConfig();
		for (const session of this.getOrderedSessions()) {
			session.setShellType(shellType);
		}
	}

	private sendFontConfig(): void {
		const normalized = this.normalizeFontConfig(this.getTerminalConfig());
		this.postWebviewMessage({type: 'updateFont', ...normalized});
	}

	private updateRendererRecoveryState(
		stage: RendererHealthStage,
		reason?: string,
		stats?: RendererHealthStats,
	): void {
		if (stats?.activeRendererMode) {
			this.lastKnownRendererMode = stats.activeRendererMode;
		}

		switch (stage) {
			case 'webgl-restored':
				this.lastKnownRendererMode = 'webgl';
				this.lastKnownRendererIssue = undefined;
				return;
			case 'degraded':
			case 'webgl-retry-scheduled':
			case 'escalation-requested':
				if (!this.lastKnownRendererMode) {
					this.lastKnownRendererMode = stats?.activeRendererMode ?? 'fallback';
				}
				this.lastKnownRendererIssue =
					stats?.lastWebglFailureReason ??
					reason ??
					(this.lastKnownRendererMode && this.lastKnownRendererMode !== 'webgl'
						? `${this.lastKnownRendererMode}-active`
						: 'renderer-recovery-pending');
				return;
		}
	}

	private getWorkspaceFolderForActiveEditor(): string | undefined {
		const editor = vscode.window.activeTextEditor;
		const folder = editor
			? vscode.workspace.getWorkspaceFolder(editor.document.uri)
			: undefined;
		return (
			folder?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
		);

	}

	public createTab(options?: EnsureOptions): void {
		const shouldFocus = options?.focus !== false;
		if (this.sessionOrder.length >= MAX_SIDEBAR_TERMINAL_TABS) {
			this.logSidebarInfo(
				'Ignored create tab request because sidebar terminal tab limit was reached.',
				`tabLimit=${MAX_SIDEBAR_TERMINAL_TABS}, existingTabs=${this.sessionOrder.length}`,
			);
			void vscode.window.showInformationMessage(
				`Snow CLI Sidebar Terminal supports up to ${MAX_SIDEBAR_TERMINAL_TABS} tabs.`,
			);
			if (shouldFocus) {
				void vscode.commands.executeCommand('snowCliTerminal.focus');
				this.syncActiveSessionToWebview({focus: true});
			}
			return;
		}
		const session = this.createSession();
		this.logSidebarInfo(
			'Created terminal tab.',
			`tabId=${session.id}, title=${session.title}`,
		);
		if (shouldFocus) {
			void vscode.commands.executeCommand('snowCliTerminal.focus');
		}
		this.ensureTerminalRunning(session.id);
		this.syncActiveSessionToWebview({focus: shouldFocus});
	}

	public closeActiveTab(options?: EnsureOptions): void {
		const activeSession = this.getActiveSession();
		if (!activeSession) {
			return;
		}
		this.closeSession(activeSession.id, {focus: options?.focus === true});
	}

	private createSession(): SidebarTerminalSession {
		const sessionIndex = ++this.sessionCounter;
		const session = new SidebarTerminalSession({
			id: `sidebar-terminal-tab-${sessionIndex}`,
			title: `Terminal ${sessionIndex}`,
			outputBufferMaxBytes: OUTPUT_BUFFER_MAX_BYTES,
			outputTruncationNotice: OUTPUT_TRUNCATION_NOTICE,
		});
		session.setShellType(this.getTerminalConfig().shellType);
		this.sessions.set(session.id, session);
		this.sessionOrder.push(session.id);
		this.activeSessionId = session.id;
		return session;
	}

	private getSessionById(
		sessionId: string | undefined,
	): SidebarTerminalSession | undefined {
		if (!sessionId) {
			return undefined;
		}
		return this.sessions.get(sessionId);
	}

	private getOrderedSessions(): SidebarTerminalSession[] {
		return this.sessionOrder
			.map(sessionId => this.sessions.get(sessionId))
			.filter(
				(session): session is SidebarTerminalSession =>
					typeof session !== 'undefined',
			);
	}

	private getActiveSession(): SidebarTerminalSession | undefined {
		return this.getSessionById(this.activeSessionId);
	}

	private ensureActiveSessionExists(): SidebarTerminalSession {
		const activeSession = this.getActiveSession();
		if (activeSession) {
			return activeSession;
		}
		return this.createSession();
	}

	private resizeAllRunningSessions(cols: number, rows: number): void {
		for (const session of this.getOrderedSessions()) {
			if (session.isRunning()) {
				session.resize(cols, rows);
			}
		}
	}

	private syncTabsToWebview(): void {
		if (!this.isWebviewOperational()) {
			return;
		}
		const activeSession = this.ensureActiveSessionExists();
		this.postWebviewMessage({
			type: 'syncTabs',
			tabs: this.getOrderedSessions().map(session =>
				session.toTabState(session.id === activeSession.id),
			),
		});
	}

	private syncActiveSessionToWebview(options?: {
		focus?: boolean;
		fit?: boolean;
	}): void {
		if (!this.isWebviewOperational()) {
			return;
		}
		const activeSession = this.ensureActiveSessionExists();
		this.syncTabsToWebview();
		this.postWebviewMessage({
			type: 'replaceTerminalContent',
			tabId: activeSession.id,
			data: activeSession.getTranscript(),
		});
		if (options?.fit !== false) {
			this.postWebviewMessage({type: 'fit'});
		}
		if (options?.focus) {
			this.requestWebviewFocus();
		}
	}

	private switchActiveSession(
		sessionId: string,
		options?: {focus?: boolean},
	): boolean {
		const nextSession = this.getSessionById(sessionId);
		if (!nextSession) {
			return false;
		}
		const didChange = this.activeSessionId !== nextSession.id;
		this.activeSessionId = nextSession.id;
		if (didChange) {
			this.logSidebarInfo(
				'Switched active terminal tab.',
				`tabId=${nextSession.id}, title=${nextSession.title}`,
			);
		}
		this.syncActiveSessionToWebview({focus: options?.focus === true});
		return true;
	}

	private closeSession(
		sessionId: string,
		options?: {focus?: boolean},
	): boolean {
		if (this.restartInProgress) {
			this.logSidebarInfo(
				'Ignored close tab request because a restart is already in progress.',
				`tabId=${sessionId}`,
			);
			return false;
		}
		const session = this.getSessionById(sessionId);
		if (!session) {
			return false;
		}

		const orderedSessions = this.getOrderedSessions();
		const sessionIndex = orderedSessions.findIndex(
			candidate => candidate.id === session.id,
		);
		const wasActive = session.id === this.activeSessionId;
		session.kill();
		this.sessions.delete(session.id);
		this.sessionOrder = this.sessionOrder.filter(id => id !== session.id);

		let nextActiveSession: SidebarTerminalSession | undefined;
		let createdReplacement = false;
		if (this.sessionOrder.length === 0) {
			nextActiveSession = this.createSession();
			createdReplacement = true;
		} else if (wasActive) {
			const fallbackIndex = Math.min(sessionIndex, this.sessionOrder.length - 1);
			nextActiveSession = this.getSessionById(this.sessionOrder[fallbackIndex]);
		} else {
			nextActiveSession = this.getActiveSession();
		}

		if (nextActiveSession) {
			this.activeSessionId = nextActiveSession.id;
		} else {
			this.activeSessionId = undefined;
		}

		this.logSidebarInfo(
			'Closed terminal tab.',
			`tabId=${session.id}, title=${session.title}, replacementTabId=${nextActiveSession?.id ?? 'none'}, remainingTabs=${this.sessionOrder.length}`,
		);

		if (createdReplacement && nextActiveSession) {
			this.ensureTerminalRunning(nextActiveSession.id);
		}

		if (wasActive) {
			this.syncActiveSessionToWebview({focus: options?.focus === true});
		} else {
			this.syncTabsToWebview();
		}
		return true;
	}

	public ensureTerminal(options?: EnsureOptions): void {
		this.ensureActiveSessionExists();
		this.runLifecycleAction('openOrFocus', options);
	}

	public restartTerminal(options?: RestartOptions): void {
		const reason = options?.reason ?? 'manualRestart';
		if (reason === 'manualRestart') {
			const now = Date.now();
			if (
				now - this.lastManualRestartRequestedAt <
				MANUAL_RESTART_DEBOUNCE_MS
			) {
				this.logSidebarInfo(
					'Ignored duplicate manual restart request inside debounce window.',
					`debounceMs=${MANUAL_RESTART_DEBOUNCE_MS}`,
				);
				return;
			}
			this.lastManualRestartRequestedAt = now;
			if (this.restartInProgress) {
				this.logSidebarInfo(
					'Ignored duplicate manual restart request because a restart is already in progress.',
				);
				return;
			}
		}

		const template = TRIGGER_ACTIONS[reason];
		const resetFrontend =
			typeof options?.resetFrontend === 'boolean'
				? options.resetFrontend
				: template.resetFrontend;
		if (reason === 'manualRestart' && resetFrontend) {
			this.logSidebarInfo(
				'Manual restart using explicit frontend reload override.',
			);
		}

		this.applyLifecycleAction({
			trigger: reason,
			...template,
			resetFrontend,
		});
	}

	public onViewReady(): void {
		this.webviewReady = true;
		this.logSidebarInfo(
			'Webview ready.',
			`htmlVersion=${this.webviewHtmlVersion}, pendingFocusAfterFrontendReload=${this.pendingFocusAfterFrontendReload}`,
		);
		this.finishRestart(false);
		this.runLifecycleAction('viewReady');
		this.sendFontConfig();
		this.syncActiveSessionToWebview({fit: true});
		if (this.pendingFocusAfterFrontendReload) {
			this.pendingFocusAfterFrontendReload = false;
			this.requestWebviewFocus();
		}
	}

	public onViewRecreate(): void {
		this.logSidebarInfo('Webview recreated; scheduling terminal restart.');
		this.runLifecycleAction('viewRecreate');
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		const isViewRecreate = this.hasResolvedViewOnce;
		this.hasResolvedViewOnce = true;
		this.view = webviewView;
		this.webviewReady = false;

		this.logSidebarInfo(
			isViewRecreate
				? 'Resolving recreated sidebar terminal view.'
				: 'Resolving sidebar terminal view.',
		);
		this.configureWebview(webviewView);
		this.registerWebviewEventHandlers(webviewView);
		if (isViewRecreate) {
			this.onViewRecreate();
		}
	}

	private configureWebview(webviewView: vscode.WebviewView): void {
		const htmlVersion = ++this.webviewHtmlVersion;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: RESOURCE_ROOT_SEGMENTS.map(segments =>
				this.getExtensionResourceUri(segments),
			),
		};
		webviewView.webview.html = this.getHtmlForWebview(
			webviewView.webview,
			htmlVersion,
		);
	}

	private registerWebviewEventHandlers(webviewView: vscode.WebviewView): void {
		webviewView.webview.onDidReceiveMessage(message => {
			this.handleMessage(message);
		});

		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) {
				this.scheduleEnsureRunning();
			}
		});

		webviewView.onDidDispose(() => {
			this.handleViewDisposed();
		});
	}

	private teardownRuntimeState(): void {
		this.clearEnsureRunningTimer();
		this.clearFocusRetryTimers();
		this.clearRestartCompletionTimer();
		this.restartInProgress = false;
		this.lifecycleQueue.clear();
		for (const session of this.getOrderedSessions()) {
			session.kill();
		}
	}

	private handleViewDisposed(): void {
		const hadView = Boolean(this.view);
		const wasReady = this.webviewReady;
		const runningSessionCount = this.getOrderedSessions().filter(session =>
			session.isRunning(),
		).length;
		if (hadView || wasReady || runningSessionCount > 0) {
			this.logSidebarInfo(
				'Webview disposed.',
				`hadView=${hadView}, wasReady=${wasReady}, runningSessions=${runningSessionCount}`,
			);
		}
		this.webviewReady = false;
		this.lastAutoRendererRecoveryAt = 0;
		this.lastKnownRendererMode = undefined;
		this.lastKnownRendererIssue = undefined;
		this.pendingFocusAfterFrontendReload = false;
		this.view = undefined;
		this.teardownRuntimeState();
	}

	private isWebviewOperational(): boolean {
		return Boolean(this.view && this.webviewReady);
	}

	private handleMessage(rawMessage: unknown): void {
		try {
			const message = parseWebviewMessage(rawMessage);
			if (!message) {
				this.logInvalidWebviewMessage(rawMessage);
				return;
			}

			switch (message.type) {
				case 'ready':
					this.onViewReady();
					return;
				case 'input':
					if (message.data) {
						this.writeInputToTerminal(message.data);
					}
					return;
				case 'resize': {
					const cols = Math.floor(message.cols);
					const rows = Math.floor(message.rows);
					if (cols <= 0 || rows <= 0) {
						return;
					}
					this.latestTerminalSize = {cols, rows};
					this.resizeAllRunningSessions(cols, rows);
					return;
				}
				case 'switchTab':
					if (!this.switchActiveSession(message.tabId, {focus: true})) {
						this.logSidebarWarn(
							'Ignored tab switch request for unknown terminal tab.',
							`tabId=${message.tabId}`,
						);
					}
					return;
				case 'closeTab':
					if (!this.closeSession(message.tabId, {focus: true})) {
						this.logSidebarWarn(
							'Ignored tab close request for unknown terminal tab.',
							`tabId=${message.tabId}`,
						);
					}
					return;
			case 'dropPaths':
				this.handleDropPaths(message.uris);
				return;
			case 'rendererHealth':
				this.handleRendererHealthMessage(
					message.stage,
					message.reason,
					message.stats,
				);
				return;
				case 'frontendLog':
					this.writeOutputLog(
						message.level,
						FRONTEND_LOG_SCOPE,
						message.message,
						message.details,
					);
					return;
			}
		} catch (error) {
			this.logSidebarError(
				'Failed to handle webview message.',
				formatUnknownError(error),
			);
		}
	}

	private handleRendererHealthMessage(
		stage: RendererHealthStage,
		reason?: string,
		stats?: RendererHealthStats,
	): void {
		const now = Date.now();
		const details: string[] = [];
		if (reason) {
			details.push(`reason=${reason}`);
		}
		if (stats) {
			for (const field of RENDERER_HEALTH_STAT_FIELDS) {
				const value = stats[field.key];
				if (typeof value === field.valueType) {
					details.push(`${field.detailLabel}=${value}`);
				}
			}
		}
		const detailText = details.length > 0 ? details.join(', ') : undefined;
		this.updateRendererRecoveryState(stage, reason, stats);
		switch (stage) {
			case 'degraded':
				this.logSidebarWarn(
					'Observed frontend WebGL degradation; monitoring local recovery.',
					detailText,
				);
				if (now - this.lastRendererStallNoticeAt >= 5000) {
					this.lastRendererStallNoticeAt = now;
					void vscode.window.setStatusBarMessage(
						`Snow CLI: WebGL renderer degraded${reason ? ` (${reason})` : ''}; retrying locally.`,
						3000,
					);
				}
				return;
			case 'webgl-retry-scheduled':
				if (
					(stats?.rendererRecoveryAttemptId ?? 0) > 1 ||
					(stats?.scheduledRecoveryDelayMs ?? 0) >= 2000
				) {
					this.logSidebarInfo(
						'Observed frontend WebGL recovery retry schedule.',
						detailText,
					);
				}
				return;
			case 'webgl-restored':
				this.logSidebarInfo(
					reason === 'initial-load'
						? 'WebGL renderer ready on initial load.'
						: 'WebGL renderer restored and ready.',
					detailText,
				);
				if (
					reason !== 'initial-load' &&
					now - this.lastRendererStallNoticeAt >= 3000
				) {
					this.lastRendererStallNoticeAt = now;
					void vscode.window.setStatusBarMessage(
						'Snow CLI: WebGL renderer restored.',
						3000,
					);
				}
				return;
			case 'escalation-requested':
				if (now - this.lastAutoRendererRecoveryAt < 10000) {
					if (now - this.lastRendererStallNoticeAt >= 3000) {
						this.lastRendererStallNoticeAt = now;
						this.logSidebarWarn('Renderer recovery throttled.', detailText);
						void vscode.window.setStatusBarMessage(
							`Snow CLI: renderer recovery throttled${reason ? ` (${reason})` : ''}. Use Restart Terminal if needed.`,
							3000,
						);
					}
					return;
				}
				this.lastAutoRendererRecoveryAt = now;
				this.logSidebarWarn(
					'Frontend requested WebGL recovery escalation; reloading terminal frontend.',
					detailText,
				);
				this.reloadWebviewFrontend({focusAfterReady: true});
				if (now - this.lastRendererStallNoticeAt >= 10000) {
					this.lastRendererStallNoticeAt = now;
					void vscode.window.setStatusBarMessage(
						`Snow CLI: reloading terminal renderer${reason ? ` (${reason})` : ''}.`,
						3000,
					);
				}
				return;
		}
	}

	private writeInputToTerminal(data: string): void {
		const activeSession = this.ensureActiveSessionExists();
		this.ensureTerminalRunning(activeSession.id);
		activeSession.write(data);
	}

	private startTerminal(sessionId?: string): void {
		const session = sessionId
			? this.getSessionById(sessionId)
			: this.ensureActiveSessionExists();
		if (!session) {
			return;
		}

		this.applyShellType();
		const workspaceFolder = this.getWorkspaceFolderForActiveEditor();
		const cwd = workspaceFolder || process.cwd();
		const sizeDetails = this.latestTerminalSize
			? `${this.latestTerminalSize.cols}x${this.latestTerminalSize.rows}`
			: 'auto';
		const {started, processNonce, startupCommand} = session.start(
			cwd,
			this.latestTerminalSize,
			{
				onData: data => {
					this.handleTerminalData(session.id, data);
				},
				onExit: event => {
					this.handleTerminalExit(
						session.id,
						event.code,
						event.processNonce,
						event.suppressed,
					);
				},
			},
			() => startupCommandManager.getNextStartupCommand(),
		);
		const commandDetails = startupCommand ?? '(none)';

		this.syncTabsToWebview();
		if (started) {
			this.logSidebarInfo(
				'Terminal started.',
				`tabId=${session.id}, process=${processNonce}, cwd=${cwd}, command=${commandDetails}, size=${sizeDetails}`,
			);
			return;
		}

		this.logSidebarError(
			'Terminal start request completed but process is not running.',
			`tabId=${session.id}, process=${processNonce}, cwd=${cwd}, command=${commandDetails}, size=${sizeDetails}`,
		);
	}

	private handleTerminalData(sessionId: string, data: string): void {
		const session = this.getSessionById(sessionId);
		if (!session || !data) {
			return;
		}
		session.appendOutput(data);
		if (session.id !== this.activeSessionId || !this.isWebviewOperational()) {
			return;
		}
		this.postWebviewMessage({type: 'output', tabId: session.id, data});
	}

	private handleTerminalExit(
		sessionId: string,
		code: number,
		processNonce: number,
		suppressed: boolean,
	): void {
		const session = this.getSessionById(sessionId);
		if (!session) {
			return;
		}
		if (suppressed) {
			this.logSidebarInfo(
				'Terminal exit suppressed after controlled restart.',
				`tabId=${sessionId}, process=${processNonce}, code=${code}`,
			);
			this.syncTabsToWebview();
			return;
		}

		session.appendExitBanner(code);
		this.syncTabsToWebview();
		if (session.id === this.activeSessionId && this.isWebviewOperational()) {
			this.postWebviewMessage({type: 'exit', tabId: session.id, code});
		}
		if (code === 0) {
			this.logSidebarInfo(
				'Terminal exited.',
				`tabId=${sessionId}, process=${processNonce}, code=${code}`,
			);
			return;
		}
		this.logSidebarWarn(
			'Terminal exited with non-zero code.',
			`tabId=${sessionId}, process=${processNonce}, code=${code}`,
		);
	}

	private scheduleEnsureRunning(): void {
		if (!this.isWebviewOperational()) {
			return;
		}

		this.clearEnsureRunningTimer();
		this.ensureRunningTimer = setTimeout(() => {
			this.ensureRunningTimer = undefined;
			this.runLifecycleAction('visibility');
		}, 50);
	}

	private clearEnsureRunningTimer(): void {
		this.ensureRunningTimer = this.clearTimer(this.ensureRunningTimer);
	}

	private clearRestartCompletionTimer(): void {
		this.restartCompletionTimer = this.clearTimer(this.restartCompletionTimer);
	}

	private clearTimer(timer: NodeJS.Timeout | undefined): undefined {
		if (timer) {
			clearTimeout(timer);
		}
		return undefined;
	}

	private scheduleRestartCompletion(delayMs: number): void {
		this.clearRestartCompletionTimer();
		this.restartCompletionTimer = setTimeout(() => {
			this.restartCompletionTimer = undefined;
			this.finishRestart();
		}, delayMs);
	}

	private clearRestartingSessionState(): void {
		let didChange = false;
		for (const session of this.getOrderedSessions()) {
			if (!session.isRestarting()) {
				continue;
			}
			session.setRestarting(false);
			didChange = true;
		}
		if (didChange && this.isWebviewOperational()) {
			this.syncTabsToWebview();
		}
	}

	private finishRestart(drainPending = true): void {
		this.clearRestartCompletionTimer();
		if (!this.restartInProgress) {
			return;
		}
		this.restartInProgress = false;
		this.clearRestartingSessionState();
		if (!drainPending || !this.isWebviewOperational()) {
			return;
		}
		const pendingAction = this.lifecycleQueue.take();
		if (pendingAction) {
			this.applyLifecycleAction(pendingAction);
		}
	}

	private ensureTerminalRunning(sessionId?: string): void {
		const session = sessionId
			? this.getSessionById(sessionId)
			: this.getActiveSession() ?? this.ensureActiveSessionExists();
		if (!session || session.isRunning()) {
			return;
		}
		this.startTerminal(session.id);
	}

	private runLifecycleAction(trigger: Trigger, options?: EnsureOptions): void {
		const template = TRIGGER_ACTIONS[trigger];
		const action: LifecycleAction = {
			trigger,
			...template,
			focus: options?.focus ?? template.focus,
		};
		this.applyLifecycleAction(action);
	}

	private applyLifecycleAction(action: LifecycleAction): void {
		if (this.restartInProgress) {
			this.lifecycleQueue.queue(action);
			return;
		}
		if (action.focus) {
			void vscode.commands.executeCommand('snowCliTerminal.focus');
		}

		if (!this.isWebviewOperational()) {
			this.lifecycleQueue.queue(action);
			return;
		}

		this.executeLifecycleAction(this.lifecycleQueue.mergeWithPending(action));
	}

	private executeLifecycleAction(action: LifecycleAction): void {
		if (action.policy === 'restart') {
			this.executeRestart(action);
		} else {
			this.ensureTerminalRunning();
		}

		if (action.requestWebviewFocus) {
			this.requestWebviewFocus();
		}
	}

	private executeRestart(action: LifecycleAction): void {
		const activeSession = this.ensureActiveSessionExists();
		this.restartInProgress = true;
		this.clearRestartCompletionTimer();
		this.clearEnsureRunningTimer();
		this.clearFocusRetryTimers();
		activeSession.setRestarting(true);
		this.logSidebarInfo(
			'Restarting terminal.',
			`tabId=${activeSession.id}, trigger=${action.trigger}, resetFrontend=${action.resetFrontend}, requestWebviewFocus=${action.requestWebviewFocus}, suppressExitBanner=${action.suppressExitBanner}`,
		);

		if (action.suppressExitBanner) {
			activeSession.suppressCurrentExitBanner();
		}

		activeSession.clearTranscript();
		activeSession.kill();
		this.syncTabsToWebview();
		if (action.resetFrontend) {
			this.reloadWebviewFrontend({
				focusAfterReady: action.requestWebviewFocus,
			});
		} else {
			this.postWebviewMessage({type: 'clear', tabId: activeSession.id});
		}
		this.startTerminal(activeSession.id);
		if (!action.resetFrontend) {
			this.sendFontConfig();
			this.postWebviewMessage({type: 'fit'});
		}
		this.scheduleRestartCompletion(
			action.resetFrontend
				? RESTART_FRONTEND_FALLBACK_MS
				: RESTART_SETTLE_DELAY_MS,
		);
	}

	private reloadWebviewFrontend(options?: ReloadFrontendOptions): void {
		if (!this.view) {
			this.logSidebarWarn(
				'Skipped webview frontend reload because no view is attached.',
			);
			return;
		}
		if (options?.focusAfterReady) {
			this.pendingFocusAfterFrontendReload = true;
		}
		this.webviewReady = false;
		this.logSidebarInfo(
			'Reloading webview frontend.',
			`focusAfterReady=${Boolean(options?.focusAfterReady)}, nextHtmlVersion=${this.webviewHtmlVersion + 1}`,
		);
		this.configureWebview(this.view);
	}

	private clearFocusRetryTimers(): void {
		if (this.focusRetryTimers.size === 0) {
			return;
		}
		for (const timer of this.focusRetryTimers) {
			clearTimeout(timer);
		}
		this.focusRetryTimers.clear();
	}

	private requestWebviewFocus(): void {
		this.clearFocusRetryTimers();
		if (!this.isWebviewOperational()) {
			return;
		}
		for (const delay of FOCUS_RETRY_DELAYS_MS) {
			const timer = setTimeout(() => {
				this.focusRetryTimers.delete(timer);
				if (!this.isWebviewOperational()) {
					return;
				}
				this.postWebviewMessage({type: 'focus'});
			}, delay);
			this.focusRetryTimers.add(timer);
		}
	}

	private postWebviewMessage(message: ExtensionToWebviewMessage): void {
		if (!this.view || !this.webviewReady) {
			return;
		}
		void this.view.webview.postMessage(message);
	}

	private getExtensionResourceUri(segments: readonly string[]): vscode.Uri {
		return vscode.Uri.joinPath(this.extensionUri, ...segments);
	}

	private getWebviewResourceUri(
		webview: vscode.Webview,
		segments: readonly string[],
	): vscode.Uri {
		return webview.asWebviewUri(this.getExtensionResourceUri(segments));
	}

	private getHtmlForWebview(
		webview: vscode.Webview,
		htmlVersion: number,
	): string {
		const cspSource = webview.cspSource;
		const xtermCssUri = this.getWebviewResourceUri(webview, XTERM_CSS_SEGMENTS);
		const sidebarCssUri = this.getWebviewResourceUri(
			webview,
			SIDEBAR_STYLE_SEGMENTS,
		);
		const sidebarScriptUri = this.getWebviewResourceUri(
			webview,
			SIDEBAR_SCRIPT_SEGMENTS,
		);
		const scriptTags = XTERM_SCRIPT_SEGMENTS.map(
			segments =>
				`<script src="${this.getWebviewResourceUri(webview, segments)}"></script>`,
		).join('\n  ');

		const rendererTestControls = SHOW_RENDERER_TEST_CONTROLS
			? `
    <div id="terminal-toolbar" aria-label="Renderer test controls">
      <button id="terminal-test-render-stall" type="button" title="Simulate a renderer stall recovery flow">
        Test render-stall
      </button>
      <button id="terminal-test-context-loss" type="button" title="Simulate a WebGL context loss recovery flow">
        Test context-loss
      </button>
    </div>`
			: '';

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <!-- webview-reload-version:${htmlVersion} -->
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource}; font-src ${cspSource};">
  <link rel="stylesheet" href="${xtermCssUri}">
  <link rel="stylesheet" href="${sidebarCssUri}">
</head>
<body>
  <div id="terminal-root">
    <div id="terminal-tab-strip" role="tablist" aria-label="Terminal tabs"></div>
    ${rendererTestControls}
    <div id="terminal-container"></div>
  </div>

  ${scriptTags}
  <script src="${sidebarScriptUri}"></script>
</body>
</html>`;
	}

	private handleDropPaths(uris: string[]): void {
		const paths = uris
			.map(uri => {
				try {
					return vscode.Uri.parse(uri).fsPath;
				} catch {
					return '';
				}
			})
			.filter(path => path.length > 0);

		if (paths.length === 0) {
			return;
		}

		this.logSidebarInfo(
			'Received file paths from drop.',
			`pathCount=${paths.length}`,
		);
		this.sendFilePaths(paths);
	}

	public sendFilePaths(paths: string[]): void {
		if (paths.length === 0) {
			return;
		}

		const {shellType} = this.getTerminalConfig();
		this.writeInputToTerminal(formatTerminalPathPayload(paths, {shellType}));
		if (this.isWebviewOperational()) {
			this.requestWebviewFocus();
			return;
		}

		this.logSidebarInfo(
			'Path payload written while webview is unavailable.',
			`pathCount=${paths.length}`,
		);
	}

	public dispose(): void {
		if (this.disposed) {
			return;
		}
		this.logSidebarInfo('Disposing sidebar terminal provider.');
		this.handleViewDisposed();
		this.disposed = true;
		this.outputChannel.dispose();
	}
}

