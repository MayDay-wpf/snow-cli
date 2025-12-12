import React, {useState, useEffect, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getWorkingDirectories,
	removeWorkingDirectories,
	addWorkingDirectory,
	type WorkingDirectory,
} from '../../../utils/config/workingDirConfig.js';
import {useI18n} from '../../../i18n/index.js';

type Props = {
	onClose: () => void;
};

export default function WorkingDirectoryPanel({onClose}: Props) {
	const {t} = useI18n();
	const [directories, setDirectories] = useState<WorkingDirectory[]>([]);
	const [loading, setLoading] = useState(true);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [markedDirs, setMarkedDirs] = useState<Set<string>>(new Set());
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [addingMode, setAddingMode] = useState(false);
	const [newDirPath, setNewDirPath] = useState('');
	const [addError, setAddError] = useState<string | null>(null);
	const [showDefaultAlert, setShowDefaultAlert] = useState(false);

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

				// ESC to close
				if (key.escape) {
					if (confirmDelete) {
						setConfirmDelete(false);
						return;
					}
					onClose();
					return;
				}

				// If in delete confirmation mode
				if (confirmDelete) {
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
			},
			[
				directories,
				selectedIndex,
				markedDirs,
				confirmDelete,
				addingMode,
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

	// Adding mode UI
	if (addingMode) {
		return (
			<Box
				flexDirection="column"
				padding={1}
				borderStyle="round"
				borderColor="green"
			>
				<Text color="green" bold>
					{t.workingDirectoryPanel.addTitle}
				</Text>
				<Box marginTop={1} flexDirection="column">
					<Text>{t.workingDirectoryPanel.addPathPrompt}</Text>
					<Box marginTop={1}>
						<Text color="cyan">{t.workingDirectoryPanel.addPathLabel}</Text>
						<TextInput
							value={newDirPath}
							onChange={setNewDirPath}
							onSubmit={handleAddSubmit}
						/>
					</Box>
					{addError && (
						<Box marginTop={1}>
							<Text color="red">{addError}</Text>
						</Box>
					)}
				</Box>
				<Box marginTop={1}>
					<Text color="gray">{t.workingDirectoryPanel.addHint}</Text>
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
				borderColor="cyan"
			>
				<Text color="cyan" bold>
					{t.workingDirectoryPanel.title}
				</Text>
				<Text>{t.workingDirectoryPanel.loading}</Text>
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
				borderColor="yellow"
			>
				<Text color="yellow" bold>
					{t.workingDirectoryPanel.confirmDeleteTitle}
				</Text>
				<Text>{deleteMessage}</Text>
				<Box marginTop={1}>
					{Array.from(markedDirs).map(dirPath => (
						<Text key={dirPath} color="red">
							- {dirPath}
						</Text>
					))}
				</Box>
				<Box marginTop={1}>
					<Text>{t.workingDirectoryPanel.confirmHint}</Text>
				</Box>
			</Box>
		);
	}

	return (
		<Box
			flexDirection="column"
			padding={1}
			borderStyle="round"
			borderColor="cyan"
		>
			<Text color="cyan" bold>
				{t.workingDirectoryPanel.title}
			</Text>

			{directories.length === 0 ? (
				<Text color="gray">{t.workingDirectoryPanel.noDirectories}</Text>
			) : (
				<Box flexDirection="column" marginTop={1}>
					{directories.map((dir, index) => {
						const isSelected = index === selectedIndex;
						const isMarked = markedDirs.has(dir.path);

						return (
							<Box key={dir.path}>
								<Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
									{isSelected ? '> ' : '  '}
								</Text>
								<Text
									color={isMarked ? 'yellow' : isSelected ? 'cyan' : 'white'}
								>
									[{isMarked ? 'x' : ' '}]
								</Text>
								<Text color={isSelected ? 'cyan' : 'white'}> </Text>
								{dir.isDefault && (
									<Text color="green" bold>
										{t.workingDirectoryPanel.defaultLabel}{' '}
									</Text>
								)}
								<Text color={isSelected ? 'cyan' : 'white'}>{dir.path}</Text>
							</Box>
						);
					})}
				</Box>
			)}

			<Box marginTop={1} flexDirection="column">
				<Text color="gray">{t.workingDirectoryPanel.navigationHint}</Text>
				{markedDirs.size > 0 && (
					<Text color="yellow">
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
