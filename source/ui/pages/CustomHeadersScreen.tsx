import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';

import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getCustomHeadersConfig,
	saveCustomHeadersConfig,
	type CustomHeadersConfig,
	type CustomHeadersItem,
} from '../../utils/config/apiConfig.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	onBack: () => void;
};

type View = 'list' | 'add' | 'edit' | 'editHeaders' | 'confirmDelete';
type ListAction =
	| 'activate'
	| 'deactivate'
	| 'edit'
	| 'delete'
	| 'add'
	| 'back';

export default function CustomHeadersScreen({onBack}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [config, setConfig] = useState<CustomHeadersConfig>(() => {
		return (
			getCustomHeadersConfig() || {
				active: '',
				schemes: [],
			}
		);
	});

	const [view, setView] = useState<View>('list');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [currentAction, setCurrentAction] = useState<ListAction>('add');
	const [isEditing, setIsEditing] = useState(false);
	const [editName, setEditName] = useState('');
	const [editHeaders, setEditHeaders] = useState<Record<string, string>>({});
	const [editingField, setEditingField] = useState<'name' | 'headers'>('name');
	const [error, setError] = useState('');

	// Headers editing state
	const [headerKeys, setHeaderKeys] = useState<string[]>([]);
	const [headerSelectedIndex, setHeaderSelectedIndex] = useState(0);
	const [headerEditingIndex, setHeaderEditingIndex] = useState<number>(-1);
	const [headerEditingField, setHeaderEditingField] = useState<'key' | 'value'>(
		'key',
	);
	const [headerEditKey, setHeaderEditKey] = useState('');
	const [headerEditValue, setHeaderEditValue] = useState('');
	// 记住进入 editHeaders 之前的视图，用于正确返回
	const [previousView, setPreviousView] = useState<'add' | 'edit'>('add');

	const actions: ListAction[] =
		config.schemes.length > 0
			? config.active
				? ['activate', 'deactivate', 'edit', 'delete', 'add', 'back']
				: ['activate', 'edit', 'delete', 'add', 'back']
			: ['add', 'back'];

	// 当配置变化时，确保 currentAction 在可用操作列表中
	useEffect(() => {
		if (!actions.includes(currentAction)) {
			setCurrentAction(actions[0] || 'add');
		}
	}, [config.schemes.length, config.active]);

	useEffect(() => {
		const savedConfig = getCustomHeadersConfig();
		if (savedConfig) {
			setConfig(savedConfig);
		}
	}, [view]);

	const saveAndRefresh = (newConfig: CustomHeadersConfig) => {
		try {
			saveCustomHeadersConfig(newConfig);
			setConfig(newConfig);
			setError('');
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : t.customHeaders.saveError);
			return false;
		}
	};

	const handleActivate = () => {
		if (config.schemes.length === 0 || selectedIndex >= config.schemes.length)
			return;

		const scheme = config.schemes[selectedIndex]!;
		const newConfig: CustomHeadersConfig = {
			...config,
			active: scheme.id,
		};

		if (saveAndRefresh(newConfig)) {
			setError('');
		}
	};

	const handleDeactivate = () => {
		const newConfig: CustomHeadersConfig = {
			...config,
			active: '',
		};

		if (saveAndRefresh(newConfig)) {
			setError('');
		}
	};

	const handleEdit = () => {
		if (config.schemes.length === 0 || selectedIndex >= config.schemes.length)
			return;

		const scheme = config.schemes[selectedIndex]!;
		setEditName(scheme.name);
		setEditHeaders(scheme.headers);
		setEditingField('name');
		setView('edit');
	};

	const handleDelete = () => {
		setView('confirmDelete');
	};

	const confirmDelete = () => {
		if (config.schemes.length === 0 || selectedIndex >= config.schemes.length)
			return;

		const schemeToDelete = config.schemes[selectedIndex]!;
		const newSchemes = config.schemes.filter((_, i) => i !== selectedIndex);
		const newActive =
			config.active === schemeToDelete.id && newSchemes.length > 0
				? newSchemes[0]!.id
				: config.active === schemeToDelete.id
				? ''
				: config.active;

		const newConfig: CustomHeadersConfig = {
			active: newActive,
			schemes: newSchemes,
		};

		if (saveAndRefresh(newConfig)) {
			setSelectedIndex(Math.max(0, selectedIndex - 1));
			setView('list');
		}
	};

	const handleAdd = () => {
		setEditName('');
		setEditHeaders({});
		setEditingField('name');
		setView('add');
	};

	const saveNewScheme = () => {
		const newScheme: CustomHeadersItem = {
			id: Date.now().toString(),
			name: editName.trim() || 'Unnamed Scheme',
			headers: editHeaders,
			createdAt: new Date().toISOString(),
		};

		const newConfig: CustomHeadersConfig = {
			...config,
			schemes: [...config.schemes, newScheme],
			active: config.schemes.length === 0 ? newScheme.id : config.active,
		};

		if (saveAndRefresh(newConfig)) {
			setView('list');
			setSelectedIndex(config.schemes.length);
		}
	};

	const saveEditedScheme = () => {
		if (config.schemes.length === 0 || selectedIndex >= config.schemes.length)
			return;

		const newConfig: CustomHeadersConfig = {
			...config,
			schemes: config.schemes.map((s, i) =>
				i === selectedIndex
					? {
							...s,
							name: editName.trim() || 'Unnamed Scheme',
							headers: editHeaders,
					  }
					: s,
			),
		};

		if (saveAndRefresh(newConfig)) {
			setView('list');
		}
	};

	// Headers editing functions
	const enterHeadersEditMode = () => {
		// 保存当前视图（add 或 edit），以便从 editHeaders 返回时使用
		setPreviousView(view as 'add' | 'edit');
		setHeaderKeys(Object.keys(editHeaders));
		setHeaderSelectedIndex(0);
		setHeaderEditingIndex(-1);
		setView('editHeaders');
	};

	const exitHeadersEditMode = () => {
		// 使用保存的 previousView 返回正确的视图
		setView(previousView);
	};

	const addNewHeader = () => {
		setHeaderEditKey('');
		setHeaderEditValue('');
		setHeaderEditingIndex(headerKeys.length);
		setHeaderEditingField('key');
	};

	const editHeaderAtIndex = (index: number) => {
		const key = headerKeys[index]!;
		setHeaderEditKey(key);
		setHeaderEditValue(editHeaders[key] || '');
		setHeaderEditingIndex(index);
		setHeaderEditingField('key');
	};

	const saveHeaderEdit = () => {
		const trimmedKey = headerEditKey.trim();
		const trimmedValue = headerEditValue.trim();

		if (!trimmedKey) {
			setHeaderEditingIndex(-1);
			return;
		}

		const newHeaders = {...editHeaders};

		if (headerEditingIndex < headerKeys.length) {
			const oldKey = headerKeys[headerEditingIndex]!;
			if (oldKey !== trimmedKey) {
				delete newHeaders[oldKey];
			}
		}

		newHeaders[trimmedKey] = trimmedValue;

		setEditHeaders(newHeaders);
		setHeaderKeys(Object.keys(newHeaders));
		setHeaderEditingIndex(-1);
	};

	const deleteHeaderAtIndex = (index: number) => {
		const key = headerKeys[index]!;
		const newHeaders = {...editHeaders};
		delete newHeaders[key];

		setEditHeaders(newHeaders);
		setHeaderKeys(Object.keys(newHeaders));
		setHeaderSelectedIndex(Math.max(0, Math.min(index, headerKeys.length - 2)));
	};

	// List view input handling
	useInput(
		(_input, key) => {
			if (view !== 'list') return;

			if (key.escape) {
				onBack();
			} else if (key.upArrow) {
				if (config.schemes.length > 0) {
					setSelectedIndex(prev =>
						prev > 0 ? prev - 1 : config.schemes.length - 1,
					);
				}
			} else if (key.downArrow) {
				if (config.schemes.length > 0) {
					setSelectedIndex(prev =>
						prev < config.schemes.length - 1 ? prev + 1 : 0,
					);
				}
			} else if (key.leftArrow) {
				const currentIdx = actions.indexOf(currentAction);
				setCurrentAction(
					actions[currentIdx > 0 ? currentIdx - 1 : actions.length - 1]!,
				);
			} else if (key.rightArrow) {
				const currentIdx = actions.indexOf(currentAction);
				setCurrentAction(
					actions[currentIdx < actions.length - 1 ? currentIdx + 1 : 0]!,
				);
			} else if (key.return) {
				if (currentAction === 'activate') {
					handleActivate();
				} else if (currentAction === 'deactivate') {
					handleDeactivate();
				} else if (currentAction === 'edit') {
					handleEdit();
				} else if (currentAction === 'delete') {
					handleDelete();
				} else if (currentAction === 'add') {
					handleAdd();
				} else if (currentAction === 'back') {
					onBack();
				}
			}
		},
		{isActive: view === 'list'},
	);

	// Add/Edit view input handling
	useInput(
		(input, key) => {
			if (view !== 'add' && view !== 'edit') return;

			if (key.escape) {
				setView('list');
				setError('');
			} else if (!isEditing && key.upArrow) {
				setEditingField('name');
			} else if (!isEditing && key.downArrow) {
				setEditingField('headers');
			} else if (key.return) {
				if (editingField === 'headers' && !isEditing) {
					enterHeadersEditMode();
				} else if (isEditing) {
					setIsEditing(false);
				} else {
					setIsEditing(true);
				}
			} else if (input === 's' && (key.ctrl || key.meta)) {
				if (view === 'add') {
					saveNewScheme();
				} else {
					saveEditedScheme();
				}
			}
		},
		{isActive: view === 'add' || view === 'edit'},
	);

	// Headers edit view input handling
	useInput(
		(input, key) => {
			if (view !== 'editHeaders') return;

			if (headerEditingIndex === -1) {
				// 列表浏览模式
				if (key.escape) {
					exitHeadersEditMode();
				} else if (key.upArrow) {
					setHeaderSelectedIndex(prev =>
						prev > 0 ? prev - 1 : headerKeys.length,
					);
				} else if (key.downArrow) {
					setHeaderSelectedIndex(prev =>
						prev < headerKeys.length ? prev + 1 : 0,
					);
				} else if (key.return) {
					if (headerSelectedIndex < headerKeys.length) {
						editHeaderAtIndex(headerSelectedIndex);
					} else {
						addNewHeader();
					}
				} else if (key.delete || input === 'd') {
					if (headerSelectedIndex < headerKeys.length) {
						deleteHeaderAtIndex(headerSelectedIndex);
					}
				}
			} else {
				// 编辑模式
				if (key.escape) {
					setHeaderEditingIndex(-1);
				} else if (key.upArrow && !isEditing) {
					setHeaderEditingField('key');
				} else if (key.downArrow && !isEditing) {
					setHeaderEditingField('value');
				} else if (key.return) {
					if (isEditing) {
						setIsEditing(false);
					} else {
						setIsEditing(true);
					}
				} else if (input === 's' && (key.ctrl || key.meta)) {
					saveHeaderEdit();
				}
			}
		},
		{isActive: view === 'editHeaders'},
	);

	// Delete confirmation input handling
	useInput(
		(input, key) => {
			if (view !== 'confirmDelete') return;

			if (key.escape || input === 'n' || input === 'N') {
				setView('list');
			} else if (input === 'y' || input === 'Y' || key.return) {
				confirmDelete();
			}
		},
		{isActive: view === 'confirmDelete'},
	);

	// Render list view
	if (view === 'list') {
		const activeScheme = config.schemes.find(s => s.id === config.active);

		return (
			<Box flexDirection="column" padding={1}>
				{error && (
					<Box marginBottom={1}>
						<Alert variant="error">{error}</Alert>
					</Box>
				)}

				<Box marginBottom={1}>
					<Text bold>
						{t.customHeaders.activeScheme}{' '}
						<Text color={theme.colors.success}>
							{activeScheme?.name || t.customHeaders.none}
						</Text>
					</Text>
				</Box>

				{config.schemes.length === 0 ? (
					<Box marginBottom={1}>
						<Text color={theme.colors.warning}>
							{t.customHeaders.noSchemesConfigured}
						</Text>
					</Box>
				) : (
					<Box flexDirection="column" marginBottom={1}>
						<Text bold color={theme.colors.menuInfo}>
							{t.customHeaders.availableSchemes}
						</Text>
						{config.schemes.map((scheme, index) => {
							const headerCount = Object.keys(scheme.headers).length;
							const headerPreview =
								headerCount > 0
									? Object.entries(scheme.headers)
											.slice(0, 2)
											.map(([k, v]) => `${k}: ${v}`)
											.join(', ')
									: '';

							return (
								<Box key={scheme.id} marginLeft={2}>
									<Text
										color={
											index === selectedIndex
												? theme.colors.menuSelected
												: scheme.id === config.active
												? theme.colors.menuInfo
												: theme.colors.menuNormal
										}
									>
										{index === selectedIndex ? '❯ ' : '  '}
										{scheme.id === config.active ? '✓ ' : '  '}
										{scheme.name}
										{headerPreview && (
											<Text dimColor>
												{' '}
												- {headerPreview.substring(0, 50)}
												{headerPreview.length > 50 ? '...' : ''}
											</Text>
										)}
									</Text>
								</Box>
							);
						})}
					</Box>
				)}

				<Box marginBottom={1}>
					<Text bold color={theme.colors.menuInfo}>
						{t.customHeaders.actions}
					</Text>
				</Box>
				<Box flexDirection="column" marginBottom={1} marginLeft={2}>
					{actions.map(action => (
						<Text
							key={action}
							color={
								currentAction === action
									? theme.colors.menuSelected
									: theme.colors.menuSecondary
							}
							bold={currentAction === action}
						>
							{currentAction === action ? '❯ ' : '  '}
							{action === 'activate' && t.customHeaders.activate}
							{action === 'deactivate' && t.customHeaders.deactivate}
							{action === 'edit' && t.customHeaders.edit}
							{action === 'delete' && t.customHeaders.delete}
							{action === 'add' && t.customHeaders.addNew}
							{action === 'back' && t.customHeaders.escBack}
						</Text>
					))}
				</Box>

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.customHeaders.navigationHint}
					</Text>
				</Box>
			</Box>
		);
	}

	// Render add/edit view
	if (view === 'add' || view === 'edit') {
		const headerCount = Object.keys(editHeaders).length;
		const headerPreview =
			headerCount > 0
				? Object.entries(editHeaders)
						.slice(0, 3)
						.map(([k, v]) => `${k}: ${v}`)
						.join(', ')
				: t.customHeaders.notSet;

		return (
			<Box flexDirection="column" padding={1}>
				{error && (
					<Box marginBottom={1}>
						<Alert variant="error">{error}</Alert>
					</Box>
				)}

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text
							color={
								editingField === 'name'
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{editingField === 'name' ? '❯ ' : '  '}
							{t.customHeaders.nameLabel}
						</Text>
						{editingField === 'name' && isEditing && (
							<Box marginLeft={3}>
								<TextInput
									value={editName}
									onChange={setEditName}
									placeholder={t.customHeaders.enterSchemeName}
								/>
							</Box>
						)}
						{(!isEditing || editingField !== 'name') && (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{editName || t.customHeaders.notSet}
								</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginBottom={1}>
					<Box flexDirection="column">
						<Text
							color={
								editingField === 'headers'
									? theme.colors.menuSelected
									: theme.colors.menuNormal
							}
						>
							{editingField === 'headers' ? '❯ ' : '  '}
							{t.customHeaders.headersLabel} ({headerCount}{' '}
							{t.customHeaders.headersConfigured}):
						</Text>
						{editingField === 'headers' && !isEditing ? (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuInfo} dimColor>
									{t.customHeaders.pressEnterToEdit}
								</Text>
							</Box>
						) : (
							<Box marginLeft={3}>
								<Text color={theme.colors.menuSecondary}>
									{headerPreview.substring(0, 100)}
									{headerPreview.length > 100 ? '...' : ''}
								</Text>
							</Box>
						)}
					</Box>
				</Box>

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.customHeaders.editingHint}
					</Text>
				</Box>
			</Box>
		);
	}

	// Render headers edit view
	if (view === 'editHeaders') {
		return (
			<Box flexDirection="column" padding={1}>
				{headerEditingIndex === -1 ? (
					<>
						<Box marginBottom={1}>
							<Text bold color={theme.colors.menuInfo}>
								{t.customHeaders.headerList}
							</Text>
						</Box>

						{headerKeys.length === 0 ? (
							<Box marginBottom={1}>
								<Text color={theme.colors.warning}>
									{t.customHeaders.noHeadersConfigured}
								</Text>
							</Box>
						) : (
							<Box flexDirection="column" marginBottom={1}>
								{headerKeys.map((key, index) => {
									const isSelected = index === headerSelectedIndex;
									return (
										<Box key={index} marginLeft={2}>
											<Text
												color={
													isSelected
														? theme.colors.menuSelected
														: theme.colors.menuNormal
												}
												bold={isSelected}
											>
												{isSelected ? '❯ ' : '  '}
												{key}: {editHeaders[key]}
											</Text>
										</Box>
									);
								})}
							</Box>
						)}

						<Box marginLeft={2} marginBottom={1}>
							<Text
								color={
									headerSelectedIndex === headerKeys.length
										? theme.colors.menuSelected
										: theme.colors.menuSecondary
								}
								bold={headerSelectedIndex === headerKeys.length}
							>
								{headerSelectedIndex === headerKeys.length ? '❯ ' : '  '}
								{t.customHeaders.addNewHeader}
							</Text>
						</Box>

						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.customHeaders.headerNavigationHint}
							</Text>
						</Box>
					</>
				) : (
					<>
						<Box marginBottom={1}>
							<Box flexDirection="column">
								<Text
									color={
										headerEditingField === 'key'
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
								>
									{headerEditingField === 'key' ? '❯ ' : '  '}
									{t.customHeaders.keyLabel}
								</Text>
								{headerEditingField === 'key' && isEditing && (
									<Box marginLeft={3}>
										<TextInput
											value={headerEditKey}
											onChange={setHeaderEditKey}
											placeholder={t.customHeaders.headerKeyPlaceholder}
										/>
									</Box>
								)}
								{(!isEditing || headerEditingField !== 'key') && (
									<Box marginLeft={3}>
										<Text color={theme.colors.menuSecondary}>
											{headerEditKey || t.customHeaders.notSet}
										</Text>
									</Box>
								)}
							</Box>
						</Box>

						<Box marginBottom={1}>
							<Box flexDirection="column">
								<Text
									color={
										headerEditingField === 'value'
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
								>
									{headerEditingField === 'value' ? '❯ ' : '  '}
									{t.customHeaders.valueLabel}
								</Text>
								{headerEditingField === 'value' && isEditing && (
									<Box marginLeft={3}>
										<TextInput
											value={headerEditValue}
											onChange={setHeaderEditValue}
											placeholder={t.customHeaders.headerValuePlaceholder}
										/>
									</Box>
								)}
								{(!isEditing || headerEditingField !== 'value') && (
									<Box marginLeft={3}>
										<Text color={theme.colors.menuSecondary}>
											{headerEditValue || t.customHeaders.notSet}
										</Text>
									</Box>
								)}
							</Box>
						</Box>

						<Box marginTop={1}>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.customHeaders.headerEditingHint}
							</Text>
						</Box>
					</>
				)}
			</Box>
		);
	}

	// Render delete confirmation
	if (view === 'confirmDelete') {
		const schemeToDelete =
			config.schemes.length > 0 ? config.schemes[selectedIndex] : null;

		return (
			<Box flexDirection="column" padding={1}>
				<Alert variant="warning">{t.customHeaders.confirmDelete}</Alert>

				<Box marginBottom={1}>
					<Text>
						{t.customHeaders.deleteConfirmMessage} "
						<Text bold color={theme.colors.warning}>
							{schemeToDelete?.name}
						</Text>
						"?
					</Text>
				</Box>

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.customHeaders.confirmHint}
					</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
