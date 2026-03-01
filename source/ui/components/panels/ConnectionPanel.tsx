import React, {useState, useCallback, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {
	connectionManager,
	type ConnectionConfig,
	type ConnectionStatus,
} from '../../../utils/connection/ConnectionManager.js';

interface Props {
	onClose: () => void;
	initialApiUrl?: string;
}

export const ConnectionPanel: React.FC<Props> = ({onClose, initialApiUrl}) => {
	const {theme} = useTheme();
	const {t} = useI18n();
	const cp = t.connectionPanel;

	// Form fields
	const [apiUrl, setApiUrl] = useState(
		initialApiUrl || 'http://localhost:5136/api',
	);
	const [username, setUsername] = useState('');
	const [password, setPassword] = useState('');
	const [instanceId, setInstanceId] = useState('');
	const [instanceName, setInstanceName] = useState('');

	// UI state
	const [step, setStep] = useState<
		'url' | 'auth' | 'instance' | 'connecting' | 'connected' | 'saved'
	>('url');
	const [focus, setFocus] = useState<'username' | 'password' | 'id' | 'name'>(
		'username',
	);
	const [status, setStatus] = useState<ConnectionStatus>('disconnected');
	const [statusMessage, setStatusMessage] = useState('');
	const [isStatusError, setIsStatusError] = useState(false);
	const [isProcessing, setIsProcessing] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	// Load saved connection config on mount
	useEffect(() => {
		const savedConfig = connectionManager.loadConnectionConfig();
		if (savedConfig) {
			setApiUrl(savedConfig.apiUrl);
			setUsername(savedConfig.username);
			setPassword(savedConfig.password);
			setInstanceId(savedConfig.instanceId);
			setInstanceName(savedConfig.instanceName);
			// If not connected, show saved config step
			const currentState = connectionManager.getState();
			if (currentState.status !== 'connected') {
				setStep('saved');
			}
		}
	}, []);

	// Subscribe to connection status
	useEffect(() => {
		const unsubscribe = connectionManager.onStatusChange(state => {
			setStatus(state.status);
			// Sync form fields with current connection state
			if (state.instanceId) setInstanceId(state.instanceId);
			if (state.instanceName) setInstanceName(state.instanceName);
			if (state.error) {
				setStatusMessage(`${cp.errorPrefix}${state.error}`);
				setIsStatusError(true);
			}
		});
		return unsubscribe;
	}, []);

	// Handle keyboard input
	useInput(
		(input, key) => {
			if (key.escape) {
				// If confirming delete, cancel it
				if (confirmingDelete) {
					setConfirmingDelete(false);
					return;
				}

				// Navigate back to previous step based on current step
				if (step === 'auth') {
					// If on password field, go back to username field first
					if (focus === 'password') {
						setFocus('username');
						return;
					}
					setStep('url');
					setStatusMessage('');
					return;
				}

				if (step === 'instance') {
					// If on name field, go back to id field first
					if (focus === 'name') {
						setFocus('id');
						return;
					}
					setStep('auth');
					setFocus('password');
					setStatusMessage('');
					return;
				}

				// Only close panel, never disconnect here
				// Disconnect is handled by the disconnect command only
				onClose();
				return;
			}

			// Handle 'd' key for deleting saved config (with confirmation)
			if (input.toLowerCase() === 'd' && step === 'saved') {
				if (!confirmingDelete) {
					// First press: enter confirmation mode
					setConfirmingDelete(true);
					return;
				} else {
					// Second press: confirm deletion
					connectionManager.clearSavedConnection();
					setConfirmingDelete(false);
					setStep('url');
					setApiUrl(initialApiUrl || 'http://localhost:5136/api');
					setUsername('');
					setPassword('');
					setInstanceId('');
					setInstanceName('');
					return;
				}
			}

			// Any other key cancels delete confirmation
			if (confirmingDelete) {
				setConfirmingDelete(false);
				return;
			}

			// Handle arrow keys for navigation between fields
			if (step === 'auth') {
				if (key.upArrow || key.downArrow) {
					setFocus(prev => (prev === 'username' ? 'password' : 'username'));
					return;
				}
			}

			if (step === 'instance') {
				if (key.upArrow || key.downArrow) {
					setFocus(prev => (prev === 'id' ? 'name' : 'id'));
					return;
				}
			}

			if (key.return) {
				void handleSubmit();
			}
		},
		{isActive: true},
	);

	const handleSubmit = useCallback(async () => {
		if (isProcessing) return;

		// Handle saved config step - start connection directly
		if (step === 'saved') {
			setStep('auth');
			setFocus('username');
			return;
		}

		if (step === 'url') {
			if (apiUrl.trim()) {
				setStep('auth');
				setFocus('username');
			}
			return;
		}

		if (step === 'auth') {
			if (focus === 'username' && username.trim()) {
				setFocus('password');
				return;
			}
			if (focus === 'password' && password.trim()) {
				// Try to login
				setIsProcessing(true);
				setIsStatusError(false);
				setStatusMessage(cp.loggingIn);

				const config: ConnectionConfig = {
					apiUrl: apiUrl.trim(),
					username: username.trim(),
					password: password.trim(),
					instanceId: '',
					instanceName: '',
				};

				const result = await connectionManager.login(config);
				setIsProcessing(false);

				if (result.success) {
					setIsStatusError(false);
					setStatusMessage(result.message);
					setStep('instance');
					setFocus('id');
				} else {
					setIsStatusError(true);
					setStatusMessage(result.message);
				}
			}
			return;
		}

		if (step === 'instance') {
			if (focus === 'id' && instanceId.trim()) {
				setFocus('name');
				return;
			}
			if (focus === 'name' && instanceName.trim()) {
				// Try to connect
				setIsProcessing(true);
				setIsStatusError(false);
				setStep('connecting');
				setStatusMessage(cp.connectingToHub);

				const config: ConnectionConfig = {
					apiUrl: apiUrl.trim(),
					username: username.trim(),
					password: password.trim(),
					instanceId: instanceId.trim(),
					instanceName: instanceName.trim(),
				};

				// Update config and connect
				const loginResult = await connectionManager.login(config);
				if (!loginResult.success) {
					setIsProcessing(false);
					setStep('instance');
					setIsStatusError(true);
					setStatusMessage(loginResult.message);
					return;
				}

				const connectResult = await connectionManager.connect();
				setIsProcessing(false);

				if (connectResult.success) {
					// Save connection config
					await connectionManager.saveConnectionConfig(config);
					setStep('connected');
					setIsStatusError(false);
					setStatusMessage(cp.connectedSuccessfully);
				} else {
					setStep('instance');
					setIsStatusError(true);
					setStatusMessage(connectResult.message);
				}
			}
			return;
		}

		if (step === 'connected') {
			onClose();
		}
	}, [
		step,
		focus,
		isProcessing,
		apiUrl,
		username,
		password,
		instanceId,
		instanceName,
		onClose,
	]);

	// Status color helper
	const getStatusColor = (s: ConnectionStatus) => {
		switch (s) {
			case 'connected':
				return theme.colors.success;
			case 'connecting':
				return theme.colors.warning;
			default:
				return theme.colors.error;
		}
	};

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuSelected}>
					{cp.title}
				</Text>
			</Box>

			{/* Connection Status */}
			<Box marginBottom={1}>
				<Text color={theme.colors.text}>{cp.statusLabel} </Text>
				<Text color={getStatusColor(status)} bold>
					{status === 'connected'
						? cp.statusConnected
						: status === 'connecting'
						? cp.statusConnecting
						: cp.statusDisconnected}
				</Text>
			</Box>

			{/* Step 0: Saved Config - Show when there's a saved config */}
			{step === 'saved' && status !== 'connected' && (
				<Box flexDirection="column">
					<Box marginBottom={0}>
						<Text color={theme.colors.success}>{cp.savedConfigFound}</Text>
					</Box>
					<Box marginBottom={0}>
						<Text color={theme.colors.text}>
							{cp.apiUrlLabel} {apiUrl}
						</Text>
					</Box>
					<Box marginBottom={0}>
						<Text color={theme.colors.text}>
							{cp.usernameLabel} {username}
						</Text>
					</Box>
					<Box marginBottom={0}>
						<Text color={theme.colors.text}>
							{cp.instanceLabel} {instanceName} ({instanceId})
						</Text>
					</Box>
					<Box marginTop={0}>
						<Text dimColor>{cp.savedConfigHint}</Text>
					</Box>
					{confirmingDelete ? (
						<Box marginTop={0}>
							<Text color={theme.colors.warning}>
								{cp.confirmDeletePrefix}{' '}
								<Text color={theme.colors.error}>D</Text>{' '}
								{cp.confirmDeleteSuffix}
							</Text>
						</Box>
					) : (
						<Box marginTop={0}>
							<Text dimColor>
								{cp.clearSavedPrefix}{' '}
								<Text color={theme.colors.warning}>D</Text>{' '}
								{cp.clearSavedSuffix}
							</Text>
						</Box>
					)}
				</Box>
			)}

			{/* Step 1: API URL - Only show when disconnected */}
			{step === 'url' && status !== 'connected' && (
				<Box flexDirection="column">
					<Box marginBottom={0}>
						<Text color={theme.colors.text}>{cp.apiBaseUrlLabel}</Text>
					</Box>
					<TextInput
						placeholder={cp.apiBaseUrlPlaceholder}
						value={apiUrl}
						onChange={setApiUrl}
						onSubmit={() => void handleSubmit()}
					/>
					<Box>
						<Text dimColor>{cp.enterContinueEscCancel}</Text>
					</Box>
				</Box>
			)}

			{/* Step 2: Authentication - Only show when disconnected */}
			{step === 'auth' && status !== 'connected' && (
				<Box flexDirection="column">
					<Box marginBottom={0}>
						<Text color={theme.colors.text}>{cp.authenticationTitle}</Text>
					</Box>
					<Box marginBottom={0}>
						<Text color={theme.colors.text}>
							{cp.apiUrlLabel} {apiUrl}
						</Text>
					</Box>

					<Box>
						<Text
							color={
								focus === 'username'
									? theme.colors.menuSelected
									: theme.colors.text
							}
						>
							{cp.usernameFieldLabel}
							{focus === 'username' && (
								<TextInput
									placeholder={cp.usernamePlaceholder}
									value={username}
									onChange={setUsername}
									onSubmit={() => void handleSubmit()}
									focus={true}
								/>
							)}
							{focus !== 'username' && (
								<Text color={theme.colors.success}>{username}</Text>
							)}
						</Text>
					</Box>

					<Box>
						<Text
							color={
								focus === 'password'
									? theme.colors.menuSelected
									: theme.colors.text
							}
						>
							{cp.passwordFieldLabel}
							{focus === 'password' && (
								<TextInput
									placeholder={cp.passwordPlaceholder}
									value={password}
									onChange={setPassword}
									onSubmit={() => void handleSubmit()}
									mask="*"
									focus={true}
								/>
							)}
							{focus !== 'password' && password && (
								<Text color={theme.colors.success}>********</Text>
							)}
						</Text>
					</Box>

					{statusMessage && (
						<Box>
							<Text
								color={
									isStatusError ? theme.colors.error : theme.colors.success
								}
							>
								{statusMessage}
							</Text>
						</Box>
					)}

					<Box>
						<Text dimColor>{cp.enterContinueEscBack}</Text>
					</Box>
				</Box>
			)}

			{/* Step 3: Instance Info - Only show when disconnected */}
			{step === 'instance' && status !== 'connected' && (
				<Box flexDirection="column">
					<Box marginBottom={0}>
						<Text color={theme.colors.text}>{cp.instanceConfigTitle}</Text>
					</Box>
					<Box marginBottom={0}>
						<Text color={theme.colors.success}>
							{cp.loggedInAs} {username}
						</Text>
					</Box>

					<Box>
						<Text
							color={
								focus === 'id' ? theme.colors.menuSelected : theme.colors.text
							}
						>
							{cp.instanceIdLabel}
							{focus === 'id' && (
								<TextInput
									placeholder={cp.instanceIdPlaceholder}
									value={instanceId}
									onChange={setInstanceId}
									onSubmit={() => void handleSubmit()}
									focus={true}
								/>
							)}
							{focus !== 'id' && (
								<Text color={theme.colors.success}>{instanceId}</Text>
							)}
						</Text>
					</Box>

					<Box>
						<Text
							color={
								focus === 'name' ? theme.colors.menuSelected : theme.colors.text
							}
						>
							{cp.instanceNameLabel}
							{focus === 'name' && (
								<TextInput
									placeholder={cp.instanceNamePlaceholder}
									value={instanceName}
									onChange={setInstanceName}
									onSubmit={() => void handleSubmit()}
									focus={true}
								/>
							)}
							{focus !== 'name' && instanceName && (
								<Text color={theme.colors.success}>{instanceName}</Text>
							)}
						</Text>
					</Box>

					{statusMessage && (
						<Box>
							<Text
								color={
									isStatusError ? theme.colors.error : theme.colors.success
								}
							>
								{statusMessage}
							</Text>
						</Box>
					)}

					<Box>
						<Text dimColor>{cp.enterConnectEscBack}</Text>
					</Box>
				</Box>
			)}

			{/* Step 4: Connecting - Only show when disconnected */}
			{step === 'connecting' && status !== 'connected' && (
				<Box flexDirection="column">
					<Box marginBottom={0}>
						<Text>
							<Spinner type="dots" /> {statusMessage}
						</Text>
					</Box>
					<Box>
						<Text dimColor>{cp.pleaseWait}</Text>
					</Box>
				</Box>
			)}

			{/* Step 5: Connected - Only show status, no input capability */}
			{(step === 'connected' || status === 'connected') && (
				<Box flexDirection="column">
					<Box marginBottom={0}>
						<Text color={theme.colors.success}>
							{cp.connectedSuccessfullyWithIcon}
						</Text>
					</Box>
					<Box marginBottom={0}>
						<Text color={theme.colors.text}>
							{cp.instanceLabel} {instanceName} ({instanceId})
						</Text>
					</Box>
					<Box>
						<Text dimColor>{cp.pressEscToClose}</Text>
					</Box>
					<Box>
						<Text dimColor>
							{cp.useCommandPrefix}{' '}
							<Text color={theme.colors.menuSelected}>/disconnect</Text>{' '}
							{cp.useCommandSuffix}
						</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
};

export default ConnectionPanel;
