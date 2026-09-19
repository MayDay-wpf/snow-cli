import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import ScrollableSelectInput from '../components/common/ScrollableSelectInput.js';
import {
	getDecisionModelsConfig,
	saveDecisionModelsConfig,
	type DecisionModelItem,
	type DecisionModelsConfig,
} from '../../utils/config/decisionModelsConfig.js';
import type {BaseUrlMode} from '../../utils/config/apiConfig.js';
import {stripFocusArtifacts} from './configScreen/types.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';

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

type FormField = 'name' | 'baseUrl' | 'baseUrlMode' | 'apiKey' | 'model';

const FORM_FIELDS: FormField[] = [
	'name',
	'baseUrl',
	'baseUrlMode',
	'apiKey',
	'model',
];

// 只有 URL 模式需要下拉选择：决策模型有自己的请求体，没有 LLM 式的「请求方案」
const SELECT_FORM_FIELDS: FormField[] = ['baseUrlMode'];

const buildEmptyForm = () => ({
	name: '',
	baseUrl: '',
	baseUrlMode: 'auto' as BaseUrlMode,
	apiKey: '',
	model: '',
});

type FormState = ReturnType<typeof buildEmptyForm>;

/**
 * 决策模型管理页面。
 *
 * 决策模型独立于 LLM 的 snowcfg：可配置多个条目，同一时间仅一个「激活」。
 * 配置落盘于 ~/.snow/decision-models.json（见 utils/config/decisionModelsConfig.ts）。
 */
