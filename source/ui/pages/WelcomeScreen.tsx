import React, {
	useState,
	useMemo,
	useCallback,
	useEffect,
	useRef,
	Suspense,
} from 'react';
import {Box, Text, useStdout, Static} from 'ink';
import {Alert} from '@inkjs/ui';
import Gradient from 'ink-gradient';
import ansiEscapes from 'ansi-escapes';
import Spinner from 'ink-spinner';
import Menu from '../components/common/Menu.js';
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {useI18n} from '../../i18n/index.js';
import {getUpdateNotice, onUpdateNotice} from '../../utils/ui/updateNotice.js';
import {useTheme} from '../contexts/ThemeContext.js';

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
const HooksConfigScreen = React.lazy(() => import('./HooksConfigScreen.js'));

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
	| 'language-settings'
	| 'theme-settings';

export default function WelcomeScreen({
	version = '1.0.0',
	onMenuSelect,
	defaultMenuIndex = 0,
	onMenuSelectionPersist,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [infoText, setInfoText] = useState(t.welcome.startChatInfo);
	const [inlineView, setInlineView] = useState<InlineView>('menu');
	const [updateNotice, setUpdateNoticeState] = useState(getUpdateNotice());
	const [editingAgentId, setEditingAgentId] = useState<string | undefined>();
	const {columns: terminalWidth} = useTerminalSize();
	const {stdout} = useStdout();
	const isInitialMount = useRef(true);
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
				label: t.welcome.exit,
				value: 'exit',
				color: 'rgb(232, 131, 136)',
				infoText: t.welcome.exitInfo,
			},
		],
		[t],
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
			} else if (value === 'hooks') {
				setInlineView('hooks-config');
			} else if (value === 'language') {
				setInlineView('language-settings');
			} else if (value === 'theme') {
				setInlineView('theme-settings');
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

	// Clear terminal and re-render on terminal width change
	// Use debounce to avoid flickering during continuous resize
	useEffect(() => {
		if (isInitialMount.current) {
			isInitialMount.current = false;
			return;
		}

		const handler = setTimeout(() => {
			stdout.write(ansiEscapes.clearTerminal);
			setRemountKey(prev => prev + 1); // Force re-render
		}, 200); // Add debounce delay to avoid rapid re-renders

		return () => {
			clearTimeout(handler);
		};
	}, [terminalWidth, stdout]); // Remove stdout from dependencies to avoid loops

	// Loading fallback component for lazy-loaded screens
	const loadingFallback = (
		<Box paddingX={1}>
			<Text color="cyan">
				<Spinner type="dots" />
			</Text>
			<Text> Loading...</Text>
		</Box>
	);

	return (
		<Box flexDirection="column" width={terminalWidth}>
			<Static
				key={remountKey}
				items={[
					<Box
						key="welcome-header"
						flexDirection="row"
						paddingLeft={2}
						paddingTop={1}
						paddingBottom={0}
						width={terminalWidth}
					>
						<Box flexDirection="column" justifyContent="center">
							<Box marginBottom={0}>
								<Text>
									<Text color="cyan">❆ </Text>
									<Gradient colors={theme.colors.logoGradient}>
										SNOW CLI
									</Gradient>
								</Text>
							</Box>
							<Text color="gray" dimColor>
								v{version} • {t.welcome.subtitle}
							</Text>
						</Box>
					</Box>,
				]}
			>
				{item => item}
			</Static>

			{inlineView === 'menu' && updateNotice && (
				<Box paddingX={1} marginBottom={1}>
					<Box
						borderStyle="double"
						borderColor="cyan"
						paddingX={2}
						paddingY={1}
						width={terminalWidth - 2}
					>
						<Box flexDirection="column">
							<Text bold color="cyan">
								{t.welcome.updateNoticeTitle}
							</Text>
							<Text color="gray" dimColor>
								{t.welcome.updateNoticeCurrent}:{' '}
								<Text color="gray">{updateNotice.currentVersion}</Text>
							</Text>
							<Text color="gray" dimColor>
								{t.welcome.updateNoticeLatest}:{' '}
								<Text color="yellow" bold>
									{updateNotice.latestVersion}
								</Text>
							</Text>
							<Text color="gray" dimColor>
								{t.welcome.updateNoticeRun}:{' '}
								<Text color="yellow" bold>
									snow --update
								</Text>
							</Text>
							<Text color="gray" dimColor>
								{t.welcome.updateNoticeGithub}:{' '}
								https://github.com/MayDay-wpf/snow-cli
							</Text>
						</Box>
					</Box>
				</Box>
			)}

			{/* Menu must be outside Static to receive input */}
			{onMenuSelect && inlineView === 'menu' && (
				<Box paddingX={1}>
					<Box borderStyle="round" borderColor="cyan" paddingX={1}>
						<Menu
							options={menuOptions}
							onSelect={handleInlineMenuSelect}
							onSelectionChange={handleSelectionChange}
							defaultIndex={currentMenuIndex}
						/>
					</Box>
				</Box>
			)}

			{/* Render inline view content based on current state */}
			{inlineView === 'menu' && (
				<Box paddingX={1}>
					<Alert variant="info">{infoText}</Alert>
				</Box>
			)}
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
		</Box>
	);
}
