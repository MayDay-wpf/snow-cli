import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import Gradient from 'ink-gradient';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getSystemPromptConfig,
	saveSystemPromptConfig,
	type SystemPromptConfig,
	type SystemPromptItem,
} from '../../utils/config/apiConfig.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	onBack: () => void;
};

type View = 'list' | 'add' | 'edit' | 'confirmDelete';
type ListAction =
	| 'activate'
	| 'deactivate'
	| 'edit'
	| 'delete'
	| 'add'
	| 'back';

export default function SystemPromptConfigScreen({onBack}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [config, setConfig] = useState<SystemPromptConfig>(() => {
		return (
			getSystemPromptConfig() || {
				active: '',
				prompts: [],
			}
		);
	});

	const [view, setView] = useState<View>('list');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [currentAction, setCurrentAction] = useState<ListAction>('add');
	const [isEditing, setIsEditing] = useState(false);
	const [editName, setEditName] = useState('');
	const [editContent, setEditContent] = useState('');
	const [editingField, setEditingField] = useState<'name' | 'content'>('name');
	const [error, setError] = useState('');

	const actions: ListAction[] =
		config.prompts.length > 0
			? config.active
				? ['activate', 'deactivate', 'edit', 'delete', 'add', 'back']
				: ['activate', 'edit', 'delete', 'add', 'back']
			: ['add', 'back'];

	// 当配置变化时，确保 currentAction 在可用操作列表中
	useEffect(() => {
		if (!actions.includes(currentAction)) {
			setCurrentAction(actions[0] || 'add');
		}
	}, [config.prompts.length, config.active]);

	useEffect(() => {
		// 保存配置时刷新
		const savedConfig = getSystemPromptConfig();
		if (savedConfig) {
			setConfig(savedConfig);
		}
	}, [view]);

	const saveAndRefresh = (newConfig: SystemPromptConfig) => {
		try {
			saveSystemPromptConfig(newConfig);
			setConfig(newConfig);
			setError('');
			return true;
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t.systemPromptConfig.saveError,
			);
			return false;
		}
	};

	const handleActivate = () => {
		if (config.prompts.length === 0 || selectedIndex >= config.prompts.length)
			return;

		const prompt = config.prompts[selectedIndex]!;
		const newConfig: SystemPromptConfig = {
			...config,
			active: prompt.id,
		};

		if (saveAndRefresh(newConfig)) {
			setError('');
		}
	};

	const handleDeactivate = () => {
		const newConfig: SystemPromptConfig = {
			...config,
			active: '',
		};

		if (saveAndRefresh(newConfig)) {
			setError('');
		}
	};

	const handleEdit = () => {
		if (config.prompts.length === 0 || selectedIndex >= config.prompts.length)
			return;

		const prompt = config.prompts[selectedIndex]!;
		setEditName(prompt.name);
		setEditContent(prompt.content);
		setEditingField('name');
		setView('edit');
	};

	const handleDelete = () => {
		setView('confirmDelete');
	};

	const confirmDelete = () => {
		if (config.prompts.length === 0 || selectedIndex >= config.prompts.length)
			return;

		const promptToDelete = config.prompts[selectedIndex]!;
		const newPrompts = config.prompts.filter((_, i) => i !== selectedIndex);
		const newActive =
			config.active === promptToDelete.id && newPrompts.length > 0
				? newPrompts[0]!.id
				: config.active === promptToDelete.id
				? ''
				: config.active;

		const newConfig: SystemPromptConfig = {
			active: newActive,
			prompts: newPrompts,
		};

		if (saveAndRefresh(newConfig)) {
			setSelectedIndex(Math.max(0, selectedIndex - 1));
			setView('list');
		}
	};

	const handleAdd = () => {
		setEditName('');
		setEditContent('');
		setEditingField('name');
		setView('add');
	};

	const saveNewPrompt = () => {
		const newPrompt: SystemPromptItem = {
			id: Date.now().toString(),
			name: editName.trim() || 'Unnamed Prompt',
			content: editContent,
			createdAt: new Date().toISOString(),
		};

		const newConfig: SystemPromptConfig = {
			...config,
			prompts: [...config.prompts, newPrompt],
			active: config.prompts.length === 0 ? newPrompt.id : config.active,
		};

		if (saveAndRefresh(newConfig)) {
			setView('list');
			setSelectedIndex(config.prompts.length);
		}
	};

	const saveEditedPrompt = () => {
		if (config.prompts.length === 0 || selectedIndex >= config.prompts.length)
			return;

		const newConfig: SystemPromptConfig = {
			...config,
			prompts: config.prompts.map((p, i) =>
				i === selectedIndex
					? {
							...p,
							name: editName.trim() || 'Unnamed Prompt',
							content: editContent,
					  }
					: p,
			),
		};

		if (saveAndRefresh(newConfig)) {
			setView('list');
		}
	};

	// List view input handling
	useInput(
		(_input, key) => {
			if (view !== 'list') return;

			if (key.escape) {
				onBack();
			} else if (key.upArrow) {
				if (config.prompts.length > 0) {
					setSelectedIndex(prev =>
						prev > 0 ? prev - 1 : config.prompts.length - 1,
					);
				}
			} else if (key.downArrow) {
				if (config.prompts.length > 0) {
					setSelectedIndex(prev =>
						prev < config.prompts.length - 1 ? prev + 1 : 0,
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
				// First ESC: Cancel editing and return to list without saving
				setView('list');
				setError('');
			} else if (!isEditing && key.upArrow) {
				setEditingField('name');
			} else if (!isEditing && key.downArrow) {
				setEditingField('content');
			} else if (key.return) {
				if (isEditing) {
					setIsEditing(false);
				} else {
					setIsEditing(true);
				}
			} else if (input === 's' && (key.ctrl || key.meta)) {
				// Ctrl+S saves and returns to list
				if (view === 'add') {
					saveNewPrompt();
				} else {
					saveEditedPrompt();
				}
			}
		},
		{isActive: view === 'add' || view === 'edit'},
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
		const activePrompt = config.prompts.find(p => p.id === config.active);

		return (
			<Box flexDirection="column" padding={1}>
				<Box
					marginBottom={1}
					borderStyle="round"
					borderColor={theme.colors.menuInfo}
					paddingX={2}
					paddingY={1}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">{t.systemPromptConfig.title}</Gradient>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.systemPromptConfig.subtitle}
						</Text>
					</Box>
				</Box>

				{error && (
					<Box marginBottom={1}>
						<Alert variant="error">{error}</Alert>
					</Box>
				)}

				<Box marginBottom={1}>
					<Text bold>
						{t.systemPromptConfig.activePrompt}{' '}
						<Text color={theme.colors.success}>
							{activePrompt?.name || t.systemPromptConfig.none}
						</Text>
					</Text>
				</Box>

				{config.prompts.length === 0 ? (
					<Box marginBottom={1}>
						<Text color={theme.colors.warning}>
							{t.systemPromptConfig.noPromptsConfigured}
						</Text>
					</Box>
				) : (
					<Box flexDirection="column" marginBottom={1}>
						<Text bold color={theme.colors.menuInfo}>
							{t.systemPromptConfig.availablePrompts}
						</Text>
						{config.prompts.map((prompt, index) => (
							<Box key={prompt.id} marginLeft={2}>
								<Text
									color={
										index === selectedIndex
											? theme.colors.menuSelected
											: prompt.id === config.active
											? theme.colors.menuInfo
											: theme.colors.menuNormal
									}
								>
									{index === selectedIndex ? '❯ ' : '  '}
									{prompt.id === config.active ? '✓ ' : '  '}
									{prompt.name}
									{prompt.content && (
										<Text dimColor>
											{' '}
											- {prompt.content.substring(0, 50)}
											{prompt.content.length > 50 ? '...' : ''}
										</Text>
									)}
								</Text>
							</Box>
						))}
					</Box>
				)}

				<Box marginBottom={1}>
					<Text bold color={theme.colors.menuInfo}>
						{t.systemPromptConfig.actions}
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
							{action === 'activate' && t.systemPromptConfig.activate}
							{action === 'deactivate' && t.systemPromptConfig.deactivate}
							{action === 'edit' && t.systemPromptConfig.edit}
							{action === 'delete' && t.systemPromptConfig.delete}
							{action === 'add' && t.systemPromptConfig.addNew}
							{action === 'back' && t.systemPromptConfig.escBack}
						</Text>
					))}
				</Box>

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.systemPromptConfig.navigationHint}
					</Text>
				</Box>
			</Box>
		);
	}

	// Render add/edit view
	if (view === 'add' || view === 'edit') {
		return (
			<Box flexDirection="column" padding={1}>
				<Box
					marginBottom={1}
					borderStyle="round"
					borderColor={theme.colors.menuInfo}
					paddingX={2}
					paddingY={1}
				>
					<Gradient name="rainbow">
						{view === 'add'
							? t.systemPromptConfig.addNewTitle
							: t.systemPromptConfig.editTitle}
					</Gradient>
				</Box>

				{error && (
					<Box marginBottom={1}>
						<Alert variant="error">{error}</Alert>
					</Box>
				)}

				<Box flexDirection="column" marginBottom={1}>
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
								{t.systemPromptConfig.nameLabel}
							</Text>
							{editingField === 'name' && isEditing && (
								<Box marginLeft={3}>
									<TextInput
										value={editName}
										onChange={setEditName}
										placeholder={t.systemPromptConfig.enterPromptName}
									/>
								</Box>
							)}
							{(!isEditing || editingField !== 'name') && (
								<Box marginLeft={3}>
									<Text color={theme.colors.menuSecondary}>
										{editName || t.systemPromptConfig.notSet}
									</Text>
								</Box>
							)}
						</Box>
					</Box>

					<Box marginBottom={1}>
						<Box flexDirection="column">
							<Text
								color={
									editingField === 'content'
										? theme.colors.menuSelected
										: theme.colors.menuNormal
								}
							>
								{editingField === 'content' ? '❯ ' : '  '}
								{t.systemPromptConfig.contentLabel}
							</Text>
							{editingField === 'content' && isEditing && (
								<Box marginLeft={3}>
									<TextInput
										value={editContent}
										onChange={setEditContent}
										placeholder={t.systemPromptConfig.enterPromptContent}
									/>
								</Box>
							)}
							{(!isEditing || editingField !== 'content') && (
								<Box marginLeft={3}>
									<Text color={theme.colors.menuSecondary}>
										{editContent
											? editContent.substring(0, 100) +
											  (editContent.length > 100 ? '...' : '')
											: t.systemPromptConfig.notSet}
									</Text>
								</Box>
							)}
						</Box>
					</Box>
				</Box>

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.systemPromptConfig.editingHint}
					</Text>
				</Box>
			</Box>
		);
	}

	// Render delete confirmation
	if (view === 'confirmDelete') {
		const promptToDelete =
			config.prompts.length > 0 ? config.prompts[selectedIndex] : null;

		return (
			<Box flexDirection="column" padding={1}>
				<Alert variant="warning">{t.systemPromptConfig.confirmDelete}</Alert>

				<Box marginBottom={1}>
					<Text>
						{t.systemPromptConfig.deleteConfirmMessage} "
						<Text bold color={theme.colors.warning}>
							{promptToDelete?.name}
						</Text>
						"?
					</Text>
				</Box>

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.systemPromptConfig.confirmHint}
					</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
