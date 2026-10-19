import React, {useState, useEffect, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {useTheme} from '../contexts/ThemeContext.js';
import {useI18n} from '../../i18n/index.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import {runningSubAgentTracker} from '../../utils/execution/runningSubAgentTracker.js';
import {teamTracker} from '../../utils/execution/teamTracker.js';
import {processManager} from '../../utils/core/processManager.js';
import {getBackgroundProcesses} from '../../hooks/execution/useBackgroundProcesses.js';
import {
	formatBytes,
	formatCpuPercent,
	getMainProcessCpuPercent,
	getMainProcessMemoryBytes,
	getMainProcessUptimeSeconds,
	killProcessTree,
	listDescendantProcesses,
	sampleProcessResources,
} from '../../utils/core/processResourceMonitor.js';
import {logger} from '../../utils/core/logger.js';

const log = logger.child('ui:pages');

/**
 * Resource Manager Screen
 *
 * `/taskmanager` 打开的全屏面板：展示 Snow CLI 主进程与所有子进程
 * （子代理 / 团队成员 / MCP / LSP / 后台进程）的 CPU 与内存占用，
 * 并支持逐个停止，行为类似浏览器的内置任务管理器。
 */

type EntryKind = 'main' | 'subagent' | 'teammate' | 'child' | 'background';
type EntryStatus = 'running' | 'completed' | 'failed';

interface ResourceEntry {
	id: string;
	kind: EntryKind;
	name: string;
	detail?: string;
	pid?: number;
	cpuPercent: number | null;
	memoryBytes: number | null;
	status: EntryStatus;
	startedAt?: Date;
	stoppable: boolean;
}

const KIND_ORDER: Record<EntryKind, number> = {
	main: 0,
	subagent: 1,
	teammate: 2,
	child: 3,
	background: 4,
};

const REFRESH_INTERVAL_MS = 1500;
const CONFIRM_WINDOW_MS = 2500;
const VISIBLE_ITEMS = 8;

function truncate(text: string, maxWidth: number): string {
	const clean = text.replace(/[\r\n\t]+/g, ' ').trim();
	if (clean.length <= maxWidth) {
		return clean;
	}
	if (maxWidth <= 3) {
		return clean.slice(0, maxWidth);
	}
	return clean.slice(0, maxWidth - 3) + '...';
}

function padRight(text: string, width: number): string {
	if (text.length >= width) {
		return text.slice(0, width);
	}
	return text + ' '.repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
	if (text.length >= width) {
		return text;
	}
	return ' '.repeat(width - text.length) + text;
}

function formatDuration(start: Date, end?: Date): string {
	const endTime = end ?? new Date();
	const seconds = Math.max(
		0,
		Math.floor((endTime.getTime() - start.getTime()) / 1000),
	);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ${seconds % 60}s`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}
/**
 * 采集当前所有可展示的"进程"：主进程 + 当前进程的整棵子进程树
 * （子代理 / 团队成员 / MCP stdio 服务器 / 后台进程 / shell 等）。
 * 子进程来自 OS 进程树枚举，不依赖各模块是否主动登记；追踪器仅用于
 * 为已知子进程补充语义标签，最后批量补齐 CPU / 内存占用。
 */
async function collectResourceEntries(): Promise<ResourceEntry[]> {
	const entries: ResourceEntry[] = [];

	// 1. 主进程（Snow CLI 自身）
	entries.push({
		id: 'main',
		kind: 'main',
		name: 'Snow CLI',
		detail: `node ${process.version}`,
		pid: process.pid,
		cpuPercent: getMainProcessCpuPercent(),
		memoryBytes: getMainProcessMemoryBytes(),
		status: 'running',
		startedAt: new Date(Date.now() - getMainProcessUptimeSeconds() * 1000),
		stoppable: false,
	});

	// 2. 逻辑实体索引：用于给 OS 子进程打上语义标签（子代理 / 团队 / 后台）
	const subAgents = runningSubAgentTracker.getRunningAgents();
	const teammates = teamTracker.getRunningTeammates();
	const backgroundProcesses = getBackgroundProcesses();

	const subAgentByPid = new Map<number, (typeof subAgents)[number]>();
	for (const agent of subAgents) {
		if (typeof agent.pid === 'number') {
			subAgentByPid.set(agent.pid, agent);
		}
	}
	const teammateByPid = new Map<number, (typeof teammates)[number]>();
	for (const teammate of teammates) {
		if (typeof teammate.pid === 'number') {
			teammateByPid.set(teammate.pid, teammate);
		}
	}
	const backgroundByPid = new Map<
		number,
		(typeof backgroundProcesses)[number]
	>();
	for (const proc of backgroundProcesses) {
		backgroundByPid.set(proc.pid, proc);
	}
	// 已登记子进程的友好命令名（通常比 ps 的原始命令行更干净）
	const registeredCommandByPid = new Map<number, string>();
	for (const child of processManager.list()) {
		registeredCommandByPid.set(child.pid, child.command);
	}

	// 3. 枚举当前进程的整棵子进程树。
	// 这是"子进程"的主要来源：不依赖各模块是否主动登记，因此 MCP stdio
	// 服务器、浏览器、子代理 worker、shell、git 等都能被如实列出。
	const descendants = await listDescendantProcesses(process.pid);
	const coveredPids = new Set<number>();

	for (const proc of descendants) {
		coveredPids.add(proc.pid);
		const subAgent = subAgentByPid.get(proc.pid);
		const teammate = teammateByPid.get(proc.pid);
		const background = backgroundByPid.get(proc.pid);

		if (subAgent) {
			entries.push({
				id: `subagent:${subAgent.instanceId}`,
				kind: 'subagent',
				name: subAgent.agentName,
				detail: subAgent.prompt,
				pid: proc.pid,
				cpuPercent: null,
				memoryBytes: null,
				status: 'running',
				startedAt: subAgent.startedAt,
				stoppable: true,
			});
			continue;
		}

		if (teammate) {
			entries.push({
				id: `teammate:${teammate.instanceId}`,
				kind: 'teammate',
				name: teammate.memberName,
				detail: teammate.teamName,
				pid: proc.pid,
				cpuPercent: null,
				memoryBytes: null,
				status: 'running',
				startedAt: teammate.startedAt,
				stoppable: true,
			});
			continue;
		}

		if (background) {
			entries.push({
				id: `background:${background.id}`,
				kind: 'background',
				name: background.command,
				pid: proc.pid,
				cpuPercent: null,
				memoryBytes: null,
				status: background.status,
				startedAt: background.startedAt,
				stoppable: background.status === 'running',
			});
			continue;
		}

		entries.push({
			id: `child:${proc.pid}`,
			kind: 'child',
			name:
				registeredCommandByPid.get(proc.pid) ||
				proc.command ||
				`pid ${proc.pid}`,
			pid: proc.pid,
			cpuPercent: null,
			memoryBytes: null,
			status: 'running',
			stoppable: true,
		});
	}

	// 4. 逻辑实体中尚未落到具体 OS 进程的（如进程内运行 / PID 未知）仍然列出
	for (const agent of subAgents) {
		if (typeof agent.pid === 'number' && coveredPids.has(agent.pid)) {
			continue;
		}
		entries.push({
			id: `subagent:${agent.instanceId}`,
			kind: 'subagent',
			name: agent.agentName,
			detail: agent.prompt,
			pid: agent.pid,
			cpuPercent: null,
			memoryBytes: null,
			status: 'running',
			startedAt: agent.startedAt,
			stoppable: typeof agent.pid === 'number',
		});
	}
	for (const teammate of teammates) {
		if (typeof teammate.pid === 'number' && coveredPids.has(teammate.pid)) {
			continue;
		}
		entries.push({
			id: `teammate:${teammate.instanceId}`,
			kind: 'teammate',
			name: teammate.memberName,
			detail: teammate.teamName,
			pid: teammate.pid,
			cpuPercent: null,
			memoryBytes: null,
			status: 'running',
			startedAt: teammate.startedAt,
			stoppable: typeof teammate.pid === 'number',
		});
	}
	for (const proc of backgroundProcesses) {
		if (coveredPids.has(proc.pid)) {
			continue;
		}
		entries.push({
			id: `background:${proc.id}`,
			kind: 'background',
			name: proc.command,
			pid: proc.pid,
			cpuPercent: null,
			memoryBytes: null,
			status: proc.status,
			startedAt: proc.startedAt,
			stoppable: proc.status === 'running',
		});
	}

	// 5. 批量采样所有子进程的 CPU / 内存（排除主进程，主进程已有精确值）
	const pids = entries
		.map(entry => entry.pid)
		.filter(
			(pid): pid is number => typeof pid === 'number' && pid !== process.pid,
		);
	const resources = await sampleProcessResources(pids);
	for (const entry of entries) {
		if (typeof entry.pid === 'number' && resources.has(entry.pid)) {
			const res = resources.get(entry.pid)!;
			entry.cpuPercent = res.cpuPercent;
			entry.memoryBytes = res.memoryBytes;
		}
	}

	return entries;
}

function sortEntries(entries: ResourceEntry[]): ResourceEntry[] {
	return [...entries].sort((a, b) => {
		if (a.kind !== b.kind) {
			return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
		}
		if (a.status !== b.status) {
			if (a.status === 'running') return -1;
			if (b.status === 'running') return 1;
		}
		const aTime = a.startedAt ? a.startedAt.getTime() : 0;
		const bTime = b.startedAt ? b.startedAt.getTime() : 0;
		return bTime - aTime;
	});
}

type Props = {
	onBack: () => void;
	terminalWidth: number;
};

export default function ResourceManagerScreen({onBack, terminalWidth}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();
	useTerminalTitle(`Snow CLI - ${t.resourceManager.title}`);

	const [entries, setEntries] = useState<ResourceEntry[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [pendingStopId, setPendingStopId] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);

	const refresh = useCallback(async () => {
		try {
			const next = sortEntries(await collectResourceEntries());
			setEntries(next);
		} catch (error) {
			log.debug('Failed to collect resource entries', {error});
			// 采样失败时保留上一帧快照，避免界面闪空
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
		const timer = setInterval(() => {
			void refresh();
		}, REFRESH_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [refresh]);

	// "再次确认" 状态与提示在短时间窗口后自动清除
	useEffect(() => {
		if (!pendingStopId) {
			return undefined;
		}
		const timer = setTimeout(() => setPendingStopId(null), CONFIRM_WINDOW_MS);
		return () => clearTimeout(timer);
	}, [pendingStopId]);

	useEffect(() => {
		if (!notice) {
			return undefined;
		}
		const timer = setTimeout(() => setNotice(null), CONFIRM_WINDOW_MS);
		return () => clearTimeout(timer);
	}, [notice]);

	// 进程列表变化时把选中项收敛到有效范围
	useEffect(() => {
		setSelectedIndex(prev => {
			if (entries.length === 0) {
				return 0;
			}
			return Math.min(prev, entries.length - 1);
		});
	}, [entries.length]);

	const stopEntry = useCallback(
		(entry: ResourceEntry) => {
			if (typeof entry.pid !== 'number' || !entry.stoppable) {
				setNotice(t.resourceManager.notStoppable);
				return;
			}
			killProcessTree(entry.pid);
			setNotice(t.resourceManager.stopped.replace('{name}', entry.name));
			void refresh();
		},
		[refresh, t],
	);

	useInput((input, key) => {
		if (key.escape) {
			onBack();
			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev =>
				prev > 0 ? prev - 1 : Math.max(0, entries.length - 1),
			);
			return;
		}

		if (key.downArrow) {
			setSelectedIndex(prev => (prev < entries.length - 1 ? prev + 1 : 0));
			return;
		}

		if (input === 'r' || input === 'R') {
			void refresh();
			return;
		}

		if (key.return || input === 'x' || input === 'X') {
			const target = entries[selectedIndex];
			if (!target) {
				return;
			}
			if (!target.stoppable) {
				setNotice(t.resourceManager.notStoppable);
				return;
			}
			if (pendingStopId === target.id) {
				setPendingStopId(null);
				stopEntry(target);
			} else {
				setPendingStopId(target.id);
			}
		}
	});

	const kindLabels: Record<EntryKind, string> = {
		main: t.resourceManager.kindMain,
		subagent: t.resourceManager.kindSubAgent,
		teammate: t.resourceManager.kindTeammate,
		child: t.resourceManager.kindChild,
		background: t.resourceManager.kindBackground,
	};

	const statusLabels: Record<EntryStatus, string> = {
		running: t.resourceManager.statusRunning,
		completed: t.resourceManager.statusCompleted,
		failed: t.resourceManager.statusFailed,
	};

	const statusColors: Record<EntryStatus, string> = {
		running: theme.colors.menuInfo as any,
		completed: theme.colors.success as any,
		failed: theme.colors.error as any,
	};

	const totalItems = entries.length;
	let scrollOffset = 0;
	if (totalItems > VISIBLE_ITEMS) {
		scrollOffset = Math.max(
			0,
			Math.min(
				selectedIndex - Math.floor(VISIBLE_ITEMS / 2),
				totalItems - VISIBLE_ITEMS,
			),
		);
	}
	const visibleEntries = entries.slice(
		scrollOffset,
		scrollOffset + VISIBLE_ITEMS,
	);
	const aboveCount = scrollOffset;
	const belowCount = Math.max(0, totalItems - scrollOffset - VISIBLE_ITEMS);

	const nameWidth = Math.max(18, terminalWidth - 48);

	const cpuColor = (percent: number | null): string => {
		if (percent === null) {
			return theme.colors.menuSecondary as any;
		}
		if (percent >= 50) {
			return theme.colors.error as any;
		}
		if (percent >= 20) {
			return theme.colors.warning as any;
		}
		return theme.colors.menuInfo as any;
	};

	return (
		<Box flexDirection="column" paddingX={1} width={terminalWidth}>
			<Box
				borderStyle="round"
				borderColor={theme.colors.menuInfo as any}
				paddingX={1}
				flexDirection="column"
				width={Math.max(20, terminalWidth - 2)}
			>
				<Box flexDirection="column">
					<Text color={theme.colors.menuInfo as any} bold>
						{t.resourceManager.title}
					</Text>
					<Text color={theme.colors.menuSecondary as any} dimColor>
						{t.resourceManager.subtitle} ·{' '}
						{t.resourceManager.processCount.replace(
							'{count}',
							String(totalItems),
						)}
					</Text>
				</Box>

				<Box marginTop={1} flexDirection="row">
					<Text color={theme.colors.menuSecondary as any} dimColor>
						{'  '}
						{padRight(t.resourceManager.columnName, nameWidth)}{' '}
						{padLeft(t.resourceManager.columnPid, 7)}{' '}
						{padLeft(t.resourceManager.columnCpu, 6)}{' '}
						{padLeft(t.resourceManager.columnMemory, 8)}
						{'  '}
						{t.resourceManager.columnStatus}
					</Text>
				</Box>

				{isLoading && totalItems === 0 ? (
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary as any} dimColor>
							{t.resourceManager.loading}
						</Text>
					</Box>
				) : totalItems === 0 ? (
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary as any} dimColor>
							{t.resourceManager.emptyHint}
						</Text>
					</Box>
				) : (
					<Box flexDirection="column">
						{visibleEntries.map((entry, index) => {
							const actualIndex = scrollOffset + index;
							const isSelected = actualIndex === selectedIndex;
							const kindLabel = kindLabels[entry.kind];
							const nameField = padRight(
								truncate(`[${kindLabel}] ${entry.name}`, nameWidth),
								nameWidth,
							);
							const pidField = padLeft(
								typeof entry.pid === 'number' ? String(entry.pid) : '-',
								7,
							);
							const cpuField = padLeft(formatCpuPercent(entry.cpuPercent), 6);
							const memField = padLeft(formatBytes(entry.memoryBytes), 8);
							const statusText = statusLabels[entry.status];
							const duration = entry.startedAt
								? formatDuration(
										entry.startedAt,
										entry.status === 'running' ? undefined : new Date(),
								  )
								: '';

							return (
								<Box key={entry.id} flexDirection="row">
									<Text
										color={
											isSelected
												? (theme.colors.menuSelected as any)
												: undefined
										}
										bold={isSelected}
									>
										{isSelected ? '❯ ' : '  '}
									</Text>
									<Text
										color={
											isSelected
												? (theme.colors.menuSelected as any)
												: undefined
										}
										bold={isSelected}
									>
										{nameField}
									</Text>
									<Text dimColor> {pidField} </Text>
									<Text color={cpuColor(entry.cpuPercent)}>{cpuField}</Text>
									<Text> </Text>
									<Text color={theme.colors.menuInfo as any}>{memField}</Text>
									<Text>{'  '}</Text>
									<Text color={statusColors[entry.status]}>{statusText}</Text>
									{duration ? <Text dimColor>{` ${duration}`}</Text> : null}
								</Box>
							);
						})}
					</Box>
				)}

				{(aboveCount > 0 || belowCount > 0) && (
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary as any} dimColor>
							{aboveCount > 0
								? t.resourceManager.moreAbove.replace(
										'{count}',
										String(aboveCount),
								  )
								: ''}
							{aboveCount > 0 && belowCount > 0 ? ' · ' : ''}
							{belowCount > 0
								? t.resourceManager.moreBelow.replace(
										'{count}',
										String(belowCount),
								  )
								: ''}
						</Text>
					</Box>
				)}

				<Box marginTop={1} flexDirection="column">
					{notice ? (
						<Text color={theme.colors.warning as any}>{notice}</Text>
					) : pendingStopId ? (
						<Text color={theme.colors.warning as any}>
							{t.resourceManager.stopConfirm}
						</Text>
					) : (
						<Text color={theme.colors.menuSecondary as any} dimColor>
							{t.resourceManager.navigationHint}
						</Text>
					)}
				</Box>
			</Box>
		</Box>
	);
}
