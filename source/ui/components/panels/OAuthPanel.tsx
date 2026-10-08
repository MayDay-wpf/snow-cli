import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import {setPickerActive} from '../../../utils/ui/pickerState.js';
import {
	OAUTH_PROVIDERS,
	OAUTH_PROVIDER_ORDER,
	activateOAuthProfile,
	cancelOAuthLogin,
	getOAuthLoginStatus,
	openExternalUrl,
	startOAuthLogin,
	submitOAuthCallback,
	type OAuthLoginOutcome,
	type OAuthLoginStartResult,
	type OAuthLoginStatusView,
	type OAuthProviderId,
} from '../../../utils/oauth/index.js';

type Props = {
	visible: boolean;
	onClose: () => void;
	/** 登录成功并按 Enter 启用（切换）档案后回调，用于刷新界面上的当前配置 */
	onActivated?: (profileName: string) => void;
};

type PanelMode = 'list' | 'connecting' | 'manual' | 'success' | 'error';

type OAuthPanelMessages = {
	title?: string;
	subtitle?: string;
	loading?: string;
	signInHint?: string;
	authUrlLabel?: string;
	openBrowserHint?: string;
	manualHint?: string;
	manualTitle?: string;
	manualInputHint?: string;
	waiting?: string;
	cancelHint?: string;
	successTitle?: string;
	accountLabel?: string;
	planLabel?: string;
	profileLabel?: string;
	modelsLabel?: string;
	applyHint?: string;
	appliedHint?: string;
	errorTitle?: string;
	retryHint?: string;
	escHint?: string;
	providerCodex?: string;
	providerAnthropic?: string;
	providerAntigravity?: string;
	providerXai?: string;
};

const DEFAULT_PROVIDER_LABELS: Record<OAuthProviderId, string> = {
	codex: 'ChatGPT Codex',
	anthropic: 'Anthropic (Claude)',
	antigravity: 'Antigravity (Google)',
	xai: 'xAI (Grok)',
};

const POLL_INTERVAL_MS = 1000;

