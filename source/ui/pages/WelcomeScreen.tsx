import React, {
	useState,
	useMemo,
	useCallback,
	useEffect,
	useRef,
	Suspense,
} from 'react';
import {Box, Text, useStdout} from 'ink';
import ansiEscapes from 'ansi-escapes';
import Spinner from 'ink-spinner';
import Menu from '../components/common/Menu.js';
import {ChatHeaderLogo} from '../components/special/ChatHeader.js';
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {useI18n} from '../../i18n/index.js';
import {getUpdateNotice, onUpdateNotice} from '../../utils/ui/updateNotice.js';
import {useTheme} from '../contexts/ThemeContext.js';
import UpdateNotice from '../components/common/UpdateNotice.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import {runUpdateAndExit} from '../../utils/core/runUpdate.js';

// Lazy load all configuration screens for better startup performance
const ConfigScreen = React.lazy(() => import('./ConfigScreen.js'));
const ProxyConfigScreen = React.lazy(() => import('./ProxyConfigScreen.js'));
const SubAgentConfigScreen = React.lazy(
	() => import('./SubAgentConfigScreen.js'),
);
const SubAgentListScreen = React.lazy(() => import('./SubAgentListScreen.js'));
const SensitiveCommandConfigScreen = React.lazy(
	() => import('./SensitiveCommandConfigScreen.js'),
);
const CodeBaseConfigScreen = React.lazy(
	() => import('./CodeBaseConfigScreen.js'),
);
const SystemPromptConfigScreen = React.lazy(
	() => import('./SystemPromptConfigScreen.js'),
);
const CustomHeadersScreen = React.lazy(
	() => import('./CustomHeadersScreen.js'),
);
const LanguageSettingsScreen = React.lazy(
	() => import('./LanguageSettingsScreen.js'),
);
const ThemeSettingsScreen = React.lazy(
	() => import('./ThemeSettingsScreen.js'),
);
const PrivacySettingsScreen = React.lazy(
	() => import('./PrivacySettingsScreen.js'),
);
const HooksConfigScreen = React.lazy(() => import('./HooksConfigScreen.js'));
const MCPConfigScreen = React.lazy(() => import('./MCPConfigScreen.js'));

// 模块级标志：保证 SNOW CLI LOGO 的逐字符出现动画在整个进程生命周期内只播放一次。
// 任何后续的重渲染（菜单切换返回、终端 resize 触发的 remount 等）都直接显示完整 LOGO，
// 不会再次触发动画。
let hasPlayedLogoRevealAnimation = false;
// LOGO 完整版可见字符总数（3 行 × 21 字符 = 63），用作 reveal 的上限。
// 中等版（36）小于该值，所以同一个 totalChars 也能让中等版提前完成动画。
const LOGO_REVEAL_MAX_CHARS = 63;
// 每个字符出现的间隔时间（毫秒），决定动画的整体速度。
const LOGO_REVEAL_INTERVAL_MS = 10;

type Props = {
	version?: string;
	onMenuSelect?: (value: string) => void;
	defaultMenuIndex?: number;
	onMenuSelectionPersist?: (index: number) => void;
};

type InlineView =
	| 'menu'
	| 'config'
	| 'proxy-config'
	| 'codebase-config'
	| 'subagent-list'
	| 'subagent-add'
	| 'subagent-edit'
	| 'sensitive-commands'
	| 'systemprompt'
	| 'customheaders'
	| 'hooks-config'
	| 'mcp-config'
	| 'language-settings'
	| 'theme-settings'
	| 'privacy-settings';

