import React, {useState, useMemo, useCallback, useEffect, useRef} from 'react';
import {Box, Text, useStdout, Static} from 'ink';
import {Alert} from '@inkjs/ui';
import Gradient from 'ink-gradient';
import ansiEscapes from 'ansi-escapes';
import Menu from '../components/Menu.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';
import ConfigScreen from './ConfigScreen.js';
import ProxyConfigScreen from './ProxyConfigScreen.js';

type Props = {
	version?: string;
	onMenuSelect?: (value: string) => void;
};

type InlineView = 'menu' | 'config' | 'proxy-config';

export default function WelcomeScreen({
	version = '1.0.0',
	onMenuSelect,
}: Props) {
	const [infoText, setInfoText] = useState('Start a new chat conversation');
	const [inlineView, setInlineView] = useState<InlineView>('menu');
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
			// Handle inline views (config, proxy) or pass through to parent
			if (value === 'config') {
				setInlineView('config');
			} else if (value === 'proxy') {
				setInlineView('proxy-config');
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
		}, 0); // Wait for resize to stabilize

		return () => {
			clearTimeout(handler);
		};
	}, [terminalWidth, stdout]);

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
		</Box>
	);
}