export default function OAuthPanel({visible, onClose, onActivated}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const messages: OAuthPanelMessages = (t as any).oauthPanel ?? {};

	const providerLabel = useCallback(
		(provider: OAuthProviderId): string => {
			switch (provider) {
				case 'codex':
					return messages.providerCodex ?? DEFAULT_PROVIDER_LABELS.codex;
				case 'anthropic':
					return (
						messages.providerAnthropic ?? DEFAULT_PROVIDER_LABELS.anthropic
					);
				case 'antigravity':
					return (
						messages.providerAntigravity ?? DEFAULT_PROVIDER_LABELS.antigravity
					);
				case 'xai':
					return messages.providerXai ?? DEFAULT_PROVIDER_LABELS.xai;
			}
		},
		[messages],
	);

	const providers = useMemo(
		() =>
			OAUTH_PROVIDER_ORDER.map(id => ({
				id,
				label: providerLabel(id),
				description: OAUTH_PROVIDERS[id].description,
			})),
		[providerLabel],
	);

	const [mode, setMode] = useState<PanelMode>('list');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [session, setSession] = useState<OAuthLoginStartResult | null>(null);
	const [statusView, setStatusView] = useState<OAuthLoginStatusView | null>(
		null,
	);
	const [outcome, setOutcome] = useState<OAuthLoginOutcome | null>(null);
	const [errorMessage, setErrorMessage] = useState('');
	const [manualInput, setManualInput] = useState('');
	const [showCursor, setShowCursor] = useState(true);

	// 会话 id 的同步引用，避免轮询闭包丢失最新会话
	const sessionRef = useRef<OAuthLoginStartResult | null>(null);
	// 面板是否已卸载（异步回调后不再 setState）
	const unmountedRef = useRef(false);

	useEffect(() => {
		return () => {
			unmountedRef.current = true;
			// 面板被外部卸载时（如返回欢迎页），关闭本地回调端口避免残留监听
			const active = sessionRef.current;
			if (active) {
				cancelOAuthLogin(active.sessionId);
			}
		};
	}, []);

	// 打开面板时重置状态
	useEffect(() => {
		if (!visible) {
			return;
		}
		setMode('list');
		setSelectedIndex(0);
		setSession(null);
		sessionRef.current = null;
		setStatusView(null);
		setOutcome(null);
		setErrorMessage('');
		setManualInput('');
	}, [visible]);

	// 光标闪烁（手动输入模式）
	useEffect(() => {
		if (!visible || mode !== 'manual') {
			return undefined;
		}
		const timer = setInterval(() => setShowCursor(v => !v), 530);
		return () => clearInterval(timer);
	}, [visible, mode]);

	// 把登录状态映射为面板状态（轮询与手动提交共用）
	const applyStatusView = useCallback((view: OAuthLoginStatusView) => {
		setStatusView(view);
		if (view.status === 'success' && view.outcome) {
			setOutcome(view.outcome);
			setMode('success');
			return;
		}
		if (view.status === 'error') {
			setErrorMessage(view.error ?? 'Sign-in failed');
			setMode('error');
			return;
		}
		if (view.status === 'cancelled') {
			setMode('list');
			setSession(null);
			sessionRef.current = null;
		}
	}, []);

	// 登录中：轮询登录状态（手动粘贴模式下也持续轮询，防止本地回调先到）
	useEffect(() => {
		if (!visible || (mode !== 'connecting' && mode !== 'manual') || !session) {
			return undefined;
		}
		const timer = setInterval(() => {
			const active = sessionRef.current;
			if (!active) {
				return;
			}
			const view = getOAuthLoginStatus(active.sessionId);
			if (view) {
				applyStatusView(view);
			}
		}, POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [visible, mode, session, applyStatusView]);

	const closePanel = useCallback(() => {
		const active = sessionRef.current;
		if (active) {
			cancelOAuthLogin(active.sessionId);
		}
		setSession(null);
		sessionRef.current = null;
		setPickerActive(false);
		onClose();
	}, [onClose]);

	const beginLogin = useCallback(async (provider: OAuthProviderId) => {
		setErrorMessage('');
		setStatusView(null);
		setOutcome(null);
		setMode('connecting');
		try {
			const started = await startOAuthLogin(provider);
			if (unmountedRef.current) {
				cancelOAuthLogin(started.sessionId);
				return;
			}
			setSession(started);
			sessionRef.current = started;
			// 自动打开系统默认浏览器；失败或不方便时用户可复制链接
			openExternalUrl(started.authUrl);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error));
			setMode('error');
		}
	}, []);

	const handleManualSubmit = useCallback(async () => {
		const active = sessionRef.current;
		const input = manualInput.trim();
		if (!active || !input) {
			return;
		}
		const view = await submitOAuthCallback(active.sessionId, input);
		setManualInput('');
		if (!view) {
			setErrorMessage('Sign-in session expired');
			setMode('error');
			return;
		}
		applyStatusView(view);
		if (view.status === 'pending') {
			setMode('connecting');
		}
	}, [manualInput, applyStatusView]);

	const handleApply = useCallback(() => {
		if (!outcome) {
			return;
		}
		try {
			// 切换档案：落盘 + 清空运行期配置缓存，当前进程立即生效
			activateOAuthProfile(outcome.profileName);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : String(error));
			setMode('error');
			return;
		}
		// 通知父组件刷新界面上的"当前配置"，并立即回到会话页
		onActivated?.(outcome.profileName);
		closePanel();
	}, [outcome, onActivated, closePanel]);

	useInput(
		(input, key) => {
			if (mode === 'manual') {
				if (key.escape) {
					setManualInput('');
					setMode('connecting');
					return;
				}
				if (key.return) {
					void handleManualSubmit();
					return;
				}
				if (key.backspace || key.delete) {
					setManualInput(prev => prev.slice(0, -1));
					return;
				}
				if (input && !key.ctrl && !key.meta && !key.tab) {
					setManualInput(prev => prev + input);
				}
				return;
			}

			if (mode === 'list') {
				if (key.escape) {
					closePanel();
					return;
				}
				if (key.upArrow) {
					setSelectedIndex(prev =>
						prev === 0 ? providers.length - 1 : prev - 1,
					);
					return;
				}
				if (key.downArrow) {
					setSelectedIndex(prev =>
						prev === providers.length - 1 ? 0 : prev + 1,
					);
					return;
				}
				if (key.return) {
					const provider = providers[selectedIndex]?.id;
					if (provider) {
						void beginLogin(provider);
					}
				}
				return;
			}

			if (mode === 'connecting') {
				if (key.escape) {
					closePanel();
					return;
				}
				if (key.return) {
					// 立即检查一次状态，避免浏览器已完成而轮询尚未触发时按 Enter 无响应
					const active = sessionRef.current;
					if (active) {
						const view = getOAuthLoginStatus(active.sessionId);
						if (view) {
							applyStatusView(view);
						}
					}
					return;
				}
				if (input === 'o' || input === 'O') {
					const active = sessionRef.current;
					if (active) {
						openExternalUrl(active.authUrl);
					}
					return;
				}
				if (input === 'm' || input === 'M') {
					setManualInput('');
					setShowCursor(true);
					setMode('manual');
				}
				return;
			}

			if (mode === 'success') {
				if (key.return) {
					// 启用并直接回到会话页（切换 + 关闭由 handleApply 完成）
					handleApply();
					return;
				}
				if (key.escape) {
					closePanel();
				}
				return;
			}

			// error
			if (key.escape) {
				closePanel();
				return;
			}
			if (key.return) {
				setErrorMessage('');
				setStatusView(null);
				setOutcome(null);
				setSession(null);
				sessionRef.current = null;
				setMode('list');
			}
		},
		{isActive: visible},
	);

	if (!visible) {
		return null;
	}

	const header = (
		<Box flexDirection="column">
			<Text color={theme.colors.menuInfo} bold>
				{messages.title ?? 'OAuth sign-in'}
			</Text>
			<Text color={theme.colors.menuSecondary}>
				{messages.subtitle ??
					'Sign in with a subscription account. A browser window will open for authorization.'}
			</Text>
		</Box>
	);

	const hint = (text: string) => (
		<Box marginTop={1}>
			<Text color={theme.colors.menuSecondary} dimColor>
				{text}
			</Text>
		</Box>
	);

	if (mode === 'list') {
		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.menuInfo}
				paddingX={2}
				paddingY={1}
			>
				{header}
				<Box flexDirection="column" marginTop={1}>
					{providers.map((provider, index) => {
						const selected = index === selectedIndex;
						return (
							<Text
								key={provider.id}
								color={
									selected ? theme.colors.menuSelected : theme.colors.menuNormal
								}
								bold={selected}
							>
								{selected ? '❯ ' : '  '}
								{provider.label}
								<Text color={theme.colors.menuSecondary} dimColor>
									{'  '}
									{provider.description}
								</Text>
							</Text>
						);
					})}
				</Box>
				{hint(messages.signInHint ?? '↑↓ select • Enter sign in • ESC close')}
			</Box>
		);
	}

	if (mode === 'connecting') {
		const manualMode = statusView?.manualMode ?? session?.manualMode ?? false;
		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.menuInfo}
				paddingX={2}
				paddingY={1}
			>
				<Box>
					<Text color={theme.colors.menuSelected}>
						<Spinner type="dots" />
					</Text>
					<Text color={theme.colors.menuInfo}>
						{' '}
						{messages.waiting ?? 'Waiting for authorization in the browser...'}
					</Text>
				</Box>
				{session && (
					<Box flexDirection="column" marginTop={1}>
						<Text color={theme.colors.menuSecondary}>
							{messages.authUrlLabel ?? 'Authorization URL'}
						</Text>
						<Text color={theme.colors.text}>{session.authUrl}</Text>
					</Box>
				)}
				{manualMode && (
					<Box marginTop={1}>
						<Text color={theme.colors.warning}>
							{messages.manualHint ??
								'Local callback port is unavailable; press M to paste the callback URL or code.'}
						</Text>
					</Box>
				)}
				{hint(
					messages.openBrowserHint ??
						'O open the link again • M paste callback URL • ESC cancel',
				)}
			</Box>
		);
	}

	if (mode === 'manual') {
		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.menuInfo}
				paddingX={2}
				paddingY={1}
			>
				<Text color={theme.colors.menuInfo} bold>
					{messages.manualTitle ??
						'Paste the callback URL or authorization code'}
				</Text>
				<Box marginTop={1}>
					<Text color={theme.colors.menuInfo}>
						{messages.manualInputHint ?? 'Callback'}
					</Text>
					<Text color={theme.colors.menuSelected}>
						{' '}
						{manualInput}
						{showCursor ? '█' : ' '}
					</Text>
				</Box>
				{hint('Enter submit • ESC back')}
			</Box>
		);
	}

	if (mode === 'success' && outcome) {
		return (
			<Box
				flexDirection="column"
				borderStyle="round"
				borderColor={theme.colors.success}
				paddingX={2}
				paddingY={1}
			>
				<Text color={theme.colors.success} bold>
					{messages.successTitle ?? 'Sign-in complete'}
				</Text>
				<Box flexDirection="column" marginTop={1}>
					<Text color={theme.colors.text}>
						{messages.accountLabel ?? 'Account'}
						{': '}
						{outcome.email || outcome.accountId || '-'}
					</Text>
					{outcome.planType ? (
						<Text color={theme.colors.text}>
							{messages.planLabel ?? 'Plan'}
							{': '}
							{outcome.planType}
						</Text>
					) : null}
					<Text color={theme.colors.text}>
						{messages.profileLabel ?? 'Profile'}
						{': '}
						{outcome.profileName}
					</Text>
					<Text color={theme.colors.text}>
						{messages.modelsLabel ?? 'Models'}
						{': '}
						{outcome.availableModels.length > 0
							? outcome.availableModels.slice(0, 3).join(', ') +
							  (outcome.availableModels.length > 3 ? ' …' : '')
							: '-'}
					</Text>
				</Box>
				{hint(
					messages.applyHint ??
						'Enter activate and return to chat • ESC keep current profile',
				)}
			</Box>
		);
	}

	// error
	return (
		<Box
			flexDirection="column"
			borderStyle="round"
			borderColor={theme.colors.error}
			paddingX={2}
			paddingY={1}
		>
			<Text color={theme.colors.error} bold>
				{messages.errorTitle ?? 'Sign-in failed'}
			</Text>
			{errorMessage ? (
				<Box marginTop={1}>
					<Text color={theme.colors.text}>{errorMessage}</Text>
				</Box>
			) : null}
			{hint(messages.retryHint ?? 'Enter back to provider list • ESC close')}
		</Box>
	);
}