export default function WelcomeScreen({
	version = '1.0.0',
	onMenuSelect,
	defaultMenuIndex = 0,
	onMenuSelectionPersist,
}: Props) {
	const {t} = useI18n();
	useTerminalTitle(`Snow CLI - ${t.welcome.title}`);
	const {theme} = useTheme();
	const [infoText, setInfoText] = useState(t.welcome.startChatInfo);
	const [inlineView, setInlineView] = useState<InlineView>('menu');
	const [updateNotice, setUpdateNoticeState] = useState(getUpdateNotice());
	const [editingAgentId, setEditingAgentId] = useState<string | undefined>();
	const {columns: terminalWidth} = useTerminalSize();
	const {stdout} = useStdout();
	const isInitialMount = useRef(true);

	// LOGO 逐字符出现动画：
	// - revealChars === undefined 表示动画已结束（或本次进程之前已播放过），完整显示。
	// - 数字值表示当前可见的字符数，会从 0 递增到 LOGO_REVEAL_MAX_CHARS。
	// 使用模块级 hasPlayedLogoRevealAnimation 保证只在首次进入时播放一次。
	const [logoRevealChars, setLogoRevealChars] = useState<number | undefined>(
		() => (hasPlayedLogoRevealAnimation ? undefined : 0),
	);
	useEffect(() => {
		if (hasPlayedLogoRevealAnimation) return;
		const interval = setInterval(() => {
			setLogoRevealChars(prev => {
				if (prev === undefined) return undefined;
				const next = prev + 1;
				if (next >= LOGO_REVEAL_MAX_CHARS) {
					clearInterval(interval);
					hasPlayedLogoRevealAnimation = true;
					// 切换为 undefined 让 ChatHeaderLogo 直接渲染完整字符串，
					// 后续重渲染不再走遮罩逻辑。
					return undefined;
				}
				return next;
			});
		}, LOGO_REVEAL_INTERVAL_MS);
		return () => clearInterval(interval);
	}, []);
	// 当终端宽度变化触发清屏时，先渲染为 null 一帧，把 ink/log-update 内部
	// "上一帧"缓存重置为空字符串；下一帧再切回 false 恢复完整内容，
	// 使新内容必然作为差异被完整写出，避免清屏后画面丢失。
	const [isResizing, setIsResizing] = useState(false);
	const inlineDivider = useMemo(() => {
		const dividerWidth = Math.max(0, terminalWidth - 2);
		return dividerWidth > 0 ? '-'.repeat(dividerWidth) : '';
	}, [terminalWidth]);

	// Local state for menu index, synced with parent's defaultMenuIndex
	const [currentMenuIndex, setCurrentMenuIndex] = useState(defaultMenuIndex);

	// Track sub-menu indices for persistence
	const [subAgentListIndex, setSubAgentListIndex] = useState(0);
	const [hooksConfigIndex, setHooksConfigIndex] = useState(0);

	// Sync with parent's defaultMenuIndex when it changes
	useEffect(() => {
		setCurrentMenuIndex(defaultMenuIndex);
	}, [defaultMenuIndex]);

	useEffect(() => {
		const unsubscribe = onUpdateNotice(notice => {
			setUpdateNoticeState(notice);
		});
		return unsubscribe;
	}, []);

	const hasUpdate = !!updateNotice;

	const menuOptions = useMemo(
		() => [
			{
				label: t.welcome.startChat,
				value: 'chat',
				infoText: t.welcome.startChatInfo,
				clearTerminal: true,
			},
			{
				label: t.welcome.resumeLastChat,
				value: 'resume-last',
				infoText: t.welcome.resumeLastChatInfo,
				clearTerminal: true,
			},
			{
				label: t.welcome.apiSettings,
				value: 'config',
				infoText: t.welcome.apiSettingsInfo,
			},
			{
				label: t.welcome.proxySettings,
				value: 'proxy',
				infoText: t.welcome.proxySettingsInfo,
			},
			{
				label: t.welcome.codebaseSettings,
				value: 'codebase',
				infoText: t.welcome.codebaseSettingsInfo,
			},
			{
				label: t.welcome.systemPromptSettings,
				value: 'systemprompt',
				infoText: t.welcome.systemPromptSettingsInfo,
			},
			{
				label: t.welcome.customHeadersSettings,
				value: 'customheaders',
				infoText: t.welcome.customHeadersSettingsInfo,
			},
			{
				label: t.welcome.mcpSettings,
				value: 'mcp',
				infoText: t.welcome.mcpSettingsInfo,
			},
			{
				label: t.welcome.subAgentSettings,
				value: 'subagent',
				infoText: t.welcome.subAgentSettingsInfo,
			},
			{
				label: t.welcome.sensitiveCommands,
				value: 'sensitive-commands',
				infoText: t.welcome.sensitiveCommandsInfo,
			},
			{
				label: t.welcome.hooksSettings,
				value: 'hooks',
				infoText: t.welcome.hooksSettingsInfo,
			},
			{
				label: t.welcome.languageSettings,
				value: 'language',
				infoText: t.welcome.languageSettingsInfo,
			},
			{
				label: t.welcome.themeSettings,
				value: 'theme',
				infoText: t.welcome.themeSettingsInfo,
			},
			{
				label: t.welcome.privacySettings,
				value: 'privacy',
				infoText: t.welcome.privacySettingsInfo,
			},
			...(hasUpdate
				? [
						{
							label: `${t.welcome.updateNow}${
								updateNotice ? ` (v${updateNotice.latestVersion})` : ''
							}`,
							value: 'update-now',
							color: '#FFD700',
							infoText: t.welcome.updateNowInfo,
							clearTerminal: true,
						},
				  ]
				: []),
			{
				label: t.welcome.exit,
				value: 'exit',
				color: 'rgb(232, 131, 136)',
				infoText: t.welcome.exitInfo,
			},
		],
		[t, hasUpdate, updateNotice],
	);

	const [remountKey, setRemountKey] = useState(0);

	// Cache menuOptions value-to-index map for O(1) lookups
	const optionsIndexMap = useMemo(() => {
		const map = new Map<string, number>();
		menuOptions.forEach((opt, idx) => {
			map.set(opt.value, idx);
		});
		return map;
	}, [menuOptions]);

	const handleSelectionChange = useCallback(
		(newInfoText: string, value: string) => {
			// Only update if infoText actually changed (avoid unnecessary re-renders)
			setInfoText(prev => (prev === newInfoText ? prev : newInfoText));

			// Use cached map for O(1) index lookup instead of O(n) findIndex
			const index = optionsIndexMap.get(value);
			if (index !== undefined) {
				setCurrentMenuIndex(index);
				onMenuSelectionPersist?.(index);
			}
		},
		[optionsIndexMap, onMenuSelectionPersist],
	);

	const handleInlineMenuSelect = useCallback(
		(value: string) => {
			// Persist the selected index before navigating
			const index = menuOptions.findIndex(opt => opt.value === value);
			if (index !== -1) {
				setCurrentMenuIndex(index);
				onMenuSelectionPersist?.(index);
			}

			// Handle inline views (config, proxy, codebase, subagent) or pass through to parent
			if (value === 'config') {
				setInlineView('config');
			} else if (value === 'proxy') {
				setInlineView('proxy-config');
			} else if (value === 'codebase') {
				setInlineView('codebase-config');
			} else if (value === 'subagent') {
				setInlineView('subagent-list');
			} else if (value === 'sensitive-commands') {
				setInlineView('sensitive-commands');
			} else if (value === 'systemprompt') {
				setInlineView('systemprompt');
			} else if (value === 'customheaders') {
				setInlineView('customheaders');
			} else if (value === 'mcp') {
				setInlineView('mcp-config');
			} else if (value === 'hooks') {
				setInlineView('hooks-config');
			} else if (value === 'language') {
				setInlineView('language-settings');
			} else if (value === 'theme') {
				setInlineView('theme-settings');
			} else if (value === 'privacy') {
				setInlineView('privacy-settings');
			} else if (value === 'update-now') {
				// Hand the terminal over to npm: unmount Ink and exec the update.
				// runUpdateAndExit() does not return — the process exits when
				// the npm child finishes.
				runUpdateAndExit();
			} else {
				// Pass through to parent for other actions (chat, exit, etc.)
				onMenuSelect?.(value);
			}
		},
		[onMenuSelect, menuOptions, onMenuSelectionPersist],
	);

	const handleBackToMenu = useCallback(() => {
		setInlineView('menu');
	}, []);

	const handleConfigSave = useCallback(() => {
		setInlineView('menu');
	}, []);

	const handleSubAgentAdd = useCallback(() => {
		setEditingAgentId(undefined);
		setInlineView('subagent-add');
	}, []);

	const handleSubAgentEdit = useCallback((agentId: string) => {
		setEditingAgentId(agentId);
		setInlineView('subagent-edit');
	}, []);

	const handleSubAgentBack = useCallback(() => {
		// 从三级返回二级时清除终端以避免残留显示
		stdout.write(ansiEscapes.clearTerminal);
		setRemountKey(prev => prev + 1);
		setInlineView('subagent-list');
	}, [stdout]);

	const handleSubAgentSave = useCallback(() => {
		// 保存后返回二级列表，清除终端以避免残留显示
		stdout.write(ansiEscapes.clearTerminal);
		setRemountKey(prev => prev + 1);
		setInlineView('subagent-list');
	}, [stdout]);

	// 终端宽度变化时清屏并强制重新绘制，避免 ink/log-update 因为旧内容尺寸
	// 与新尺寸不匹配而留下残影/错位。
	// 关键：清屏后必须先渲染为 null 一帧（让 log-update 的内部缓存被刷成空字符串），
	// 下一 tick 再切回 false，这样下一帧的真实内容就会作为完整新内容被写出，
	// 不再依赖被移除的顶部 <Static> 来"补回"内容。
	useEffect(() => {
		if (isInitialMount.current) {
			isInitialMount.current = false;
			return;
		}

		const handler = setTimeout(() => {
			stdout.write(ansiEscapes.clearTerminal);
			setIsResizing(true);
			setRemountKey(prev => prev + 1);
			// 在下一个事件循环 tick 切回 false，确保 React 至少 commit 了
			// 一次"渲染为 null"的中间帧，从而真正重置 log-update 的上一帧缓存。
			setImmediate(() => {
				setIsResizing(false);
			});
		}, 200); // 防抖，避免连续 resize 时频繁清屏

		return () => {
			clearTimeout(handler);
		};
	}, [terminalWidth, stdout]);

	// Loading fallback component for lazy-loaded screens
	const loadingFallback = (
		<Box paddingX={1}>
			<Text color="cyan">
				<Spinner type="dots" />
			</Text>
			<Text> Loading...</Text>
		</Box>
	);

	// Estimated logo column width passed to ChatHeaderLogo for responsive sizing.
	// Outer paddingX(2) + round border(2) = 4 columns reserved; right half also
	// pays for the 1-col vertical divider and inner paddingX(2 on each side = 4).
	const logoColumnWidth = Math.max(0, Math.floor((terminalWidth - 4) / 2) - 5);
	// 右侧 LOGO 区只有在 logoColumnWidth >= 20（中等/完整 LOGO 才会被渲染）时才有意义。
	// 否则 ChatHeaderLogo 在 hideCompact 模式下会返回 null，留下一个空的右半区——
	// 此时直接把整个圆角框让给 Menu 占满，不再做左右拆分。
	const showLogoPane = logoColumnWidth >= 20;
	// 当右侧 LOGO 走"完整最大版"分支（terminalWidth >= 30，对应这里 logoColumnWidth >= 30）
	// 且存在更新提示时：把更新提示从顶部移到右侧 LOGO 下方，LOGO 区改为顶端对齐让 LOGO 上移，
	// 这样在宽终端下能更紧凑地利用右半区的垂直空间。
	const isFullLogoPane = showLogoPane && logoColumnWidth >= 30;
	const showUpdateNoticeInLogoPane = isFullLogoPane && !!updateNotice;

	// 调整终端宽度后清屏的中间帧：渲染为 null，强制 log-update 把上一帧缓存
	// 重置为空字符串，下一帧的真实内容才能作为完整新内容被写出。
	if (isResizing) {
		return null;
	}

	return (
		<Box flexDirection="column" width={terminalWidth} key={remountKey}>
			{inlineView === 'menu' && updateNotice && !showUpdateNoticeInLogoPane && (
				<UpdateNotice
					currentVersion={updateNotice.currentVersion}
					latestVersion={updateNotice.latestVersion}
					terminalWidth={terminalWidth}
				/>
			)}

			{/* Unified rounded frame:
			    - 宽终端：Menu (left 50%) | Logo + version + greeting (right 50%)
			    - 窄终端（logoColumnWidth < 20，LOGO 不会渲染）：整框只放 Menu，不再拆分左右两半 */}
			{onMenuSelect && inlineView === 'menu' && (
				<Box paddingX={1}>
					<Box
						borderStyle="round"
						borderColor={theme.colors.menuInfo}
						flexDirection="column"
						width={terminalWidth - 2}
					>
						<Box flexDirection="row">
							{showLogoPane ? (
								<>
									{/* 左半 Menu：把竖线分隔放到这里的 right border 上。
									    原因：Menu 内部会因 scroll 提示（↑ N more above / ↓ N more below）
									    在不同选中项下出现/消失，行高动态变化。row 容器高度跟随更高的 Menu，
									    若把竖线放在右半 Logo Box 上，yoga 不一定会把右半 stretch 到 row 高度，
									    会导致竖线只画 Logo 自身那几行。把竖线挂在 Menu Box 上则自然贴满全高。 */}
									<Box
										width="50%"
										flexShrink={0}
										borderStyle="single"
										borderColor={theme.colors.menuInfo}
										borderTop={false}
										borderBottom={false}
										borderLeft={false}
									>
										<Menu
											options={menuOptions}
											onSelect={handleInlineMenuSelect}
											onSelectionChange={handleSelectionChange}
											defaultIndex={currentMenuIndex}
										/>
									</Box>
									<Box
										flexDirection="column"
										justifyContent={
											showUpdateNoticeInLogoPane ? 'flex-start' : 'center'
										}
										alignItems="center"
										paddingX={2}
										paddingY={showUpdateNoticeInLogoPane ? 1 : 0}
										flexGrow={1}
										flexShrink={1}
									>
										<ChatHeaderLogo
											terminalWidth={logoColumnWidth}
											logoGradient={theme.colors.logoGradient}
											hideCompact
											revealChars={logoRevealChars}
										/>
										<Box
											marginTop={1}
											width="100%"
											justifyContent="center"
											overflow="hidden"
										>
											<Text color="gray" dimColor wrap="truncate">
												v{version} • {t.welcome.subtitle}
											</Text>
										</Box>
										{showUpdateNoticeInLogoPane && updateNotice && (
											<Box
												marginTop={1}
												width="100%"
												justifyContent="center"
												overflow="hidden"
											>
												<UpdateNotice
													currentVersion={updateNotice.currentVersion}
													latestVersion={updateNotice.latestVersion}
													terminalWidth={logoColumnWidth}
												/>
											</Box>
										)}
									</Box>
								</>
							) : (
								<Box flexGrow={1}>
									<Menu
										options={menuOptions}
										onSelect={handleInlineMenuSelect}
										onSelectionChange={handleSelectionChange}
										defaultIndex={currentMenuIndex}
									/>
								</Box>
							)}
						</Box>
						{/* 框内底部说明区：使用上边框作为横向分隔线，与外框融为一体 */}
						<Box
							borderStyle="single"
							borderColor={theme.colors.menuInfo}
							borderLeft={false}
							borderRight={false}
							borderBottom={false}
							paddingX={1}
							flexDirection="row"
						>
							<Text color={theme.colors.menuInfo}>{infoText}</Text>
						</Box>
					</Box>
				</Box>
			)}

			{/* Render inline view content based on current state */}
			{inlineView !== 'menu' && (
				<Box paddingX={1}>
					<Text color={theme.colors.menuSecondary}>{inlineDivider}</Text>
				</Box>
			)}
			{inlineView === 'config' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<ConfigScreen
							onBack={handleBackToMenu}
							onSave={handleConfigSave}
							inlineMode={true}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'proxy-config' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<ProxyConfigScreen
							onBack={handleBackToMenu}
							onSave={handleConfigSave}
							inlineMode={true}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'codebase-config' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<CodeBaseConfigScreen
							onBack={handleBackToMenu}
							onSave={handleConfigSave}
							inlineMode={true}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'subagent-list' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<SubAgentListScreen
							onBack={handleBackToMenu}
							onAdd={handleSubAgentAdd}
							onEdit={handleSubAgentEdit}
							inlineMode={true}
							defaultSelectedIndex={subAgentListIndex}
							onSelectionPersist={setSubAgentListIndex}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'subagent-add' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<SubAgentConfigScreen
							onBack={handleSubAgentBack}
							onSave={handleSubAgentSave}
							inlineMode={true}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'subagent-edit' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<SubAgentConfigScreen
							onBack={handleSubAgentBack}
							onSave={handleSubAgentSave}
							agentId={editingAgentId}
							inlineMode={true}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'sensitive-commands' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<SensitiveCommandConfigScreen
							onBack={handleBackToMenu}
							inlineMode={true}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'systemprompt' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<SystemPromptConfigScreen onBack={handleBackToMenu} />
					</Box>
				</Suspense>
			)}
			{inlineView === 'customheaders' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<CustomHeadersScreen onBack={handleBackToMenu} />
					</Box>
				</Suspense>
			)}
			{inlineView === 'mcp-config' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<MCPConfigScreen
							onBack={handleBackToMenu}
							onSave={handleConfigSave}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'hooks-config' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<HooksConfigScreen
							onBack={handleBackToMenu}
							defaultScopeIndex={hooksConfigIndex}
							onScopeSelectionPersist={setHooksConfigIndex}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'language-settings' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<LanguageSettingsScreen
							onBack={handleBackToMenu}
							inlineMode={true}
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'theme-settings' && (
				<Suspense fallback={loadingFallback}>
					<ThemeSettingsScreen onBack={handleBackToMenu} inlineMode={true} />
				</Suspense>
			)}
			{inlineView === 'privacy-settings' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<PrivacySettingsScreen
							onBack={handleBackToMenu}
							inlineMode={true}
						/>
					</Box>
				</Suspense>
			)}
		</Box>
	);
}
