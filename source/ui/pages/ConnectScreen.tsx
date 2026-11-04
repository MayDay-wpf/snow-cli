import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import TextInput from 'ink-text-input';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {connectService} from '../../utils/connect/service.js';
import {maskSecret} from '../../utils/connect/store.js';
import {visualWidth} from '../../utils/core/textUtils.js';
import type {
	ConnectChannelId,
	ConnectConfig,
	ConnectSnapshot,
} from '../../utils/connect/types.js';

type Props = {
	onBack?: () => void;
	terminalWidth: number;
};

type FieldKind = 'toggle' | 'text' | 'secret';

type Field = {
	id: string;
	label: string;
	kind: FieldKind;
	value: string | boolean;
	display: string;
	set: (value: string | boolean) => void;
	hint?: string;
};

const STATUS_COLOR: Record<string, string> = {
	online: 'green',
	connecting: 'yellow',
	reconnecting: 'yellow',
	idle: 'gray',
	disabled: 'gray',
	error: 'red',
};

const MAX_VISIBLE_FIELDS = 8;
const MAX_LOG_LINES = 6;
const LOG_RESERVED_ROWS = 28;

function truncateToWidth(text: string, maxWidth: number): string {
	if (maxWidth <= 0) {
		return '';
	}

	if (visualWidth(text) <= maxWidth) {
		return text;
	}

	let result = '';
	for (const char of text) {
		if (visualWidth(result + char) > maxWidth - 1) {
			break;
		}

		result += char;
	}

	return `${result}…`;
}

