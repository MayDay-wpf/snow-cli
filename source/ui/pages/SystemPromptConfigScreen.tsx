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
} from '../../utils/apiConfig.js';

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
	const [currentAction, setCurrentAction] = useState<ListAction>('activate');
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
			setError(err instanceof Error ? err.message : 'Failed to save');
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
					borderColor="cyan"
					paddingX={2}
					paddingY={1}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">System Prompt Management</Gradient>
						<Text color="gray" dimColor>
							Manage multiple system prompts and switch between them
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
						Active Prompt:{' '}
						<Text color="green">{activePrompt?.name || 'None'}</Text>
					</Text>
				</Box>

				{config.prompts.length === 0 ? (
					<Box marginBottom={1}>
						<Text color="yellow">
							No system prompts configured. Press Enter to add one.
						</Text>
					</Box>
				) : (
					<Box flexDirection="column" marginBottom={1}>
						<Text bold color="cyan">
							Available Prompts:
						</Text>
						{config.prompts.map((prompt, index) => (
							<Box key={prompt.id} marginLeft={2}>
								<Text
									color={
										index === selectedIndex
											? 'green'
											: prompt.id === config.active
											? 'cyan'
											: 'white'
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
					<Text bold color="cyan">
						Actions:
					</Text>
				</Box>
				<Box flexDirection="column" marginBottom={1} marginLeft={2}>
					{actions.map(action => (
						<Text
							key={action}
							color={currentAction === action ? 'green' : 'gray'}
							bold={currentAction === action}
						>
							{currentAction === action ? '❯ ' : '  '}
							{action === 'activate' && 'Activate'}
							{action === 'deactivate' && 'Deactivate'}
							{action === 'edit' && 'Edit'}
							{action === 'delete' && 'Delete'}
							{action === 'add' && 'Add New'}
							{action === 'back' && '[ESC] Back'}
						</Text>
					))}
				</Box>

				<Box marginTop={1}>
					<Text color="gray" dimColor>
						Use ↑↓ to select prompt, ←→ to select action, Enter to confirm
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
					borderColor="cyan"
					paddingX={2}
					paddingY={1}
				>
					<Gradient name="rainbow">
						{view === 'add' ? 'Add New System Prompt' : 'Edit System Prompt'}
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
							<Text color={editingField === 'name' ? 'green' : 'white'}>
								{editingField === 'name' ? '❯ ' : '  '}Name:
							</Text>
							{editingField === 'name' && isEditing && (
								<Box marginLeft={3}>
									<TextInput
										value={editName}
										onChange={setEditName}
										placeholder="Enter prompt name"
									/>
								</Box>
							)}
							{(!isEditing || editingField !== 'name') && (
								<Box marginLeft={3}>
									<Text color="gray">{editName || 'Not set'}</Text>
								</Box>
							)}
						</Box>
					</Box>

					<Box marginBottom={1}>
						<Box flexDirection="column">
							<Text color={editingField === 'content' ? 'green' : 'white'}>
								{editingField === 'content' ? '❯ ' : '  '}Content:
							</Text>
							{editingField === 'content' && isEditing && (
								<Box marginLeft={3}>
									<TextInput
										value={editContent}
										onChange={setEditContent}
										placeholder="Enter prompt content"
									/>
								</Box>
							)}
							{(!isEditing || editingField !== 'content') && (
								<Box marginLeft={3}>
									<Text color="gray">
										{editContent
											? editContent.substring(0, 100) +
											  (editContent.length > 100 ? '...' : '')
											: 'Not set'}
									</Text>
								</Box>
							)}
						</Box>
					</Box>
				</Box>

				<Box marginTop={1}>
					<Text color="gray" dimColor>
						↑↓: Navigate fields | Enter: Edit | Ctrl+S: Save | ESC: Cancel
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
				<Alert variant="warning">Confirm Delete</Alert>

				<Box marginBottom={1}>
					<Text>
						Are you sure you want to delete "
						<Text bold color="yellow">
							{promptToDelete?.name}
						</Text>
						"?
					</Text>
				</Box>

				<Box marginTop={1}>
					<Text color="gray" dimColor>
						Press Y to confirm, N or ESC to cancel
					</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
