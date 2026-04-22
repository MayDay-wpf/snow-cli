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
}

export const IdeSelectPanel: React.FC<Props> = ({
	visible,
	onClose,
	onConnectionChange,
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

	// Options: matched IDEs + "None"
	const options = useMemo(() => {
		const items = matched.map((ide, index) => {
			const isCurrent = isConnected && ide.port === currentPort;
			return {
				label: `${index + 1}. ${ide.name}${isCurrent ? t.ideSelectPanel.connectedMark : ''}`,
				value: `ide-${index}`,
				port: ide.port,
				ideName: ide.name,
				workspace: ide.workspace,
				isCurrent,
			};
		});
		items.push({
			label: `${matched.length + 1}. ${t.ideSelectPanel.noneOption}`,
			value: 'none',
			port: 0,
			ideName: '',
			workspace: '',
			isCurrent: !isConnected,
		});
		return items;
	}, [matched, isConnected, currentPort, t]);

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
				setSelectedIndex(prev =>
					prev > 0 ? prev - 1 : options.length - 1,
				);
				return;
			}

			if (key.downArrow) {
				setSelectedIndex(prev =>
					prev < options.length - 1 ? prev + 1 : 0,
				);
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
				<Text color={theme.colors.menuInfo}>
					{t.ideSelectPanel.subtitle}
				</Text>
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
						<Box key={option.value}>
							<Text
								color={
									index === selectedIndex
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{index === selectedIndex ? '❯ ' : '  '}
								{option.label}
							</Text>
						</Box>
					))}
				</Box>
			)}

			{unmatched.length > 0 && !connecting && (
				<Box flexDirection="column" marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.ideSelectPanel.unmatchedIDEs.replace(
							'{count}',
							String(unmatched.length),
						)}
					</Text>
					{unmatched.map((ide, i) => (
						<Text key={i} color={theme.colors.menuSecondary} dimColor>
							{'   • '}
							{ide.name}: {ide.workspace}
						</Text>
					))}
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
