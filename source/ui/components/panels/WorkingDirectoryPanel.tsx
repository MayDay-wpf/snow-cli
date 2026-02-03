import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getWorkingDirectories,
	removeWorkingDirectories,
	addWorkingDirectory,
	addSSHWorkingDirectory,
	type WorkingDirectory,
	type SSHConfig,
} from '../../../utils/config/workingDirConfig.js';
import {SSHClient} from '../../../utils/ssh/sshClient.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';

type Props = {
	onClose: () => void;
};

type SSHAuthMethod = 'password' | 'privateKey' | 'agent';

type SSHFormState = {
	host: string;
	port: string;
	username: string;
	authMethod: SSHAuthMethod;
	password: string;
	privateKeyPath: string;
	remotePath: string;
};

type SSHFormField =
	| 'host'
	| 'port'
	| 'username'
	| 'authMethod'
	| 'password'
	| 'privateKeyPath'
	| 'remotePath';

export default function WorkingDirectoryPanel({onClose}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [directories, setDirectories] = useState<WorkingDirectory[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [markedDirs, setMarkedDirs] = useState<Set<string>>(new Set());
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [addingMode, setAddingMode] = useState(false);
	const [newDirPath, setNewDirPath] = useState('');
	const [addError, setAddError] = useState<string | null>(null);
	const [showDefaultAlert, setShowDefaultAlert] = useState(false);

	// SSH form state
	const [sshMode, setSSHMode] = useState(false);
	const [sshForm, setSSHForm] = useState<SSHFormState>({
		host: '',
		port: '22',
		username: '',
		authMethod: 'privateKey',
		password: '',
		privateKeyPath: '~/.ssh/id_rsa',
		remotePath: '/home',
	});
	const [sshActiveField, setSSHActiveField] = useState<SSHFormField>('host');
	const [sshConnecting, setSSHConnecting] = useState(false);
	const [sshMessage, setSSHMessage] = useState<{
		type: 'success' | 'error';
		text: string;
	} | null>(null);

	// Ref to hold latest sshForm value for use in callbacks
	const sshFormRef = useRef<SSHFormState>(sshForm);

	// Load directories on mount
	useEffect(() => {
		const loadDirs = async () => {
			setLoading(true);
			try {
				const dirs = await getWorkingDirectories();
				setDirectories(dirs);
			} catch (error) {
				console.error('Failed to load working directories:', error);
				setDirectories([]);
			} finally {
				setLoading(false);
			}
		};

		void loadDirs();
	}, []);

	// Auto-hide default alert after 3 seconds
	useEffect(() => {
		if (showDefaultAlert) {
			const timer = setTimeout(() => {
				setShowDefaultAlert(false);
			}, 2000);
			return () => clearTimeout(timer);
		}
		return undefined; // Return undefined when alert is not shown
	}, [showDefaultAlert]);

	// Handle keyboard input
	useInput(
		useCallback(
			(input, key) => {
				// Don't handle keys if in adding mode (TextInput will handle them)
				if (addingMode) {
					if (key.escape) {
						setAddingMode(false);
						setNewDirPath('');
						setAddError(null);
					}
					return;
				}

				// SSH mode - handle navigation and auth method switching
				if (sshMode) {
					if (key.escape) {
						setSSHMode(false);
						setSSHMessage(null);
						setSSHForm({
							host: '',
							port: '22',
							username: '',
							authMethod: 'privateKey',
							password: '',
							privateKeyPath: '~/.ssh/id_rsa',
							remotePath: '/home',
						});
						setSSHActiveField('host');
						return;
					}

					// Handle arrow keys for field navigation in SSH mode
					if (key.upArrow || key.downArrow) {
						const visibleFields: SSHFormField[] = [
							'host',
							'port',
							'username',
							'authMethod',
						];
						if (sshForm.authMethod === 'password') {
							visibleFields.push('password');
						} else if (sshForm.authMethod === 'privateKey') {
							visibleFields.push('privateKeyPath');
						}
						visibleFields.push('remotePath');

						const currentIndex = visibleFields.indexOf(sshActiveField);
						if (key.upArrow && currentIndex > 0) {
							setSSHActiveField(visibleFields[currentIndex - 1]!);
						} else if (
							key.downArrow &&
							currentIndex < visibleFields.length - 1
						) {
							setSSHActiveField(visibleFields[currentIndex + 1]!);
						}
						return;
					}

					// Handle left/right arrows for auth method cycling
					if (
						sshActiveField === 'authMethod' &&
						(key.leftArrow || key.rightArrow)
					) {
						const methods: SSHAuthMethod[] = [
							'password',
							'privateKey',
							'agent',
						];
						const methodIndex = methods.indexOf(sshForm.authMethod);
						let nextMethodIndex: number;
						if (key.rightArrow) {
							nextMethodIndex = (methodIndex + 1) % methods.length;
						} else {
							nextMethodIndex =
								(methodIndex - 1 + methods.length) % methods.length;
						}
						const newForm = {...sshForm, authMethod: methods[nextMethodIndex]!};
						setSSHForm(newForm);
						sshFormRef.current = newForm;
						return;
					}

					return;
				}

				// If in delete confirmation mode - check before main ESC handler
				if (confirmDelete) {
					if (key.escape) {
						setConfirmDelete(false);
						return;
					}
					if (input.toLowerCase() === 'y') {
						// Confirm delete
						const pathsToDelete = Array.from(markedDirs);
						removeWorkingDirectories(pathsToDelete)
							.then(() => {
								// Reload directories
								return getWorkingDirectories();
							})
							.then(dirs => {
								setDirectories(dirs);
								setMarkedDirs(new Set());
								setConfirmDelete(false);
								setSelectedIndex(0);
							})
							.catch(error => {
								console.error('Failed to delete directories:', error);
								setConfirmDelete(false);
							});
					} else if (input.toLowerCase() === 'n') {
						// Cancel delete
						setConfirmDelete(false);
					}
					return;
				}

				// ESC to close - only when not in any sub-mode
				if (key.escape) {
					onClose();
					return;
				}

				// Up arrow - move selection up
				if (key.upArrow) {
					setSelectedIndex(prev => Math.max(0, prev - 1));
					return;
				}

				// Down arrow - move selection down
				if (key.downArrow) {
					setSelectedIndex(prev => Math.min(directories.length - 1, prev + 1));
					return;
				}

				// Space - toggle mark
				if (input === ' ' && directories.length > 0) {
					const currentDir = directories[selectedIndex];
					if (currentDir) {
						if (currentDir.isDefault) {
							// Show alert for default directory
							setShowDefaultAlert(true);
						} else {
							// Toggle mark for non-default directories
							setMarkedDirs(prev => {
								const newSet = new Set(prev);
								if (newSet.has(currentDir.path)) {
									newSet.delete(currentDir.path);
								} else {
									newSet.add(currentDir.path);
								}
								return newSet;
							});
						}
					}
					return;
				}

				// D key - delete marked directories
				if (input.toLowerCase() === 'd' && markedDirs.size > 0) {
					setConfirmDelete(true);
					return;
				}

				// A key - add new directory
				if (input.toLowerCase() === 'a') {
					setAddingMode(true);
					setAddError(null);
					return;
				}

				// S key - add SSH remote directory
				if (input.toLowerCase() === 's') {
					setSSHMode(true);
					setSSHMessage(null);
					return;
				}
			},
			[
				directories,
				selectedIndex,
				markedDirs,
				confirmDelete,
				addingMode,
				sshMode,
				sshActiveField,
				sshForm.authMethod,
				showDefaultAlert,
				onClose,
			],
		),
	);

	// Handle add directory submission
	const handleAddSubmit = async () => {
		if (!newDirPath.trim()) {
			setAddError(t.workingDirectoryPanel.addErrorEmpty);
			return;
		}

		const added = await addWorkingDirectory(newDirPath.trim());
		if (added) {
			// Reload directories
			const dirs = await getWorkingDirectories();
			setDirectories(dirs);
			setAddingMode(false);
			setNewDirPath('');
			setAddError(null);
		} else {
			setAddError(t.workingDirectoryPanel.addErrorFailed);
		}
	};

	// Handle SSH form submission
	const handleSSHSubmit = async () => {
		const form = sshFormRef.current;
		if (!form.host.trim() || !form.username.trim()) {
			setSSHMessage({
				type: 'error',
				text: t.workingDirectoryPanel.addErrorEmpty,
			});
			return;
		}

		setSSHConnecting(true);
		setSSHMessage(null);

		const sshConfig: SSHConfig = {
			host: form.host.trim(),
			port: parseInt(form.port, 10) || 22,
			username: form.username.trim(),
			authMethod: form.authMethod,
			privateKeyPath:
				form.authMethod === 'privateKey' ? form.privateKeyPath : undefined,
			password: form.authMethod === 'password' ? form.password : undefined,
		};

		const client = new SSHClient();
		const password = form.authMethod === 'password' ? form.password : undefined;

		try {
			const result = await client.testConnection(sshConfig, password);

			if (result.success) {
				// Add SSH directory
				const added = await addSSHWorkingDirectory(
					sshConfig,
					form.remotePath.trim() || '/',
				);

				if (added) {
					setSSHMessage({
						type: 'success',
						text: t.workingDirectoryPanel.sshAddSuccess,
					});
					// Reload directories
					const dirs = await getWorkingDirectories();
					setDirectories(dirs);
					// Reset form after short delay
					setTimeout(() => {
						setSSHMode(false);
						setSSHMessage(null);
						setSSHForm({
							host: '',
							port: '22',
							username: '',
							authMethod: 'privateKey',
							password: '',
							privateKeyPath: '~/.ssh/id_rsa',
							remotePath: '/home',
						});
						setSSHActiveField('host');
					}, 1500);
				} else {
					setSSHMessage({
						type: 'error',
						text: t.workingDirectoryPanel.sshAddFailed,
					});
				}
			} else {
				setSSHMessage({
					type: 'error',
					text: t.workingDirectoryPanel.sshTestFailed.replace(
						'{error}',
						result.error || 'Unknown error',
					),
				});
			}
		} catch (error) {
			setSSHMessage({
				type: 'error',
				text: t.workingDirectoryPanel.sshTestFailed.replace(
					'{error}',
					error instanceof Error ? error.message : String(error),
				),
			});
		} finally {
			setSSHConnecting(false);
		}
	};

	const handleSSHFieldChange = (field: SSHFormField, value: string) => {
		const newForm = {...sshFormRef.current, [field]: value};
		setSSHForm(newForm);
		sshFormRef.current = newForm;
	};

	// SSH mode UI
	if (sshMode) {
		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				<Text color={theme.colors.menuSelected} bold>
					{t.workingDirectoryPanel.sshTitle}
				</Text>

				<Box marginTop={1} flexDirection="column">
					{/* Host */}
					<Box>
						<Text
							color={
								sshActiveField === 'host'
									? theme.colors.menuSelected
									: theme.colors.text
							}
						>
							{t.workingDirectoryPanel.sshHostLabel}
						</Text>
						<TextInput
							value={sshForm.host}
							onChange={v => handleSSHFieldChange('host', v)}
							onSubmit={handleSSHSubmit}
							focus={sshActiveField === 'host'}
						/>
					</Box>

					{/* Port */}
					<Box>
						<Text
							color={
								sshActiveField === 'port'
									? theme.colors.menuSelected
									: theme.colors.text
							}
						>
							{t.workingDirectoryPanel.sshPortLabel}
						</Text>
						<TextInput
							value={sshForm.port}
							onChange={v => handleSSHFieldChange('port', v)}
							onSubmit={handleSSHSubmit}
							focus={sshActiveField === 'port'}
						/>
					</Box>

					{/* Username */}
					<Box>
						<Text
							color={
								sshActiveField === 'username'
									? theme.colors.menuSelected
									: theme.colors.text
							}
						>
							{t.workingDirectoryPanel.sshUsernameLabel}
						</Text>
						<TextInput
							value={sshForm.username}
							onChange={v => handleSSHFieldChange('username', v)}
							onSubmit={handleSSHSubmit}
							focus={sshActiveField === 'username'}
						/>
					</Box>

					{/* Auth Method */}
					<Box>
						<Text
							color={
								sshActiveField === 'authMethod'
									? theme.colors.menuSelected
									: theme.colors.text
							}
						>
							{t.workingDirectoryPanel.sshAuthMethodLabel}
						</Text>
						<Text
							color={
								sshActiveField === 'authMethod'
									? theme.colors.menuSelected
									: theme.colors.text
							}
							bold={sshActiveField === 'authMethod'}
						>
							{sshActiveField === 'authMethod' ? '< ' : ''}
							{sshForm.authMethod === 'password'
								? t.workingDirectoryPanel.sshAuthPassword
								: sshForm.authMethod === 'privateKey'
								? t.workingDirectoryPanel.sshAuthPrivateKey
								: t.workingDirectoryPanel.sshAuthAgent}
							{sshActiveField === 'authMethod' ? ' >' : ''}
						</Text>
					</Box>

					{/* Password (conditional) */}
					{sshForm.authMethod === 'password' && (
						<Box>
							<Text
								color={
									sshActiveField === 'password'
										? theme.colors.menuSelected
										: theme.colors.text
								}
							>
								{t.workingDirectoryPanel.sshPasswordLabel}
							</Text>
							<TextInput
								value={sshForm.password}
								onChange={v => handleSSHFieldChange('password', v)}
								onSubmit={handleSSHSubmit}
								mask="*"
								focus={sshActiveField === 'password'}
							/>
						</Box>
					)}

					{/* Private Key Path (conditional) */}
					{sshForm.authMethod === 'privateKey' && (
						<Box>
							<Text
								color={
									sshActiveField === 'privateKeyPath'
										? theme.colors.menuSelected
										: theme.colors.text
								}
							>
								{t.workingDirectoryPanel.sshPrivateKeyLabel}
							</Text>
							<TextInput
								value={sshForm.privateKeyPath}
								onChange={v => handleSSHFieldChange('privateKeyPath', v)}
								onSubmit={handleSSHSubmit}
								focus={sshActiveField === 'privateKeyPath'}
							/>
						</Box>
					)}

					{/* Remote Path */}
					<Box>
						<Text
							color={
								sshActiveField === 'remotePath'
									? theme.colors.menuSelected
									: theme.colors.text
							}
						>
							{t.workingDirectoryPanel.sshRemotePathLabel}
						</Text>
						<TextInput
							value={sshForm.remotePath}
							onChange={v => handleSSHFieldChange('remotePath', v)}
							onSubmit={handleSSHSubmit}
							focus={sshActiveField === 'remotePath'}
						/>
					</Box>
				</Box>

				{/* Status message */}
				{sshConnecting && (
					<Box marginTop={1}>
						<Text color={theme.colors.warning}>
							{t.workingDirectoryPanel.sshConnecting}
						</Text>
					</Box>
				)}

				{sshMessage && (
					<Box marginTop={1}>
						<Alert
							variant={sshMessage.type === 'success' ? 'success' : 'error'}
						>
							{sshMessage.text}
						</Alert>
					</Box>
				)}

				<Box marginTop={1}>
					<Text dimColor>{t.workingDirectoryPanel.sshHint}</Text>
				</Box>
			</Box>
		);
	}

	// Adding mode UI
	if (addingMode) {
		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				<Text color={theme.colors.menuSelected} bold>
					{t.workingDirectoryPanel.addTitle}
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text color={theme.colors.text}>
						{t.workingDirectoryPanel.addPathPrompt}
					</Text>
					<Box marginTop={1}>
						<Text color={theme.colors.menuSelected}>
							{t.workingDirectoryPanel.addPathLabel}
						</Text>
						<TextInput
							value={newDirPath}
							onChange={setNewDirPath}
							onSubmit={handleAddSubmit}
						/>
					</Box>
					{addError && (
						<Box marginTop={1}>
							<Text color={theme.colors.error}>{addError}</Text>
						</Box>
					)}
				</Box>
				<Box marginTop={1}>
					<Text dimColor>{t.workingDirectoryPanel.addHint}</Text>
				</Box>
			</Box>
		);
	}

	if (loading) {
		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				<Text color={theme.colors.menuSelected} bold>
					{t.workingDirectoryPanel.title}
				</Text>
				<Text color={theme.colors.text}>{t.workingDirectoryPanel.loading}</Text>
			</Box>
		);
	}

	if (confirmDelete) {
		const deleteMessage =
			markedDirs.size > 1
				? t.workingDirectoryPanel.confirmDeleteMessagePlural.replace(
						'{count}',
						markedDirs.size.toString(),
				  )
				: t.workingDirectoryPanel.confirmDeleteMessage.replace(
						'{count}',
						markedDirs.size.toString(),
				  );

		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor={theme.colors.border}
			>
				<Text color={theme.colors.menuSelected} bold>
					{t.workingDirectoryPanel.confirmDeleteTitle}
				</Text>
				<Text color={theme.colors.text}>{deleteMessage}</Text>
				<Box marginTop={1}>
					{Array.from(markedDirs).map(dirPath => (
						<Text key={dirPath} color={theme.colors.error}>
							- {dirPath}
						</Text>
					))}
				</Box>
				<Box marginTop={1}>
					<Text color={theme.colors.text}>
						{t.workingDirectoryPanel.confirmHint}
					</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor={theme.colors.border}
		>
			<Text color={theme.colors.menuSelected} bold>
				{t.workingDirectoryPanel.title}
			</Text>

			{directories.length === 0 ? (
				<Text dimColor>{t.workingDirectoryPanel.noDirectories}</Text>
			) : (
				<Box flexDirection="column" marginTop={1}>
					{directories.map((dir, index) => {
						const isSelected = index === selectedIndex;
						const isMarked = markedDirs.has(dir.path);

						return (
							<Box key={dir.path}>
								<Text
									color={
										isSelected ? theme.colors.menuSelected : theme.colors.text
									}
									bold={isSelected}
								>
									{isSelected ? '> ' : '  '}
								</Text>
								<Text
									color={
										isMarked
											? theme.colors.warning
											: isSelected
											? theme.colors.menuSelected
											: theme.colors.text
									}
								>
									[{isMarked ? 'x' : ' '}]
								</Text>
								<Text
									color={
										isSelected ? theme.colors.menuSelected : theme.colors.text
									}
								>
									{' '}
								</Text>
								{dir.isDefault && (
									<Text color={theme.colors.success} bold>
										{t.workingDirectoryPanel.defaultLabel}{' '}
									</Text>
								)}
								<Text
									color={
										isSelected ? theme.colors.menuSelected : theme.colors.text
									}
								>
									{dir.path}
								</Text>
							</Box>
						);
					})}
				</Box>
			)}

			<Box marginTop={1} flexDirection="column">
				<Text dimColor>{t.workingDirectoryPanel.navigationHint}</Text>
				{markedDirs.size > 0 && (
					<Text color={theme.colors.warning}>
						{t.workingDirectoryPanel.markedCount
							.replace('{count}', markedDirs.size.toString())
							.replace(
								'{plural}',
								markedDirs.size > 1
									? t.workingDirectoryPanel.markedCountPlural
									: t.workingDirectoryPanel.markedCountSingular,
							)}
					</Text>
				)}
				{showDefaultAlert && (
					<Box marginTop={1}>
						<Alert variant="error">
							{t.workingDirectoryPanel.alertDefaultCannotDelete}
						</Alert>
					</Box>
				)}
			</Box>
		</Box>
	);
}