export default function DecisionModelConfigScreen({onBack}: Props) {
	const {t} = useI18n();
	useTerminalTitle(`Snow CLI - ${t.decisionModels.title}`);
	const {theme} = useTheme();

	const [config, setConfig] = useState<DecisionModelsConfig>(
		() => getDecisionModelsConfig() ?? {active: '', models: []},
	);
	const [view, setView] = useState<View>('list');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [currentAction, setCurrentAction] = useState<ListAction>('add');
	const [formIndex, setFormIndex] = useState(0);
	const [isEditing, setIsEditing] = useState(false);
	const [form, setForm] = useState<FormState>(buildEmptyForm);
	const [error, setError] = useState('');

	const actions: ListAction[] =
		config.models.length > 0
			? config.active
				? ['activate', 'deactivate', 'edit', 'delete', 'add', 'back']
				: ['activate', 'edit', 'delete', 'add', 'back']
			: ['add', 'back'];

	const activeField: FormField = FORM_FIELDS[formIndex] ?? 'name';
	const isSelectEditing = isEditing && SELECT_FORM_FIELDS.includes(activeField);

	// 配置变化后，保证 currentAction 始终落在可用操作列表中
	useEffect(() => {
		if (!actions.includes(currentAction)) {
			setCurrentAction(actions[0] ?? 'add');
		}
	}, [config.models.length, config.active]);

	// 每次回到列表视图时重新读取磁盘，避免与其他入口的修改不同步
	useEffect(() => {
		const savedConfig = getDecisionModelsConfig();
		if (savedConfig) {
			setConfig(savedConfig);
		}
	}, [view]);

	const saveAndRefresh = (nextConfig: DecisionModelsConfig) => {
		try {
			saveDecisionModelsConfig(nextConfig);
			setConfig(nextConfig);
			setError('');
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : t.decisionModels.saveError);
			return false;
		}
	};

	const handleActivate = () => {
		if (config.models.length === 0 || selectedIndex >= config.models.length) {
			return;
		}

		const target = config.models[selectedIndex]!;
		saveAndRefresh({...config, active: target.id});
	};

	const handleDeactivate = () => {
		saveAndRefresh({...config, active: ''});
	};

	const handleAdd = () => {
		setForm(buildEmptyForm());
		setFormIndex(0);
		setIsEditing(false);
		setError('');
		setView('add');
	};

	const handleEdit = () => {
		if (config.models.length === 0 || selectedIndex >= config.models.length) {
			return;
		}

		const target = config.models[selectedIndex]!;
		setForm({
			name: target.name,
			baseUrl: target.baseUrl,
			baseUrlMode: target.baseUrlMode,
			apiKey: target.apiKey,
			model: target.model,
		});
		setFormIndex(0);
		setIsEditing(false);
		setError('');
		setView('edit');
	};

	const handleDelete = () => {
		if (config.models.length === 0 || selectedIndex >= config.models.length) {
			return;
		}

		setView('confirmDelete');
	};

	const confirmDelete = () => {
		if (config.models.length === 0 || selectedIndex >= config.models.length) {
			return;
		}

		const removed = config.models[selectedIndex]!;
		const remaining = config.models.filter(
			(_, index) => index !== selectedIndex,
		);
		const nextConfig: DecisionModelsConfig = {
			// 删除的恰好是激活项时，顺延激活剩余的第一项（与自定义请求头行为一致）
			active:
				config.active === removed.id ? remaining[0]?.id ?? '' : config.active,
			models: remaining,
		};

		if (saveAndRefresh(nextConfig)) {
			setSelectedIndex(Math.max(0, selectedIndex - 1));
			setView('list');
		}
	};

	const saveForm = () => {
		const payload = {
			name: form.name.trim() || t.decisionModels.untitled,
			baseUrl: form.baseUrl.trim(),
			baseUrlMode: form.baseUrlMode,
			apiKey: form.apiKey.trim(),
			model: form.model.trim(),
		};

		if (view === 'add') {
			const newModel: DecisionModelItem = {
				id: Date.now().toString(),
				...payload,
				createdAt: new Date().toISOString(),
			};
			const nextConfig: DecisionModelsConfig = {
				...config,
				models: [...config.models, newModel],
				active: config.models.length === 0 ? newModel.id : config.active,
			};

			if (saveAndRefresh(nextConfig)) {
				setSelectedIndex(config.models.length);
				setView('list');
			}
			return;
		}

		if (config.models.length === 0 || selectedIndex >= config.models.length) {
			return;
		}

		const nextConfig: DecisionModelsConfig = {
			...config,
			models: config.models.map((item, index) =>
				index === selectedIndex ? {...item, ...payload} : item,
			),
		};

		if (saveAndRefresh(nextConfig)) {
			setView('list');
		}
	};

	// 列表视图输入处理
	useInput(
		(_input, key) => {
			if (view !== 'list') return;

			if (key.escape) {
				onBack();
			} else if (key.upArrow) {
				if (config.models.length > 0) {
					setSelectedIndex(prev =>
						prev > 0 ? prev - 1 : config.models.length - 1,
					);
				}
			} else if (key.downArrow) {
				if (config.models.length > 0) {
					setSelectedIndex(prev =>
						prev < config.models.length - 1 ? prev + 1 : 0,
					);
				}
			} else if (key.leftArrow) {
				const currentIndex = actions.indexOf(currentAction);
				setCurrentAction(
					actions[currentIndex > 0 ? currentIndex - 1 : actions.length - 1]!,
				);
			} else if (key.rightArrow) {
				const currentIndex = actions.indexOf(currentAction);
				setCurrentAction(
					actions[currentIndex < actions.length - 1 ? currentIndex + 1 : 0]!,
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

	// 新增/编辑视图输入处理
	useInput(
		(input, key) => {
			if (view !== 'add' && view !== 'edit') return;

			if (key.escape) {
				if (isEditing) {
					setIsEditing(false);
					return;
				}
				setView('list');
				setError('');
				return;
			}

			if (input === 's' && (key.ctrl || key.meta)) {
				saveForm();
				return;
			}

			if (!isEditing) {
				if (key.upArrow) {
					setFormIndex(prev => (prev > 0 ? prev - 1 : FORM_FIELDS.length - 1));
					return;
				}
				if (key.downArrow) {
					setFormIndex(prev => (prev < FORM_FIELDS.length - 1 ? prev + 1 : 0));
					return;
				}
			}

			if (key.return) {
				// 选择类字段的 Enter 交给 ScrollableSelectInput 处理
				if (isSelectEditing) return;
				setIsEditing(prev => !prev);
			}
		},
		{isActive: view === 'add' || view === 'edit'},
	);

	// 删除确认视图输入处理
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

	const renderFormField = (field: FormField) => {
		const index = FORM_FIELDS.indexOf(field);
		const isActive = index === formIndex;
		const isCurrentlyEditing = isActive && isEditing;
		const indicator = isActive ? '❯ ' : '  ';
		const color = isActive
			? theme.colors.menuSelected
			: theme.colors.menuNormal;

		if (field === 'baseUrlMode') {
			const options: Array<{label: string; value: string}> = [
				{label: t.configScreen.baseUrlModeAuto, value: 'auto'},
				{label: t.configScreen.baseUrlModeBase, value: 'base'},
				{label: t.configScreen.baseUrlModeEndpoint, value: 'endpoint'},
			];
			const currentValue = form.baseUrlMode;
			const display =
				options.find(option => option.value === currentValue)?.label ?? '';

			return (
				<Box key={field} flexDirection="column" marginBottom={1}>
					<Text color={color}>
						{indicator}
						{t.decisionModels.baseUrlModeLabel}
					</Text>
					{isCurrentlyEditing ? (
						<Box marginLeft={3} flexDirection="column">
							<ScrollableSelectInput
								items={options}
								initialIndex={Math.max(
									0,
									options.findIndex(option => option.value === currentValue),
								)}
								isFocused={true}
								onSelect={item => {
									setForm(prev => ({
										...prev,
										baseUrlMode: item.value as BaseUrlMode,
									}));
									setIsEditing(false);
								}}
							/>
							<Text color={theme.colors.menuSecondary} dimColor>
								{t.decisionModels.selectHint}
							</Text>
						</Box>
					) : (
						<Box marginLeft={3}>
							<Text color={theme.colors.menuSecondary}>{display}</Text>
						</Box>
					)}
				</Box>
			);
		}

		const textFieldMeta: Record<
			'name' | 'baseUrl' | 'apiKey' | 'model',
			{
				label: string;
				value: string;
				placeholder: string;
				mask?: string;
				onChange: (value: string) => void;
			}
		> = {
			name: {
				label: t.decisionModels.nameLabel,
				value: form.name,
				placeholder: t.decisionModels.namePlaceholder,
				onChange: value =>
					setForm(prev => ({...prev, name: stripFocusArtifacts(value)})),
			},
			baseUrl: {
				label: t.decisionModels.baseUrlLabel,
				value: form.baseUrl,
				placeholder: 'https://openrouter.ai/api/v1',
				onChange: value =>
					setForm(prev => ({...prev, baseUrl: stripFocusArtifacts(value)})),
			},
			apiKey: {
				label: t.decisionModels.apiKeyLabel,
				value: form.apiKey,
				placeholder: 'sk-...',
				mask: '*',
				onChange: value =>
					setForm(prev => ({...prev, apiKey: stripFocusArtifacts(value)})),
			},
			model: {
				label: t.decisionModels.modelLabel,
				value: form.model,
				placeholder: 'typesafe/jev-1.13',
				onChange: value =>
					setForm(prev => ({...prev, model: stripFocusArtifacts(value)})),
			},
		};

		const meta = textFieldMeta[field];
		const displayValue =
			field === 'apiKey'
				? meta.value
					? '*'.repeat(Math.min(meta.value.length, 20))
					: t.decisionModels.notSet
				: meta.value || t.decisionModels.notSet;

		return (
			<Box key={field} flexDirection="column" marginBottom={1}>
				<Text color={color}>
					{indicator}
					{meta.label}
				</Text>
				{isCurrentlyEditing ? (
					<Box marginLeft={3}>
						<TextInput
							value={meta.value}
							onChange={meta.onChange}
							placeholder={meta.placeholder}
							{...(meta.mask ? {mask: meta.mask} : {})}
						/>
					</Box>
				) : (
					<Box marginLeft={3}>
						<Text color={theme.colors.menuSecondary}>{displayValue}</Text>
					</Box>
				)}
			</Box>
		);
	};

	// 列表视图
	if (view === 'list') {
		const activeModel = config.models.find(item => item.id === config.active);

		return (
			<Box flexDirection="column" padding={1}>
				{error && (
					<Box marginBottom={1}>
						<Alert variant="error">{error}</Alert>
					</Box>
				)}

				<Box marginBottom={1}>
					<Text bold>
						{t.decisionModels.activeModel}{' '}
						<Text color={theme.colors.success}>
							{activeModel?.name || t.decisionModels.none}
						</Text>
					</Text>
				</Box>

				{config.models.length === 0 ? (
					<Box marginBottom={1}>
						<Text color={theme.colors.warning}>
							{t.decisionModels.noModelsConfigured}
						</Text>
					</Box>
				) : (
					<Box flexDirection="column" marginBottom={1}>
						<Text bold color={theme.colors.menuInfo}>
							{t.decisionModels.availableModels}
						</Text>
						{config.models.map((item, index) => (
							<Box key={item.id} marginLeft={2}>
								<Text
									color={
										index === selectedIndex
											? theme.colors.menuSelected
											: item.id === config.active
											? theme.colors.menuInfo
											: theme.colors.menuNormal
									}
								>
									{index === selectedIndex ? '❯ ' : '  '}
									{item.id === config.active ? '✓ ' : '  '}
									{item.name}
									{item.model ? <Text dimColor> - {item.model}</Text> : null}
								</Text>
							</Box>
						))}
					</Box>
				)}

				<Box marginBottom={1}>
					<Text bold color={theme.colors.menuInfo}>
						{t.decisionModels.actions}
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
							{action === 'activate' && t.decisionModels.activate}
							{action === 'deactivate' && t.decisionModels.deactivate}
							{action === 'edit' && t.decisionModels.edit}
							{action === 'delete' && t.decisionModels.delete}
							{action === 'add' && t.decisionModels.addNew}
							{action === 'back' && t.decisionModels.escBack}
						</Text>
					))}
				</Box>

				<Box marginTop={1} flexDirection="column">
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.decisionModels.subtitle}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.decisionModels.navigationHint}
					</Text>
				</Box>
			</Box>
		);
	}

	// 新增/编辑视图
	if (view === 'add' || view === 'edit') {
		return (
			<Box flexDirection="column" padding={1}>
				{error && (
					<Box marginBottom={1}>
						<Alert variant="error">{error}</Alert>
					</Box>
				)}

				<Box marginBottom={1}>
					<Text bold color={theme.colors.menuInfo}>
						{view === 'add'
							? t.decisionModels.addNewTitle
							: t.decisionModels.editTitle}
					</Text>
				</Box>

				{FORM_FIELDS.map(field => renderFormField(field))}

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.decisionModels.editingHint}
					</Text>
				</Box>
			</Box>
		);
	}

	// 删除确认视图
	if (view === 'confirmDelete') {
		const target =
			config.models.length > 0 ? config.models[selectedIndex] : null;

		return (
			<Box flexDirection="column" padding={1}>
				<Alert variant="warning">{t.decisionModels.confirmDelete}</Alert>

				<Box marginBottom={1}>
					<Text>
						{t.decisionModels.deleteConfirmMessage} "
						<Text bold color={theme.colors.warning}>
							{target?.name}
						</Text>
						"?
					</Text>
				</Box>

				<Box marginTop={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.decisionModels.confirmHint}
					</Text>
				</Box>
			</Box>
		);
	}

	return null;
}
