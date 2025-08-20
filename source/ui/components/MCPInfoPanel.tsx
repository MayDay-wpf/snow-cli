import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getMCPServicesInfo } from '../../utils/mcpToolsManager.js';

interface MCPConnectionStatus {
	name: string;
	connected: boolean;
	tools: string[];
	connectionMethod?: string;
	error?: string;
	isBuiltIn?: boolean;
}

export default function MCPInfoPanel() {
	const [mcpStatus, setMcpStatus] = useState<MCPConnectionStatus[]>([]);
	const [isLoading, setIsLoading] = useState(true);

	useEffect(() => {
		const loadMCPStatus = async () => {
			try {
				setIsLoading(true);
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
				setIsLoading(false);
			} catch (error) {
				setIsLoading(false);
			}
		};

		loadMCPStatus();
	}, []);

	if (isLoading) {
		return (
			<Box borderColor="gray" borderStyle="round" paddingX={2} paddingY={1} marginBottom={1}>
				<Text color="gray">Loading MCP services...</Text>
			</Box>
		);
	}

	if (mcpStatus.length === 0) {
		return (
			<Box borderColor="gray" borderStyle="round" paddingX={2} paddingY={1} marginBottom={1}>
				<Text color="gray">No MCP services configured</Text>
			</Box>
		);
	}

	return (
		<Box borderColor="cyan" borderStyle="round" paddingX={2} paddingY={1} marginBottom={1}>
			<Box flexDirection="column">
				<Text color="cyan" bold>MCP Services</Text>
				{mcpStatus.map((status, index) => (
					<Box key={index} flexDirection="column" marginTop={index > 0 ? 1 : 0}>
						<Box flexDirection="row">
							<Text color={status.connected ? "green" : "red"}>
								{status.connected ? "●" : "●"}
							</Text>
							<Box marginLeft={1}>
								<Text color="white" bold>
									{status.name}
								</Text>
								{status.isBuiltIn && (
									<Text color="blue" dimColor>
										 (System)
									</Text>
								)}
								{status.connected && status.connectionMethod && !status.isBuiltIn && (
									<Text color="gray" dimColor>
										 ({status.connectionMethod})
									</Text>
								)}
							</Box>
						</Box>
						{status.connected && status.tools.length > 0 && (
							<Box flexDirection="column" marginLeft={2}>
								<Text color="gray" dimColor>
									Tools: {status.tools.join(', ')}
								</Text>
							</Box>
						)}
						{!status.connected && status.error && (
							<Box marginLeft={2}>
								<Text color="red" dimColor>
									Error: {status.error}
								</Text>
							</Box>
						)}
					</Box>
				))}
			</Box>
		</Box>
	);
}