import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { getMCPServicesInfo, refreshMCPToolsCache, reconnectMCPService } from '../../utils/mcpToolsManager.js';

interface MCPConnectionStatus {
	name: string;
	connected: boolean;
	tools: string[];
	connectionMethod?: string;
	error?: string;
	isBuiltIn?: boolean;
}

interface SelectItem {
	label: string;
	value: string;
	connected?: boolean;
	isBuiltIn?: boolean;
	error?: string;
	isRefreshAll?: boolean;
}

export default function MCPInfoPanel() {
	const [mcpStatus, setMcpStatus] = useState<MCPConnectionStatus[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isReconnecting, setIsReconnecting] = useState(false);

	const loadMCPStatus = async () => {
		try {
			const servicesInfo = await getMCPServicesInfo();
			const statusList: MCPConnectionStatus[] = servicesInfo.map(service => ({
				name: service.serviceName,
				connected: service.connected,
				tools: service.tools.map(tool => tool.name),
				connectionMethod: service.isBuiltIn ? 'Built-in' : 'External',
				isBuiltIn: service.isBuiltIn,
				error: service.error
			}));

			setMcpStatus(statusList);
			setErrorMessage(null);
			setIsLoading(false);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : 'Failed to load MCP services');
			setIsLoading(false);
		}
	};

	useEffect(() => {
		let isMounted = true;

		const load = async () => {
			await loadMCPStatus();
		};

		if (isMounted) {
			load();
		}

		return () => {
			isMounted = false;
		};
	}, []);

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
			setErrorMessage(error instanceof Error ? error.message : 'Failed to reconnect');
		} finally {
			setIsReconnecting(false);
		}
	};

	// Build select items from all services
	const selectItems: SelectItem[] = [
		{ label: 'Refresh all services', value: 'refresh-all', isRefreshAll: true },
		...mcpStatus.map(s => ({
			label: s.name,
			value: s.name,
			connected: s.connected,
			isBuiltIn: s.isBuiltIn,
			error: s.error
		}))
	];

	// Custom item component to render with colors
	const ItemComponent = ({ isSelected, label }: { isSelected?: boolean; label: string }) => {
		const item = selectItems.find(i => i.label === label);
		if (!item) return <Text>{label}</Text>;

		if (item.isRefreshAll) {
			return (
				<Text color={isSelected ? 'cyan' : 'blue'}>
					↻ {label}
				</Text>
			);
		}

		const statusColor = item.connected ? 'green' : 'red';
		const suffix = item.isBuiltIn ? ' (System)' : item.connected ? ' (External)' : ` - ${item.error || 'Failed'}`;

		return (
			<Box>
				<Text color={statusColor}>● </Text>
				<Text color={isSelected ? 'cyan' : 'white'}>{label}</Text>
				<Text color="gray" dimColor>{suffix}</Text>
			</Box>
		);
	};

	if (isLoading) {
		return (
			<Text color="gray">Loading MCP services...</Text>
		);
	}

	if (errorMessage) {
		return (
			<Box borderColor="red" borderStyle="round" paddingX={2} paddingY={0}>
				<Text color="red" dimColor>
					Error: {errorMessage}
				</Text>
			</Box>
		);
	}

	if (mcpStatus.length === 0) {
		return (
			<Box borderColor="cyan" borderStyle="round" paddingX={2} paddingY={0}>
				<Text color="gray" dimColor>No available MCP services detected</Text>
			</Box>
		);
	}

	return (
		<Box borderColor="cyan" borderStyle="round" paddingX={2} paddingY={0}>
			<Box flexDirection="column">
				<Text color="cyan" bold>
					{isReconnecting ? 'Refreshing services...' : 'MCP Services'}
				</Text>
				{!isReconnecting && (
					<SelectInput
						items={selectItems}
						onSelect={handleServiceSelect}
						itemComponent={ItemComponent}
					/>
				)}
				{isReconnecting && (
					<Text color="yellow" dimColor>Please wait...</Text>
				)}
			</Box>
		</Box>
	);
}
