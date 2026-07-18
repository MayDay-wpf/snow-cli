import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/index.js';
import {
	vscodeConnection,
	type IDEInfo,
} from '../../../utils/ui/vscodeConnection.js';

interface Props {
	visible: boolean;
	onClose: () => void;
	onConnectionChange: (
		status: 'connected' | 'disconnected',
		message?: string,
	) => void;
	/**
	 * Notify parent that the working directory has been changed via process.chdir().
	 * Parent should remount static UI (e.g. ChatHeader) to reflect the new cwd.
	 */
	onWorkingDirectoryChanged?: (newCwd: string) => void;
}

interface OptionItem {
	label: string;
	value: string;
	port: number;
	ideName: string;
	workspace: string;
	isCurrent: boolean;
	// When true, selecting this option will chdir to its workspace before connecting
	switchWorkdir: boolean;
	// Section divider rendered above this option
	sectionHeader?: string;
}

export const IdeSelectPanel: React.FC<Props> = ({
	visible,
	onClose,
	onConnectionChange,
	onWorkingDirectoryChanged,
}) => {
	const {theme} = useTheme();
	const {t} = useI18n();

	const [selectedIndex, setSelectedIndex] = useState(0);
	const [connecting, setConnecting] = useState(false);

	const {matched, unmatched} = useMemo(() => {
		if (!visible) return {matched: [] as IDEInfo[], unmatched: [] as IDEInfo[]};
		return vscodeConnection.getAvailableIDEs();
	}, [visible]);

	const currentPort = vscodeConnection.getPort();
	const isConnected = vscodeConnection.isConnected();

	// Options: matched IDEs + "None" + unmatched IDEs (switch cwd)
	const options = useMemo<OptionItem[]>(() => {
		const items: OptionItem[] = [];
		let displayIndex = 0;

		matched.forEach(ide => {
			displayIndex++;
			const isCurrent = isConnected && ide.port === currentPort;
			items.push({
				label: `${displayIndex}. ${ide.name}${
					isCurrent ? t.ideSelectPanel.connectedMark : ''
				}`,
				value: `ide-${displayIndex}`,
				port: ide.port,
				ideName: ide.name,
				workspace: ide.workspace,
				isCurrent,
				switchWorkdir: false,
			});
		});

		displayIndex++;
		items.push({
			label: `${displayIndex}. ${t.ideSelectPanel.noneOption}`,
			value: 'none',
			port: 0,
			ideName: '',
			workspace: '',
			isCurrent: !isConnected,
			switchWorkdir: false,
		});

		unmatched.forEach((ide, i) => {
			displayIndex++;
			items.push({
				label: `${displayIndex}. ${ide.name} (${ide.workspace})${t.ideSelectPanel.switchWorkdirMark}`,
				value: `unmatched-${i}`,
				port: ide.port,
				ideName: ide.name,
				workspace: ide.workspace,
				isCurrent: false,
				switchWorkdir: true,
				sectionHeader: i === 0 ? t.ideSelectPanel.unmatchedHeader : undefined,
			});
		});

		return items;
	}, [matched, unmatched, isConnected, currentPort, t]);

	useEffect(() => {
		if (!visible) return;
		setSelectedIndex(0);
		setConnecting(false);
	}, [visible]);

	const handleSelect = useCallback(
		async (index: number) => {
			const option = options[index];
			if (!option || connecting) return;

			if (option.value === 'none') {
				if (isConnected) {
					vscodeConnection.stop();
					vscodeConnection.resetReconnectAttempts();
					vscodeConnection.setUserDisconnected(true);
					onConnectionChange('disconnected');
				}
				onClose();
				return;
			}

			if (option.isCurrent) {
				onClose();
				return;
			}

			setConnecting(true);

			// If this option requires switching the working directory, do it first
			if (option.switchWorkdir && option.workspace) {
				try {
					process.chdir(option.workspace);
					const newCwd = process.cwd();
					vscodeConnection.setCurrentWorkingDirectory(newCwd);
					onWorkingDirectoryChanged?.(newCwd);
				} catch (error) {
					const errorMsg =
						error instanceof Error ? error.message : 'Unknown error';
					onConnectionChange(
						'disconnected',
						t.ideSelectPanel.switchWorkdirError.replace('{error}', errorMsg),
					);
					setConnecting(false);
					return;
				}
			}

			try {
				await vscodeConnection.connectToPort(option.port);
				const label = `${option.ideName} (${option.workspace})`;
				onConnectionChange(
					'connected',
					t.ideSelectPanel.connectSuccess.replace('{label}', label),
				);
				onClose();
			} catch (error) {
				const errorMsg =
					error instanceof Error ? error.message : 'Unknown error';
				onConnectionChange(
					'disconnected',
					t.ideSelectPanel.connectError.replace('{error}', errorMsg),
				);
				setConnecting(false);
			}
		},
		[options, connecting, isConnected, onConnectionChange, onClose, t],
	);

	useInput(
		(input, key) => {
			if (!visible || connecting) return;

			if (key.escape) {
				onClose();
				return;
			}

			if (key.upArrow) {
				setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
				return;
			}

			if (key.downArrow) {
				setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
				return;
			}

			if (key.return) {
				void handleSelect(selectedIndex);
				return;
			}

			// Number shortcuts
			const num = parseInt(input, 10);
			if (num >= 1 && num <= options.length) {
				void handleSelect(num - 1);
			}
		},
		{isActive: visible},
	);

	if (!visible) return null;

	return (
		<Box flexDirection="column" paddingX={1} paddingY={0}>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.warning}>
					{t.ideSelectPanel.title}
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text color={theme.colors.menuInfo}>{t.ideSelectPanel.subtitle}</Text>
			</Box>

			{connecting ? (
				<Box>
					<Spinner type="dots" />
					<Text color={theme.colors.menuInfo}>
						{' '}
						{t.ideSelectPanel.connecting}
					</Text>
				</Box>
			) : (
				<Box flexDirection="column">
					{options.map((option, index) => (
						<React.Fragment key={option.value}>
							{option.sectionHeader && (
								<Box marginTop={1}>
									<Text color={theme.colors.menuSecondary} dimColor>
										{option.sectionHeader}
									</Text>
								</Box>
							)}
							<Box>
								<Text
									color={
										index === selectedIndex
											? theme.colors.menuSelected
											: option.switchWorkdir
											? theme.colors.menuSecondary
											: theme.colors.menuNormal
									}
								>
									{index === selectedIndex ? '❯ ' : '  '}
									{option.label}
								</Text>
							</Box>
						</React.Fragment>
					))}
				</Box>
			)}

			{unmatched.length > 0 && !connecting && (
				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.ideSelectPanel.unmatchedIDEs.replace(
							'{count}',
							String(unmatched.length),
						)}
					</Text>
				</Box>
			)}

			{!connecting && (
				<Box marginTop={1}>
					<Text dimColor color={theme.colors.menuSecondary}>
						{t.ideSelectPanel.hint}
					</Text>
				</Box>
			)}
		</Box>
	);
};
