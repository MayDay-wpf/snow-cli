import React, {useState, useMemo, useCallback, useEffect, useRef} from 'react';
import {Box, Text, useStdout, Static} from 'ink';
import {Alert} from '@inkjs/ui';
import Gradient from 'ink-gradient';
import ansiEscapes from 'ansi-escapes';
import Menu from '../components/Menu.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import ConfigScreen from './ConfigScreen.js';
import ProxyConfigScreen from './ProxyConfigScreen.js';
import SubAgentConfigScreen from './SubAgentConfigScreen.js';
import SubAgentListScreen from './SubAgentListScreen.js';
import SensitiveCommandConfigScreen from './SensitiveCommandConfigScreen.js';
import CodeBaseConfigScreen from './CodeBaseConfigScreen.js';
import SystemPromptConfigScreen from './SystemPromptConfigScreen.js';
import CustomHeadersScreen from './CustomHeadersScreen.js';

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
	| 'customheaders';

export default function WelcomeScreen({
	version = '1.0.0',
	onMenuSelect,
}: Props) {
	const [infoText, setInfoText] = useState('Start a new chat conversation');
	const [inlineView, setInlineView] = useState<InlineView>('menu');
	const [editingAgentId, setEditingAgentId] = useState<string | undefined>();
	const {columns: terminalWidth} = useTerminalSize();
	const {stdout} = useStdout();
	const isInitialMount = useRef(true);
	const [remountKey, setRemountKey] = useState(0);

	const menuOptions = useMemo(
		() => [
			{
				label: 'Start',
				value: 'chat',
				infoText: 'Start a new chat conversation',
				clearTerminal: true,
			},
			{
				label: 'API & Model Settings',
				value: 'config',
				infoText: 'Configure API settings, AI models, and manage profiles',
			},
			{
				label: 'Proxy & Browser Settings',
				value: 'proxy',
				infoText: 'Configure system proxy and browser for web search and fetch',
			},
			{
				label: 'CodeBase Settings',
				value: 'codebase',
				infoText: 'Configure codebase indexing with embedding and LLM models',
			},
			{
				label: 'System Prompt Settings',
				value: 'systemprompt',
				infoText: 'Configure custom system prompt (overrides default)',
			},
			{
				label: 'Custom Headers Settings',
				value: 'customheaders',
				infoText: 'Configure custom HTTP headers for API requests',
			},
			{
				label: 'MCP Settings',
				value: 'mcp',
				infoText: 'Configure Model Context Protocol servers',
			},
			{
				label: 'Sub-Agent Settings',
				value: 'subagent',
				infoText: 'Configure sub-agents with custom tool permissions',
			},
			{
				label: 'Sensitive Commands',
				value: 'sensitive-commands',
				infoText:
					'Configure commands that require confirmation even in YOLO mode',
			},
			{
				label: 'Exit',
				value: 'exit',
				color: 'rgb(232, 131, 136)',
				infoText: 'Exit the application',
			},
		],
		[],
	);

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
								<Gradient name="rainbow">❆ SNOW AI CLI</Gradient>
							</Text>
							<Text color="gray" dimColor>
								v{version} • Intelligent Command Line Assistant
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
				<Box paddingX={1}>
					<ConfigScreen
						onBack={handleBackToMenu}
						onSave={handleConfigSave}
						inlineMode={true}
					/>
				</Box>
			)}
			{inlineView === 'proxy-config' && (
				<Box paddingX={1}>
					<ProxyConfigScreen
						onBack={handleBackToMenu}
						onSave={handleConfigSave}
						inlineMode={true}
					/>
				</Box>
			)}
			{inlineView === 'codebase-config' && (
				<Box paddingX={1}>
					<CodeBaseConfigScreen
						onBack={handleBackToMenu}
						onSave={handleConfigSave}
						inlineMode={true}
					/>
				</Box>
			)}
			{inlineView === 'subagent-list' && (
				<Box paddingX={1}>
					<SubAgentListScreen
						onBack={handleBackToMenu}
						onAdd={handleSubAgentAdd}
						onEdit={handleSubAgentEdit}
						inlineMode={true}
					/>
				</Box>
			)}
			{inlineView === 'subagent-add' && (
				<Box paddingX={1}>
					<SubAgentConfigScreen
						onBack={() => setInlineView('subagent-list')}
						onSave={handleSubAgentSave}
						inlineMode={true}
					/>
				</Box>
			)}
			{inlineView === 'subagent-edit' && (
				<Box paddingX={1}>
					<SubAgentConfigScreen
						onBack={() => setInlineView('subagent-list')}
						onSave={handleSubAgentSave}
						agentId={editingAgentId}
						inlineMode={true}
					/>
				</Box>
			)}
			{inlineView === 'sensitive-commands' && (
				<Box paddingX={1}>
					<SensitiveCommandConfigScreen
						onBack={handleBackToMenu}
						inlineMode={true}
					/>
				</Box>
			)}
			{inlineView === 'systemprompt' && (
				<Box paddingX={1}>
					<SystemPromptConfigScreen onBack={handleBackToMenu} />
				</Box>
			)}
			{inlineView === 'customheaders' && (
				<Box paddingX={1}>
					<CustomHeadersScreen onBack={handleBackToMenu} />
				</Box>
			)}
		</Box>
	);
}
