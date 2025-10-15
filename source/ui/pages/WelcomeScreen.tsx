import React, {useState, useMemo, useCallback, useEffect, useRef} from 'react';
import {Box, Text, useStdout, Static} from 'ink';
import {Alert} from '@inkjs/ui';
import Gradient from 'ink-gradient';
import ansiEscapes from 'ansi-escapes';
import Menu from '../components/Menu.js';
import {useTerminalSize} from '../../hooks/useTerminalSize.js';

type Props = {
	version?: string;
	onMenuSelect?: (value: string) => void;
};

export default function WelcomeScreen({
	version = '1.0.0',
	onMenuSelect,
}: Props) {
	const [infoText, setInfoText] = useState('Start a new chat conversation');
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
				label: 'API Settings',
				value: 'config',
				infoText: 'Configure OpenAI API settings',
			},
			{
				label: 'Model Settings',
				value: 'models',
				infoText: 'Configure AI models for different tasks',
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
						flexDirection="column"
						padding={1}
						width={terminalWidth}
					>
						<Box
							borderStyle="double"
							borderColor={'cyan'}
							paddingX={1}
							paddingY={1}
							width={terminalWidth - 2}
						>
							<Box flexDirection="column">
								<Text color="white" bold>
									<Text color="cyan">❆ </Text>
									<Gradient name="rainbow">SNOW AI CLI</Gradient>
								</Text>
								<Text color="gray" dimColor>
									Intelligent Command Line Assistant
								</Text>
								<Text color="magenta" dimColor>
									Version {version}
								</Text>
							</Box>
						</Box>
					</Box>,
				]}
			>
				{item => item}
			</Static>

			{/* Menu must be outside Static to receive input */}
			{onMenuSelect && (
				<Box paddingX={2}>
					<Menu
						options={menuOptions}
						onSelect={onMenuSelect}
						onSelectionChange={handleSelectionChange}
					/>
				</Box>
			)}

			<Box paddingX={2}>
				<Alert variant="info">{infoText}</Alert>
			</Box>
		</Box>
	);
}
