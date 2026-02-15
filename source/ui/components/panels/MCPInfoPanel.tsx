import React, {useState, useEffect, useMemo} from 'react';
import {Box, Text, useInput} from 'ink';
import {
	getMCPServicesInfo,
	refreshMCPToolsCache,
	reconnectMCPService,
} from '../../../utils/execution/mcpToolsManager.js';
import {
	getMCPConfig,
	updateMCPConfig,
} from '../../../utils/config/apiConfig.js';
import {toggleBuiltInService} from '../../../utils/config/disabledBuiltInTools.js';
import {
	toggleSkill,
	isSkillEnabled,
} from '../../../utils/config/disabledSkills.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import type {Skill} from '../../../mcp/skills.js';

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
	isSkill?: boolean;
	isSectionHeader?: boolean;
	skillLocation?: 'project' | 'global';
	skillDescription?: string;
}

export default function MCPInfoPanel() {
	const {t} = useI18n();
	const [mcpStatus, setMcpStatus] = useState<MCPConnectionStatus[]>([]);
	const [skills, setSkills] = useState<Skill[]>([]);
	const [skillEnabledMap, setSkillEnabledMap] = useState<
		Record<string, boolean>
	>({});
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [isReconnecting, setIsReconnecting] = useState(false);
	const [togglingService, setTogglingService] = useState<string | null>(null);

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
				enabled: service.isBuiltIn
					? service.enabled !== false
					: mcpConfig.mcpServers[service.serviceName]?.enabled !== false,
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

	const loadSkills = async () => {
		try {
			const {listAvailableSkills} = await import('../../../mcp/skills.js');
			const skillsList = await listAvailableSkills(process.cwd());
			setSkills(skillsList);
			// Build enabled map
			const enabledMap: Record<string, boolean> = {};
			for (const skill of skillsList) {
				enabledMap[skill.id] = isSkillEnabled(skill.id);
			}
			setSkillEnabledMap(enabledMap);
		} catch {
			// Skills loading failure is non-critical, just show empty
		}
	};

	useEffect(() => {
		let isMounted = true;

		const load = async () => {
			await Promise.all([loadMCPStatus(), loadSkills()]);
		};

		if (isMounted) {
			load();
		}

		return () => {
			isMounted = false;
		};
	}, []);

	const handleServiceSelect = async (item: SelectItem) => {
		if (item.isSectionHeader || item.isSkill) return;
		setIsReconnecting(true);
		try {
			if (item.value === 'refresh-all') {
				// Refresh all services
				await refreshMCPToolsCache();
			} else if (item.isBuiltIn) {
				// Built-in system services just refresh cache
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

	// Build select items: services + skills
	const selectItems: SelectItem[] = [
		{
			label: t.mcpInfoPanel.refreshAll,
			value: 'refresh-all',
			isRefreshAll: true,
		},
		...mcpStatus.map(s => ({
			label: s.name,
			value: s.name,
			connected: s.connected,
			isBuiltIn: s.isBuiltIn,
			error: s.error,
			enabled: s.enabled,
		})),
	];

	// Add skills section header + skill items
	if (skills.length > 0) {
		selectItems.push({
			label: t.mcpInfoPanel.skillsTitle,
			value: '__skills_header__',
			isSectionHeader: true,
		});
		for (const skill of skills) {
			selectItems.push({
				label: skill.name || skill.id,
				value: skill.id,
				isSkill: true,
				enabled: skillEnabledMap[skill.id] !== false,
				skillLocation: skill.location,
				skillDescription: skill.description,
			});
		}
	}

	// Windowed display to prevent excessive height
	const MAX_DISPLAY_ITEMS = 8;
	const displayWindow = useMemo(() => {
		if (selectItems.length <= MAX_DISPLAY_ITEMS) {
			return {
				items: selectItems,
				startIndex: 0,
				endIndex: selectItems.length,
			};
		}

		const halfWindow = Math.floor(MAX_DISPLAY_ITEMS / 2);
		let startIndex = Math.max(0, selectedIndex - halfWindow);
		const endIndex = Math.min(
			selectItems.length,
			startIndex + MAX_DISPLAY_ITEMS,
		);

		if (endIndex - startIndex < MAX_DISPLAY_ITEMS) {
			startIndex = Math.max(0, endIndex - MAX_DISPLAY_ITEMS);
		}

		return {
			items: selectItems.slice(startIndex, endIndex),
			startIndex,
			endIndex,
		};
	}, [selectItems, selectedIndex]);

	const displayedItems = displayWindow.items;
	const hiddenAboveCount = displayWindow.startIndex;
	const hiddenBelowCount = Math.max(
		0,
		selectItems.length - displayWindow.endIndex,
	);

	// Listen for keyboard input
	useInput(async (_, key) => {
		if (isReconnecting || togglingService) return;

		// Arrow key navigation — skip section headers
		if (key.upArrow) {
			setSelectedIndex(prev => {
				let next = prev > 0 ? prev - 1 : selectItems.length - 1;
				// Skip section headers
				if (selectItems[next]?.isSectionHeader) {
					next = next > 0 ? next - 1 : selectItems.length - 1;
				}
				return next;
			});
			return;
		}
		if (key.downArrow) {
			setSelectedIndex(prev => {
				let next = prev < selectItems.length - 1 ? prev + 1 : 0;
				// Skip section headers
				if (selectItems[next]?.isSectionHeader) {
					next = next < selectItems.length - 1 ? next + 1 : 0;
				}
				return next;
			});
			return;
		}

		// Enter to select (reconnect service)
		if (key.return) {
			const currentItem = selectItems[selectedIndex];
			if (currentItem) {
				await handleServiceSelect(currentItem);
			}
			return;
		}

		// Tab key to toggle enabled/disabled
		if (key.tab) {
			const currentItem = selectItems[selectedIndex];
			if (!currentItem || currentItem.isRefreshAll || currentItem.isSectionHeader) return;

			try {
				setTogglingService(currentItem.label);

				if (currentItem.isSkill) {
					// Toggle individual skill
					toggleSkill(currentItem.value);
					setSkillEnabledMap(prev => ({
						...prev,
						[currentItem.value]: !prev[currentItem.value],
					}));
				} else if (currentItem.isBuiltIn) {
					// Toggle built-in service
					toggleBuiltInService(currentItem.value);
				} else {
					// Toggle external MCP service
					const config = getMCPConfig();
					const serverConfig = config.mcpServers[currentItem.value];
					if (serverConfig) {
						const currentEnabled = serverConfig.enabled !== false;
						serverConfig.enabled = !currentEnabled;
						updateMCPConfig(config);
					}
				}

				// Refresh MCP tools cache and reload status
				await refreshMCPToolsCache();
				await loadMCPStatus();
			} catch (error) {
				setErrorMessage(
					error instanceof Error ? error.message : 'Failed to toggle service',
				);
			} finally {
				setTogglingService(null);
			}
		}
	});

	if (isLoading) {
		return <Text color="gray">{t.mcpInfoPanel.loading}</Text>;
	}

	if (errorMessage) {
		return (
			<Box borderColor="red" borderStyle="round" paddingX={2} paddingY={0}>
				<Text color="red" dimColor>
					{t.mcpInfoPanel.error.replace('{message}', errorMessage)}
				</Text>
			</Box>
		);
	}

	if (mcpStatus.length === 0 && skills.length === 0) {
		return (
			<Box borderColor="cyan" borderStyle="round" paddingX={2} paddingY={0}>
				<Text color="gray" dimColor>
					{t.mcpInfoPanel.noServices}
				</Text>
			</Box>
		);
	}

	return (
		<Box borderColor="cyan" borderStyle="round" paddingX={2} paddingY={0}>
			<Box flexDirection="column">
			<Text color="cyan" bold>
				{isReconnecting
					? t.mcpInfoPanel.refreshing
					: togglingService
					? t.mcpInfoPanel.toggling.replace('{service}', togglingService)
					: t.mcpInfoPanel.title}
				{!isReconnecting &&
					!togglingService &&
					selectItems.length > MAX_DISPLAY_ITEMS &&
					` (${selectedIndex + 1}/${selectItems.length})`}
			</Text>
			{!isReconnecting &&
				!togglingService &&
				displayedItems.map((item, displayIndex) => {
					const originalIndex = displayWindow.startIndex + displayIndex;
					const isSelected = originalIndex === selectedIndex;

					// Render section header (Skills title)
					if (item.isSectionHeader) {
						return (
							<Box key={item.value} marginTop={1}>
								<Text color="cyan" bold>
									{item.label}
								</Text>
							</Box>
						);
					}

					// Render refresh-all item
					if (item.isRefreshAll) {
						return (
							<Box key={item.value}>
								<Text color={isSelected ? 'cyan' : 'blue'}>
									{isSelected ? '❯ ' : '  '}↻ {t.mcpInfoPanel.refreshAll}
								</Text>
							</Box>
						);
					}

					// Render skill item
					if (item.isSkill) {
						const isEnabled = item.enabled !== false;
						const locationSuffix =
							item.skillLocation === 'project'
								? t.mcpInfoPanel.skillLocationProject
								: t.mcpInfoPanel.skillLocationGlobal;

						return (
							<Box key={item.value}>
								<Text>
									{isSelected ? '❯ ' : '  '}
									<Text color={isEnabled ? 'magenta' : 'gray'}>◆ </Text>
									<Text
										color={
											isSelected ? 'cyan' : isEnabled ? 'white' : 'gray'
										}
									>
										{item.label}
									</Text>
									<Text color="gray" dimColor>
										{' '}
										{isEnabled ? locationSuffix : t.mcpInfoPanel.statusDisabled}
									</Text>
									{isEnabled && item.skillDescription ? (
										<Text color="gray" dimColor>
											{' - '}
											{item.skillDescription}
										</Text>
									) : null}
								</Text>
							</Box>
						);
					}

					// Render MCP service item
					const isEnabled = item.enabled !== false;
					const statusColor = !isEnabled
						? 'gray'
						: item.connected
						? 'green'
						: 'red';
					const suffix = !isEnabled
						? t.mcpInfoPanel.statusDisabled
						: item.isBuiltIn
						? t.mcpInfoPanel.statusSystem
						: item.connected
						? t.mcpInfoPanel.statusExternal
						: ` - ${item.error || t.mcpInfoPanel.statusFailed}`;

					return (
						<Box key={item.value}>
							<Text>
								{isSelected ? '❯ ' : '  '}
								<Text color={statusColor}>● </Text>
								<Text
									color={isSelected ? 'cyan' : !isEnabled ? 'gray' : 'white'}
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
			{!isReconnecting &&
				!togglingService &&
				selectItems.length > MAX_DISPLAY_ITEMS && (
					<Box>
						<Text color="gray" dimColor>
							{t.mcpInfoPanel.scrollHint}
							{hiddenAboveCount > 0 &&
								` · ${t.mcpInfoPanel.moreAbove.replace('{count}', String(hiddenAboveCount))}`}
							{hiddenBelowCount > 0 &&
								` · ${t.mcpInfoPanel.moreBelow.replace('{count}', String(hiddenBelowCount))}`}
						</Text>
					</Box>
				)}
				{(isReconnecting || togglingService) && (
					<Text color="yellow" dimColor>
						{t.mcpInfoPanel.pleaseWait}
					</Text>
				)}
				{!isReconnecting && !togglingService && (
					<Text color="gray" dimColor>
						{t.mcpInfoPanel.navigationHint}
					</Text>
				)}
			</Box>
		</Box>
	);
}