function formatTime(value: number): string {
	if (!value) {
		return '-';
	}
	const date = new Date(value);
	const pad = (part: number) => String(part).padStart(2, '0');
	return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
		date.getSeconds(),
	)}`;
}

export default function ConnectScreen({onBack, terminalWidth}: Props) {
	const {t} = useI18n();
	useTerminalTitle(`Snow CLI - ${t.connectScreen.title}`);
	const {theme} = useTheme();

	const [activeTab, setActiveTab] = useState<ConnectChannelId>('telegram');
	const [snapshot, setSnapshot] = useState<ConnectSnapshot | null>(null);
	const [draft, setDraft] = useState<ConnectConfig | null>(null);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [editingField, setEditingField] = useState<string | null>(null);
	const [editValue, setEditValue] = useState('');
	const [message, setMessage] = useState('');
	const [loading, setLoading] = useState(true);
	const {stdout} = useStdout();
	const terminalHeight = stdout?.rows || 24;
	const [logScrollOffset, setLogScrollOffset] = useState(0);
	const maxLogLines = Math.max(
		1,
		Math.min(MAX_LOG_LINES, terminalHeight - LOG_RESERVED_ROWS),
	);
	const logs = snapshot?.state.logs ?? [];
	const maxLogScrollOffset = Math.max(0, logs.length - maxLogLines);

	useEffect(() => {
		setLogScrollOffset(prev => Math.min(prev, maxLogScrollOffset));
	}, [maxLogScrollOffset]);

	const refresh = useCallback(async () => {
		try {
			const next = await connectService.getSnapshot();
			setSnapshot(next);
			setDraft(prev => prev ?? next.config);
		} catch (error) {
			setMessage(
				t.connectScreen.loadFailed.replace(
					'{error}',
					error instanceof Error ? error.message : String(error),
				),
			);
		} finally {
			setLoading(false);
		}
	}, [t]);

	useEffect(() => {
		void connectService.start();
		void refresh();
		const timer = setInterval(() => {
			void refresh();
		}, 1000);
		return () => clearInterval(timer);
	}, [refresh]);

	const updateTelegram = useCallback(
		(patch: Partial<ConnectConfig['telegram']>) => {
			setDraft(prev =>
				prev ? {...prev, telegram: {...prev.telegram, ...patch}} : prev,
			);
		},
		[],
	);

	const updateFeishu = useCallback(
		(patch: Partial<ConnectConfig['feishu']>) => {
			setDraft(prev =>
				prev ? {...prev, feishu: {...prev.feishu, ...patch}} : prev,
			);
		},
		[],
	);

	const fields = useMemo<Field[]>(() => {
		if (!draft) {
			return [];
		}
		if (activeTab === 'telegram') {
			const config = draft.telegram;
			return [
				{
					id: 'tg-enabled',
					label: t.connectScreen.fieldEnableTelegram,
					kind: 'toggle',
					value: config.enabled,
					display: config.enabled
						? t.connectScreen.enabledStatus
						: t.connectScreen.disabledStatus,
					set: value => updateTelegram({enabled: Boolean(value)}),
				},
				{
					id: 'tg-token',
					label: t.connectScreen.fieldTelegramToken,
					kind: 'secret',
					value: config.token,
					display: config.token
						? maskSecret(config.token)
						: t.connectScreen.notConfigured,
					set: value => updateTelegram({token: String(value).trim()}),
					hint: t.connectScreen.fieldTelegramTokenHint,
				},
				{
					id: 'tg-base',
					label: t.connectScreen.fieldTelegramBaseUrl,
					kind: 'text',
					value: config.baseUrl,
					display: config.baseUrl || 'https://api.telegram.org',
					set: value => updateTelegram({baseUrl: String(value).trim()}),
				},
				{
					id: 'tg-allow-all',
					label: t.connectScreen.fieldAllowAllDirect,
					kind: 'toggle',
					value: config.allowAllDirect,
					display: config.allowAllDirect
						? t.connectScreen.yes
						: t.connectScreen.noWhitelistOnly,
					set: value => updateTelegram({allowAllDirect: Boolean(value)}),
				},
				{
					id: 'tg-allowed',
					label: t.connectScreen.fieldTelegramAllowedUsers,
					kind: 'text',
					value: config.allowedUserIds.join(', '),
					display:
						config.allowedUserIds.join(', ') || t.connectScreen.emptyList,
					set: value =>
						updateTelegram({
							allowedUserIds: String(value)
								.split(/[,\s，]+/)
								.map(part => part.trim())
								.filter(Boolean),
						}),
				},
				{
					id: 'tg-mention',
					label: t.connectScreen.fieldTelegramGroupMention,
					kind: 'toggle',
					value: config.groupRequireMention,
					display: config.groupRequireMention
						? t.connectScreen.yes
						: t.connectScreen.noGroupAllMessages,
					set: value => updateTelegram({groupRequireMention: Boolean(value)}),
				},
				{
					id: 'tg-approval',
					label: t.connectScreen.fieldForwardApprovals,
					kind: 'toggle',
					value: config.forwardApprovals,
					display: config.forwardApprovals
						? t.connectScreen.yes
						: t.connectScreen.noAutoApprove,
					set: value => updateTelegram({forwardApprovals: Boolean(value)}),
				},
			];
		}

		const config = draft.feishu;
		return [
			{
				id: 'fs-enabled',
				label: t.connectScreen.fieldEnableFeishu,
				kind: 'toggle',
				value: config.enabled,
				display: config.enabled
					? t.connectScreen.enabledStatus
					: t.connectScreen.disabledStatus,
				set: value => updateFeishu({enabled: Boolean(value)}),
			},
			{
				id: 'fs-app-id',
				label: t.connectScreen.fieldAppId,
				kind: 'text',
				value: config.appId,
				display: config.appId || t.connectScreen.notConfigured,
				set: value => updateFeishu({appId: String(value).trim()}),
			},
			{
				id: 'fs-secret',
				label: t.connectScreen.fieldAppSecret,
				kind: 'secret',
				value: config.appSecret,
				display: config.appSecret
					? maskSecret(config.appSecret)
					: t.connectScreen.notConfigured,
				set: value => updateFeishu({appSecret: String(value).trim()}),
				hint: t.connectScreen.fieldAppSecretHint,
			},
			{
				id: 'fs-domain',
				label: t.connectScreen.fieldFeishuDomain,
				kind: 'text',
				value: config.domain,
				display: config.domain || 'https://open.feishu.cn',
				set: value => updateFeishu({domain: String(value).trim()}),
			},
			{
				id: 'fs-allow-all',
				label: t.connectScreen.fieldAllowAllDirect,
				kind: 'toggle',
				value: config.allowAllDirect,
				display: config.allowAllDirect
					? t.connectScreen.yes
					: t.connectScreen.noWhitelistOnly,
				set: value => updateFeishu({allowAllDirect: Boolean(value)}),
			},
			{
				id: 'fs-allowed',
				label: t.connectScreen.fieldFeishuAllowedUsers,
				kind: 'text',
				value: config.allowedOpenIds.join(', '),
				display: config.allowedOpenIds.join(', ') || t.connectScreen.emptyList,
				set: value =>
					updateFeishu({
						allowedOpenIds: String(value)
							.split(/[,\s，]+/)
							.map(part => part.trim())
							.filter(Boolean),
					}),
			},
			{
				id: 'fs-mention',
				label: t.connectScreen.fieldFeishuGroupMention,
				kind: 'toggle',
				value: config.groupRequireMention,
				display: config.groupRequireMention
					? t.connectScreen.yes
					: t.connectScreen.noGroupAllMessages,
				set: value => updateFeishu({groupRequireMention: Boolean(value)}),
			},
			{
				id: 'fs-approval',
				label: t.connectScreen.fieldForwardApprovals,
				kind: 'toggle',
				value: config.forwardApprovals,
				display: config.forwardApprovals
					? t.connectScreen.yes
					: t.connectScreen.noAutoApprove,
				set: value => updateFeishu({forwardApprovals: Boolean(value)}),
			},
		];
	}, [activeTab, draft, updateFeishu, updateTelegram, t]);

	const globalFields = useMemo<Field[]>(() => {
		if (!draft) {
			return [];
		}
		return [
			{
				id: 'global-workdir',
				label: t.connectScreen.fieldWorkingDirectory,
				kind: 'text',
				value: draft.workingDirectory,
				display: draft.workingDirectory || process.cwd(),
				set: value =>
					setDraft(prev =>
						prev ? {...prev, workingDirectory: String(value).trim()} : prev,
					),
				hint: t.connectScreen.fieldWorkingDirectoryHint,
			},
			{
				id: 'global-push',
				label: t.connectScreen.fieldPushMode,
				kind: 'toggle',
				value: draft.pushMode === 'stream',
				display:
					draft.pushMode === 'stream'
						? t.connectScreen.streamMode
						: t.connectScreen.finalMode,
				set: value =>
					setDraft(prev =>
						prev ? {...prev, pushMode: value ? 'stream' : 'final'} : prev,
					),
			},
		];
	}, [draft, t]);

	const allFields = useMemo(
		() => [...fields, ...globalFields],
		[fields, globalFields],
	);

	useEffect(() => {
		setSelectedIndex(prev => Math.max(0, Math.min(prev, allFields.length - 1)));
	}, [allFields.length]);

	const fieldsDisplayWindow = useMemo(() => {
		const total = allFields.length;
		if (total <= MAX_VISIBLE_FIELDS) {
			return {
				items: allFields.map((field, index) => ({field, index})),
				startIndex: 0,
				endIndex: total,
			};
		}

		const half = Math.floor(MAX_VISIBLE_FIELDS / 2);
		let startIndex = Math.max(0, selectedIndex - half);
		let endIndex = Math.min(total, startIndex + MAX_VISIBLE_FIELDS);

		if (endIndex - startIndex < MAX_VISIBLE_FIELDS) {
			startIndex = Math.max(0, endIndex - MAX_VISIBLE_FIELDS);
		}

		return {
			items: allFields
				.slice(startIndex, endIndex)
				.map((field, offset) => ({field, index: startIndex + offset})),
			startIndex,
			endIndex,
		};
	}, [allFields, selectedIndex]);

	const hiddenAboveFields = fieldsDisplayWindow.startIndex;
	const hiddenBelowFields = Math.max(
		0,
		allFields.length - fieldsDisplayWindow.endIndex,
	);

	const startEditing = useCallback((field: Field) => {
		setEditingField(field.id);
		setEditValue(
			typeof field.value === 'boolean' ? '' : String(field.value ?? ''),
		);
		setMessage('');
	}, []);

	const commitEditing = useCallback(
		(field: Field) => {
			field.set(editValue);
			setEditingField(null);
			setEditValue('');
			setMessage(t.connectScreen.stagedHint);
		},
		[editValue, t],
	);

	useInput(
		(_input, key) => {
			if (key.escape) {
				setEditingField(null);
				setEditValue('');
				setMessage('');
				return;
			}
		},
		{isActive: Boolean(editingField)},
	);

	useInput(
		(input, key) => {
			if (key.escape || input === 'q' || input === 'Q') {
				onBack?.();
				return;
			}

			if (key.tab) {
				setActiveTab(prev => (prev === 'telegram' ? 'feishu' : 'telegram'));
				setSelectedIndex(0);
				setLogScrollOffset(0);
				return;
			}

			if (key.leftArrow || key.rightArrow) {
				setActiveTab(prev => (prev === 'telegram' ? 'feishu' : 'telegram'));
				setSelectedIndex(0);
				setLogScrollOffset(0);
				return;
			}

			if (key.pageUp) {
				setLogScrollOffset(prev =>
					Math.min(prev + maxLogLines, maxLogScrollOffset),
				);
				return;
			}

			if (key.pageDown) {
				setLogScrollOffset(prev => Math.max(0, prev - maxLogLines));
				return;
			}

			if (key.upArrow) {
				setSelectedIndex(prev =>
					prev > 0 ? prev - 1 : Math.max(0, allFields.length - 1),
				);
				return;
			}

			if (key.downArrow) {
				setSelectedIndex(prev => {
					const max = Math.max(0, allFields.length - 1);
					return prev < max ? prev + 1 : 0;
				});
				return;
			}

			const field = allFields[selectedIndex];
			if (!field) {
				return;
			}

			if (input === ' ') {
				if (field.kind === 'toggle') {
					field.set(!field.value);
					setMessage(t.connectScreen.stagedHint);
				}
				return;
			}

			if (key.return) {
				if (field.kind === 'toggle') {
					field.set(!field.value);
					setMessage(t.connectScreen.stagedHint);
				} else {
					startEditing(field);
				}
				return;
			}

			if (input === 's' || input === 'S') {
				void (async () => {
					if (!draft) {
						return;
					}
					try {
						await connectService.saveConfig(draft);
						await connectService.start();
						await connectService.refreshNow();
						setMessage(t.connectScreen.savedMessage);
						await refresh();
					} catch (error) {
						setMessage(
							t.connectScreen.saveFailed.replace(
								'{error}',
								error instanceof Error ? error.message : String(error),
							),
						);
					}
				})();
				return;
			}

			if (input === 'r' || input === 'R') {
				void (async () => {
					try {
						await connectService.restart();
						setMessage(t.connectScreen.restartedMessage);
						await refresh();
					} catch (error) {
						setMessage(
							t.connectScreen.restartFailed.replace(
								'{error}',
								error instanceof Error ? error.message : String(error),
							),
						);
					}
				})();
				return;
			}

			if (input === 'l' || input === 'L') {
				void (async () => {
					await connectService.clearLogs();
					setMessage(t.connectScreen.logsCleared);
					await refresh();
				})();
			}
		},
		{isActive: !editingField},
	);

	const channelState = snapshot?.state[activeTab];
	const bindings = Object.entries(snapshot?.runtime.bindings ?? {}).filter(
		([key]) => key.startsWith(`${activeTab}:`),
	);
	const statusKey = channelState?.status ?? 'idle';
	const statusColor = STATUS_COLOR[statusKey] ?? 'white';
	const statusLabels: Record<string, string> = {
		idle: t.connectScreen.statusIdle,
		online: t.connectScreen.statusOnline,
		connecting: t.connectScreen.statusConnecting,
		reconnecting: t.connectScreen.statusReconnecting,
		disabled: t.connectScreen.statusDisabled,
		error: t.connectScreen.statusError,
	};
	const statusText = statusLabels[statusKey] ?? statusKey;
	const editing = allFields.find(field => field.id === editingField) ?? null;
	const logWindowEnd = Math.max(0, logs.length - logScrollOffset);
	const logWindowStart = Math.max(0, logWindowEnd - maxLogLines);
	const visibleLogs = logs.slice(logWindowStart, logWindowEnd).reverse();
	const logLineWidth = Math.max(20, terminalWidth - 8);

	return (
		<Box
			flexDirection="column"
			width={Math.max(0, terminalWidth - 2)}
			borderStyle="round"
			borderColor={theme.colors.border}
			padding={1}
		>
			<Box>
				<Text bold color={theme.colors.menuInfo}>
					{t.connectScreen.title}
				</Text>
				<Text color="gray">
					{'  '}
					{t.connectScreen.subtitle}
				</Text>
			</Box>

			<Box marginTop={1}>
				{[
					{key: 'telegram' as const, label: t.connectScreen.tabTelegram},
					{key: 'feishu' as const, label: t.connectScreen.tabFeishu},
				].map(tab => {
					const isActive = tab.key === activeTab;
					return (
						<Box key={tab.key} marginRight={2}>
							<Text
								bold={isActive}
								color={
									isActive ? theme.colors.menuInfo : theme.colors.menuSecondary
								}
								dimColor={!isActive}
							>
								{isActive ? '▸ ' : '  '}
								{tab.label}
							</Text>
						</Box>
					);
				})}
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.connectScreen.tabHint}
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text>
					{t.connectScreen.statusLabel}
					<Text color={statusColor}>{statusText}</Text>
					{channelState?.detail ? (
						<Text color="gray"> {channelState.detail}</Text>
					) : null}
				</Text>
				<Text color="gray">
					{`${t.connectScreen.accountLabel}${channelState?.account || '-'}　${
						t.connectScreen.lastMessageLabel
					}${formatTime(channelState?.lastMessageAt ?? 0)}　${
						t.connectScreen.boundSessionsLabel
					}${bindings.length}`}
				</Text>
				<Text color="gray">
					{t.connectScreen.statsLine
						.replace('{received}', String(channelState?.stats.received ?? 0))
						.replace('{delivered}', String(channelState?.stats.delivered ?? 0))
						.replace('{denied}', String(channelState?.stats.denied ?? 0))
						.replace('{errors}', String(channelState?.stats.errors ?? 0))}
				</Text>
			</Box>

			<Box marginTop={1} flexDirection="column">
				{loading || !draft ? (
					<Text color="gray">{t.connectScreen.loadingConfig}</Text>
				) : (
					<>
						{allFields.length > MAX_VISIBLE_FIELDS ? (
							<Box marginBottom={1}>
								<Text color={theme.colors.menuSecondary} dimColor>
									{t.connectScreen.fieldsPosition
										.replace('{current}', String(selectedIndex + 1))
										.replace('{total}', String(allFields.length))}
									{hiddenAboveFields > 0
										? t.connectScreen.fieldsMoreAbove.replace(
												'{count}',
												String(hiddenAboveFields),
										  )
										: ''}
									{hiddenBelowFields > 0
										? t.connectScreen.fieldsMoreBelow.replace(
												'{count}',
												String(hiddenBelowFields),
										  )
										: ''}
								</Text>
							</Box>
						) : null}
						{fieldsDisplayWindow.items.map(({field, index}) => {
							const selected = index === selectedIndex;
							return (
								<Box key={field.id} flexDirection="column">
									<Box>
										<Text color={selected ? 'yellow' : 'white'} bold={selected}>
											{selected ? '❯ ' : '  '}
											{field.kind === 'toggle'
												? field.value
													? '[✓] '
													: '[ ] '
												: ''}
											{field.label}
											{t.connectScreen.fieldSeparator}
										</Text>
										{editingField === field.id ? (
											<TextInput
												value={editValue}
												onChange={setEditValue}
												onSubmit={() => commitEditing(field)}
												mask={field.kind === 'secret' ? '*' : undefined}
												placeholder={field.label}
											/>
										) : (
											<Text color="gray">{field.display}</Text>
										)}
									</Box>
									{selected && field.hint ? (
										<Text color="gray"> {field.hint}</Text>
									) : null}
								</Box>
							);
						})}
					</>
				)}
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Text color="gray">{t.connectScreen.controlsHint}</Text>
				{editing ? (
					<Text color="cyan">
						{t.connectScreen.editingLabel.replace('{label}', editing.label)}
					</Text>
				) : null}
				{message ? <Text color="cyan">{message}</Text> : null}
				{draft?.pushMode === 'stream' ? (
					<Text color="gray">{t.connectScreen.streamNotice}</Text>
				) : null}
			</Box>

			<Box marginTop={1} flexDirection="column">
				<Box>
					<Text bold color={theme.colors.menuInfo}>
						{t.connectScreen.logsTitle}
					</Text>
					{logs.length > 0 ? (
						<Text color={theme.colors.menuSecondary} dimColor>
							{'  '}
							{logWindowStart + 1}-{logWindowEnd}/{logs.length}
							{logs.length > maxLogLines
								? `　${t.connectScreen.logsScrollHint}`
								: ''}
						</Text>
					) : null}
				</Box>
				{visibleLogs.map((entry, index) => (
					<Text
						key={`${entry.at}-${index}`}
						color={
							entry.level === 'error'
								? 'red'
								: entry.level === 'warn'
								? 'yellow'
								: 'gray'
						}
					>
						{truncateToWidth(
							`${formatTime(entry.at)} [${entry.channel}] ${entry.text}`,
							logLineWidth,
						)}
					</Text>
				))}
				{logs.length === 0 ? (
					<Text color="gray">{t.connectScreen.noLogs}</Text>
				) : null}
			</Box>
		</Box>
	);
}
