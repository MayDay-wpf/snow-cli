import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {
	getMCPServicesInfo,
	refreshMCPToolsCache,
	reconnectMCPService,
} from '../../utils/execution/mcpToolsManager.js';
import {getMCPConfig, updateMCPConfig} from '../../utils/config/apiConfig.js';

type Props = {
	onClose: () => void;
	panelKey: number;
};

interface MCPConnectionStatus {
	name: string;
	connected: boolean;
	tools: string[];
	connectionMethod?: string;
	error?: string;
	isBuiltIn?: boolean;
	enabled?: boolean;
}

interface SelectItem {
	label: string;
	value: string;
	connected?: boolean;
	isBuiltIn?: boolean;
	error?: string;
	isRefreshAll?: boolean;
	enabled?: boolean;
}

export default function MCPInfoScreen({onClose, panelKey}: Props) {
	const [mcpStatus, setMcpStatus] = useState<MCPConnectionStatus[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isReconnecting, setIsReconnecting] = useState(false);

	const loadMCPStatus = async () => {
		try {
			const servicesInfo = await getMCPServicesInfo();
			const mcpConfig = getMCPConfig();
			const statusList: MCPConnectionStatus[] = servicesInfo.map(service => ({
				name: service.serviceName,
				connected: service.connected,
				tools: service.tools.map(tool => tool.name),
				connectionMethod: service.isBuiltIn ? 'Built-in' : 'External',
				isBuiltIn: service.isBuiltIn,
				error: service.error,
				enabled:
					service.isBuiltIn ||
					mcpConfig.mcpServers[service.serviceName]?.enabled !== false,
			}));

			setMcpStatus(statusList);
			setErrorMessage(null);
			setIsLoading(false);
		} catch (error) {
			setErrorMessage(
				error instanceof Error ? error.message : 'Failed to load MCP services',
			);
			setIsLoading(false);
		}
	};

	useEffect(() => {
		process.stdout.write('\x1B[?1049h');
		process.stdout.write('\x1B[2J');
		process.stdout.write('\x1B[H');
		return () => {
			process.stdout.write('\x1B[2J');
			process.stdout.write('\x1B[?1049l');
		};
	}, []);

	useEffect(() => {
		loadMCPStatus();
	}, [panelKey]);

	useInput(async (_, key) => {
		if (key.escape) {
			onClose();
			return;
		}

		if (isReconnecting) return;

		// Arrow key navigation
		if (key.upArrow) {
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : selectItems.length - 1));
			return;
		}
		if (key.downArrow) {
			setSelectedIndex(prev => (prev < selectItems.length - 1 ? prev + 1 : 0));
			return;
		}

		// Enter to select
		if (key.return) {
			const currentItem = selectItems[selectedIndex];
			if (currentItem) {
				await handleServiceSelect(currentItem);
			}
			return;
		}

		// Tab key to toggle enabled/disabled for non-system MCP services
		if (key.tab) {
			const currentItem = selectItems[selectedIndex];

			// Skip if it's the refresh-all option or a built-in service
			if (currentItem && !currentItem.isRefreshAll && !currentItem.isBuiltIn) {
				try {
					const config = getMCPConfig();
					const serviceName = currentItem.value;

					if (config.mcpServers[serviceName]) {
						// Toggle enabled state (default to true if undefined)
						const currentEnabled =
							config.mcpServers[serviceName].enabled !== false;
						config.mcpServers[serviceName].enabled = !currentEnabled;

						updateMCPConfig(config);

						// Refresh MCP tools cache and reload status
						await refreshMCPToolsCache();
						await loadMCPStatus();
					}
				} catch (error) {
					setErrorMessage(
						error instanceof Error ? error.message : 'Failed to toggle service',
					);
				}
			}
		}
	});

	const handleServiceSelect = async (item: SelectItem) => {
		setIsReconnecting(true);
		try {
			if (item.value === 'refresh-all') {
				// Refresh all services
				await refreshMCPToolsCache();
			} else {
				// Reconnect specific service
				await reconnectMCPService(item.value);
			}
			await loadMCPStatus();
		} catch (error) {
			setErrorMessage(
				error instanceof Error ? error.message : 'Failed to reconnect',
			);
		} finally {
			setIsReconnecting(false);
		}
	};

	// Build select items from all services
	const selectItems: SelectItem[] = [
		{label: 'Refresh all services', value: 'refresh-all', isRefreshAll: true},
		...mcpStatus.map(s => ({
			label: s.name,
			value: s.name,
			connected: s.connected,
			isBuiltIn: s.isBuiltIn,
			error: s.error,
			enabled: s.enabled,
		})),
	];

	if (isLoading) {
		return (
			<Box flexDirection="column" padding={1}>
				<Text color="gray">Loading MCP services...</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Box borderStyle="double" paddingX={2} paddingY={0} borderColor="cyan">
				<Box flexDirection="column">
					<Text color="white" bold>
						<Text color="cyan">❆ </Text>
						MCP Services Overview
					</Text>
					<Text color="gray" dimColor>
						Press ESC to return | Use ↑↓ and Enter to refresh | Tab to
						enable/disable (non-system only)
					</Text>
				</Box>
			</Box>

			{errorMessage && (
				<Box
					borderColor="red"
					borderStyle="round"
					paddingX={2}
					paddingY={0}
					marginTop={1}
				>
					<Text color="red" dimColor>
						Error: {errorMessage}
					</Text>
				</Box>
			)}

			<Box
				borderColor="cyan"
				borderStyle="round"
				paddingX={2}
				paddingY={0}
				marginTop={1}
			>
				<Box flexDirection="column">
					<Text color="cyan" bold>
						{isReconnecting ? 'Refreshing services...' : 'MCP Services'}
					</Text>
					{!isReconnecting &&
						selectItems.map((item, index) => {
							const isSelected = index === selectedIndex;

							// Render refresh-all item
							if (item.isRefreshAll) {
								return (
									<Box key={item.value}>
										<Text color={isSelected ? 'cyan' : 'blue'}>
											{isSelected ? '> ' : '  '}↻ {item.label}
										</Text>
									</Box>
								);
							}

							// Check if service is disabled
							const isEnabled = item.enabled !== false;
							const statusColor = !isEnabled
								? 'gray'
								: item.connected
								? 'green'
								: 'red';
							const suffix = item.isBuiltIn
								? ' (System)'
								: !isEnabled
								? ' (Disabled)'
								: item.connected
								? ' (External)'
								: ` - ${item.error || 'Failed'}`;

							return (
								<Box key={item.value}>
									<Text>
										{isSelected ? '❯ ' : '  '}
										<Text color={statusColor}>● </Text>
										<Text
											color={
												isSelected ? 'cyan' : !isEnabled ? 'gray' : 'white'
											}
										>
											{item.label}
										</Text>
										<Text color="gray" dimColor>
											{suffix}
										</Text>
									</Text>
								</Box>
							);
						})}
					{isReconnecting && (
						<Text color="yellow" dimColor>
							Please wait...
						</Text>
					)}
				</Box>
			</Box>
		</Box>
	);
}
