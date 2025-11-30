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
import Menu from '../components/Menu.js';
import {useTerminalSize} from '../../hooks/ui/useTerminalSize.js';
import {useI18n} from '../../i18n/index.js';

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
}: Props) {
	const {t} = useI18n();
	const [infoText, setInfoText] = useState(t.welcome.startChatInfo);
	const [inlineView, setInlineView] = useState<InlineView>('menu');
	const [editingAgentId, setEditingAgentId] = useState<string | undefined>();
	const {columns: terminalWidth} = useTerminalSize();
	const {stdout} = useStdout();
	const isInitialMount = useRef(true);
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

	const handleSelectionChange = useCallback((newInfoText: string) => {
		setInfoText(newInfoText);
	}, []);

	const handleInlineMenuSelect = useCallback(
		(value: string) => {
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
		[onMenuSelect],
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

	const handleSubAgentSave = useCallback(() => {
		setInlineView('subagent-list');
	}, []);

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
	}, [terminalWidth]); // Remove stdout from dependencies to avoid loops

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
							<Text bold>
								<Gradient name="rainbow">{t.welcome.title}</Gradient>
							</Text>
							<Text color="gray" dimColor>
								v{version} • {t.welcome.subtitle}
							</Text>
						</Box>
					</Box>,
				]}
			>
				{item => item}
			</Static>

			{/* Menu must be outside Static to receive input */}
			{onMenuSelect && inlineView === 'menu' && (
				<Box paddingX={1}>
					<Box borderStyle="round" borderColor="cyan" paddingX={1}>
						<Menu
							options={menuOptions}
							onSelect={handleInlineMenuSelect}
							onSelectionChange={handleSelectionChange}
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
						/>
					</Box>
				</Suspense>
			)}
			{inlineView === 'subagent-add' && (
				<Suspense fallback={loadingFallback}>
					<Box paddingX={1}>
						<SubAgentConfigScreen
							onBack={() => setInlineView('subagent-list')}
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
							onBack={() => setInlineView('subagent-list')}
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
						<HooksConfigScreen onBack={handleBackToMenu} />
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
