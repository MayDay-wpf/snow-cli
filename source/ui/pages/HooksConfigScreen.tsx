import React, {useState, useCallback} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {Alert} from '@inkjs/ui';
import Menu from '../components/Menu.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useI18n} from '../../i18n/index.js';
import {
	getAllHookTypes,
	listConfiguredHooks,
	loadHookConfig,
	saveHookConfig,
	deleteHookConfig,
	type HookType,
	type HookScope,
	type HookRule,
	type HookAction,
	type HookActionType,
} from '../../utils/config/hooksConfig.js';

type Props = {
	onBack: () => void;
};

type Screen =
	| 'scope-select' // 选择作用域（全局/项目）
	| 'hook-list' // Hook 列表
	| 'hook-detail' // Hook 详情
	| 'rule-edit' // 编辑规则
	| 'action-edit'; // 编辑动作

type RuleField = 'description' | 'matcher';
type ActionField = 'enabled' | 'type' | 'command' | 'prompt' | 'timeout';

export default function HooksConfigScreen({onBack}: Props) {
	const {theme} = useTheme();
	const {t} = useI18n();

	const [screen, setScreen] = useState<Screen>('scope-select');
	const [selectedScope, setSelectedScope] = useState<HookScope>('project');
	const [selectedHookType, setSelectedHookType] = useState<HookType | null>(
		null,
	);
	const [selectedRuleIndex, setSelectedRuleIndex] = useState<number>(-1);
	const [editingRule, setEditingRule] = useState<HookRule | null>(null);
	const [selectedHookInfo, setSelectedHookInfo] = useState('');

	// 规则编辑状态
	const [editingRuleField, setEditingRuleField] = useState<RuleField | null>(
		null,
	);
	const [ruleFieldValue, setRuleFieldValue] = useState('');

	// Action 编辑状态
	const [selectedActionIndex, setSelectedActionIndex] = useState<number>(-1);
	const [editingAction, setEditingAction] = useState<HookAction | null>(null);
	const [editingActionField, setEditingActionField] =
		useState<ActionField | null>(null);
	const [actionFieldValue, setActionFieldValue] = useState('');

	// 验证是否可以添加指定类型的 Action
	const canAddActionType = useCallback(
		(newType: HookActionType, currentHooks: HookAction[]): boolean => {
			// prompt 类型只能在 onSubAgentComplete 和 onStop 中使用
			if (newType === 'prompt') {
				if (
					selectedHookType !== 'onSubAgentComplete' &&
					selectedHookType !== 'onStop'
				) {
					return false; // 其他 Hook 类型不允许使用 prompt
				}
				// 如果要添加 Prompt，不能有任何现有 Action
				return currentHooks.length === 0;
			}

			if (newType === 'command') {
				const hasPrompt = currentHooks.some(h => h.type === 'prompt');
				// 如果要添加 Command，不能有 Prompt
				return !hasPrompt;
			}

			return false;
		},
		[selectedHookType],
	);

	// 返回上一级
	const handleBack = useCallback(() => {
		if (screen === 'scope-select') {
			onBack();
		} else if (screen === 'hook-list') {
			setScreen('scope-select');
		} else if (screen === 'hook-detail') {
			setScreen('hook-list');
			setSelectedHookType(null);
		} else if (screen === 'rule-edit') {
			setScreen('hook-detail');
			setEditingRule(null);
			setSelectedRuleIndex(-1);
			setEditingRuleField(null);
		} else if (screen === 'action-edit') {
			setScreen('rule-edit');
			setEditingAction(null);
			setSelectedActionIndex(-1);
			setEditingActionField(null);
		}
	}, [screen, onBack]);

	// 作用域选择
	const renderScopeSelect = () => {
		const options = [
			{
				label: t.hooksConfig.scopeSelect.globalHooks,
				value: 'global',
				infoText: t.hooksConfig.scopeSelect.globalInfo,
				color: theme.colors.menuInfo,
			},
			{
				label: t.hooksConfig.scopeSelect.projectHooks,
				value: 'project',
				infoText: t.hooksConfig.scopeSelect.projectInfo,
				color: theme.colors.success,
			},
			{
				label: t.hooksConfig.scopeSelect.back,
				value: 'back',
				infoText: t.hooksConfig.scopeSelect.backInfo,
				color: theme.colors.error,
			},
		];

		return (
			<>
				<Menu
					options={options}
					onSelect={value => {
						if (value === 'back') {
							onBack();
						} else {
							setSelectedScope(value as HookScope);
							setScreen('hook-list');
						}
					}}
					onSelectionChange={infoText => {
						setSelectedHookInfo(infoText);
					}}
				/>
				{selectedHookInfo && (
					<Box marginTop={1}>
						<Alert variant="info">{selectedHookInfo}</Alert>
					</Box>
				)}
			</>
		);
	};

	// Hook 类型列表
	const renderHookList = () => {
		const allHooks = getAllHookTypes();
		const configuredHooks = listConfiguredHooks(selectedScope);

		const options = allHooks.map(hookType => {
			const isConfigured = configuredHooks.includes(hookType);
			const rules = isConfigured ? loadHookConfig(hookType, selectedScope) : [];
			const ruleCount = rules.length;
			const icon = isConfigured ? '[✓]' : '[ ]';

			return {
				label: `${icon} ${hookType}${
					ruleCount > 0 ? ` (${ruleCount} ${t.hooksConfig.hookList.rules})` : ''
				}`,
				value: hookType,
				infoText: (t.hooksConfig.hookTypes as any)[hookType] || hookType,
				color: isConfigured ? theme.colors.success : theme.colors.menuNormal,
			};
		});

		options.push({
			label: t.hooksConfig.hookList.back,
			value: 'back' as any,
			infoText: t.hooksConfig.hookList.backInfo,
			color: theme.colors.error,
		});

		return (
			<>
				<Box marginBottom={1}>
					<Text bold color={theme.colors.menuSelected}>
						{t.hooksConfig.hookList.title} -{' '}
						{selectedScope === 'global'
							? t.hooksConfig.hookList.global
							: t.hooksConfig.hookList.project}
					</Text>
				</Box>
				<Menu
					options={options}
					onSelect={value => {
						if (value === 'back') {
							handleBack();
						} else {
							setSelectedHookType(value as HookType);
							setScreen('hook-detail');
						}
					}}
					onSelectionChange={infoText => {
						setSelectedHookInfo(infoText);
					}}
				/>
			</>
		);
	};

	// Hook 详情页面
	const renderHookDetail = () => {
		if (!selectedHookType) return null;

		const rules = loadHookConfig(selectedHookType, selectedScope);

		// 只有工具Hooks才显示matcher信息
		const isToolHook =
			selectedHookType === 'beforeToolCall' ||
			selectedHookType === 'afterToolCall';

		const options = rules.map((rule, index) => ({
			label: `${t.hooksConfig.hookDetail.rule} ${index + 1}: ${
				rule.description
			}`,
			value: `rule-${index}`,
			infoText: `${rule.hooks.length} ${t.hooksConfig.hookDetail.actions}${
				isToolHook && rule.matcher
					? ` | ${t.hooksConfig.hookDetail.matcher}: ${rule.matcher}`
					: ''
			}`,
			color: theme.colors.menuNormal,
		}));

		options.push(
			{
				label: t.hooksConfig.hookDetail.addNewRule,
				value: 'add',
				infoText: t.hooksConfig.hookDetail.addNewRuleInfo,
				color: theme.colors.success,
			},
			{
				label: t.hooksConfig.hookDetail.deleteHook,
				value: 'delete',
				infoText: t.hooksConfig.hookDetail.deleteHookInfo,
				color: theme.colors.warning,
			},
			{
				label: t.hooksConfig.hookDetail.back,
				value: 'back',
				infoText: t.hooksConfig.hookDetail.backInfo,
				color: theme.colors.error,
			},
		);

		return (
			<>
				<Box marginBottom={1} flexDirection="column">
					<Text bold color={theme.colors.menuSelected}>
						{selectedHookType}
					</Text>
					<Text color={theme.colors.menuSecondary}>
						{(t.hooksConfig.hookTypes as any)[selectedHookType] ||
							selectedHookType}
					</Text>
				</Box>
				<Menu
					options={options}
					onSelect={value => {
						if (value === 'back') {
							handleBack();
						} else if (value === 'add') {
							// 创建新规则
							setEditingRule({
								description: 'New Rule',
								hooks: [],
							});
							setSelectedRuleIndex(-1);
							setScreen('rule-edit');
						} else if (value === 'delete') {
							// 删除配置
							deleteHookConfig(selectedHookType, selectedScope);
							handleBack();
						} else {
							// 编辑规则
							const index = parseInt(value.replace('rule-', ''));
							setSelectedRuleIndex(index);
							setEditingRule({...rules[index]!});
							setScreen('rule-edit');
						}
					}}
				/>
			</>
		);
	};

	// 规则编辑页面
	const renderRuleEdit = () => {
		if (!editingRule || !selectedHookType) return null;

		// 如果正在编辑字段，显示输入框
		if (editingRuleField) {
			const isMatcherField = editingRuleField === 'matcher';
			return (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text bold color={theme.colors.menuSelected}>
							{editingRuleField === 'description'
								? t.hooksConfig.ruleEdit.editDescription
								: t.hooksConfig.ruleEdit.editMatcher}
						</Text>
					</Box>
					{isMatcherField && (
						<Box marginBottom={1}>
							<Text color={theme.colors.menuInfo}>
								{t.hooksConfig.ruleEdit.matcherHint}
							</Text>
						</Box>
					)}
					<Box>
						<Text color={theme.colors.success}>&gt; </Text>
						<TextInput
							value={ruleFieldValue}
							onChange={setRuleFieldValue}
							onSubmit={() => {
								// 保存字段值
								setEditingRule({
									...editingRule,
									[editingRuleField]: ruleFieldValue,
								});
								setEditingRuleField(null);
								setRuleFieldValue('');
							}}
						/>
					</Box>
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary}>
							{t.hooksConfig.ruleEdit.enterToSave}
						</Text>
					</Box>
				</Box>
			);
		}

		// 只有工具Hooks才需要matcher
		const isToolHook =
			selectedHookType === 'beforeToolCall' ||
			selectedHookType === 'afterToolCall';

		const options = [
			{
				label: `${t.hooksConfig.ruleEdit.editDescriptionLabel}: ${editingRule.description}`,
				value: 'edit-description',
				infoText: t.hooksConfig.ruleEdit.clickToEdit,
				color: theme.colors.menuInfo,
			},
		];

		// 只有工具Hooks才显示matcher选项
		if (isToolHook) {
			options.push({
				label: `${t.hooksConfig.ruleEdit.editMatcherLabel}: ${
					editingRule.matcher || t.hooksConfig.actionEdit.commandNotSet
				}`,
				value: 'edit-matcher',
				infoText: t.hooksConfig.ruleEdit.clickToEditMatcher,
				color: theme.colors.menuInfo,
			});
		}

		// 显示所有 actions
		editingRule.hooks.forEach((action, index) => {
			const enabled = action.enabled !== false;
			const enabledIcon = enabled ? '[✓]' : '[ ]';
			const actionLabel =
				action.type === 'command'
					? `${action.command || ''}`
					: `${action.prompt || ''}`;
			const label = `${enabledIcon} ${index + 1}. ${
				action.type
			}: ${actionLabel}`;

			options.push({
				label,
				value: `action-${index}`,
				infoText: action.timeout
					? `Timeout: ${action.timeout}ms`
					: 'No timeout',
				color: enabled ? theme.colors.menuNormal : theme.colors.menuSecondary,
			});
		});

		options.push(
			{
				label: t.hooksConfig.ruleEdit.addAction,
				value: 'add-action',
				infoText: t.hooksConfig.ruleEdit.addActionInfo,
				color: theme.colors.success,
			},
			{
				label: t.hooksConfig.ruleEdit.deleteRule,
				value: 'delete-rule',
				infoText: t.hooksConfig.ruleEdit.deleteRuleInfo,
				color: theme.colors.warning,
			},
			{
				label: t.hooksConfig.ruleEdit.saveRule,
				value: 'save',
				infoText: t.hooksConfig.ruleEdit.saveRuleInfo,
				color: theme.colors.success,
			},
			{
				label: t.hooksConfig.ruleEdit.cancel,
				value: 'back',
				infoText: t.hooksConfig.ruleEdit.cancelInfo,
				color: theme.colors.error,
			},
		);

		return (
			<>
				<Box marginBottom={1} flexDirection="column">
					<Text bold color={theme.colors.menuSelected}>
						{t.hooksConfig.ruleEdit.title}
					</Text>
					<Text color={theme.colors.menuSecondary}>
						{t.hooksConfig.ruleEdit.hint}
					</Text>
				</Box>
				<Menu
					options={options}
					onSelect={value => {
						if (value === 'back') {
							handleBack();
						} else if (value === 'save') {
							// 保存规则
							const rules = loadHookConfig(selectedHookType, selectedScope);
							if (selectedRuleIndex >= 0) {
								// 更新现有规则
								rules[selectedRuleIndex] = editingRule;
							} else {
								// 添加新规则
								rules.push(editingRule);
							}
							saveHookConfig(selectedHookType, selectedScope, rules);
							handleBack();
						} else if (value === 'add-action') {
							// 添加默认 action
							// 检查当前 hooks 中的类型，决定新 Action 的默认类型
							const currentHooks = editingRule.hooks;
							const hasPrompt = currentHooks.some(h => h.type === 'prompt');

							if (hasPrompt) {
								// 已有 Prompt，不能再添加任何 Action
								return;
							}

							// 决定新 Action 的默认类型
							// 如果是 onSubAgentComplete 或 onStop，且没有现有 hooks，默认为 prompt
							// 否则只能使用 command
							const defaultType: HookActionType =
								(selectedHookType === 'onSubAgentComplete' ||
									selectedHookType === 'onStop') &&
								currentHooks.length === 0
									? 'prompt'
									: 'command';

							const newAction: HookAction =
								defaultType === 'prompt'
									? {
											type: 'prompt',
											prompt: 'What should I do next?',
											timeout: 30000,
											enabled: true,
									  }
									: {
											type: 'command',
											command: 'echo "Hello from hook"',
											timeout: 5000,
											enabled: true,
									  };

							setEditingRule({
								...editingRule,
								hooks: [...editingRule.hooks, newAction],
							});
						} else if (value === 'delete-rule') {
							// 删除当前规则
							const rules = loadHookConfig(selectedHookType, selectedScope);
							if (selectedRuleIndex >= 0) {
								rules.splice(selectedRuleIndex, 1);
								saveHookConfig(selectedHookType, selectedScope, rules);
							}
							handleBack();
						} else if (value === 'edit-description') {
							setEditingRuleField('description');
							setRuleFieldValue(editingRule.description);
						} else if (value === 'edit-matcher') {
							setEditingRuleField('matcher');
							setRuleFieldValue(editingRule.matcher || '');
						} else if (value.startsWith('action-')) {
							// 编辑 action
							const index = parseInt(value.replace('action-', ''));
							setSelectedActionIndex(index);
							setEditingAction({...editingRule.hooks[index]!});
							setScreen('action-edit');
						}
					}}
				/>
			</>
		);
	};

	// Action 编辑页面
	const renderActionEdit = () => {
		if (!editingAction || !editingRule) return null;

		// 如果正在编辑字段，显示输入框
		if (
			editingActionField &&
			editingActionField !== 'enabled' &&
			editingActionField !== 'type'
		) {
			return (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text bold color={theme.colors.menuSelected}>
							编辑 {editingActionField}
						</Text>
					</Box>
					<Box>
						<Text color={theme.colors.success}>&gt; </Text>
						<TextInput
							value={actionFieldValue}
							onChange={setActionFieldValue}
							onSubmit={() => {
								// 保存字段值
								const value =
									editingActionField === 'timeout'
										? actionFieldValue
											? parseInt(actionFieldValue)
											: undefined
										: actionFieldValue || undefined;

								setEditingAction({
									...editingAction,
									[editingActionField]: value,
								});
								setEditingActionField(null);
								setActionFieldValue('');
							}}
						/>
					</Box>
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary}>
							{t.hooksConfig.actionEdit.enterToSave}
						</Text>
					</Box>
				</Box>
			);
		}

		const enabled = editingAction.enabled !== false;
		const enabledIcon = enabled ? '[✓]' : '[ ]';

		const options = [
			{
				label: `${enabledIcon} ${t.hooksConfig.actionEdit.enabled}`,
				value: 'enabled',
				infoText: t.hooksConfig.actionEdit.enabledInfo,
				color: enabled ? theme.colors.success : theme.colors.menuSecondary,
			},
			{
				label: `${t.hooksConfig.actionEdit.type}: ${editingAction.type}`,
				value: 'type',
				infoText: t.hooksConfig.actionEdit.typeInfo,
				color: theme.colors.menuInfo,
			},
		];

		if (editingAction.type === 'command') {
			options.push({
				label: `${t.hooksConfig.actionEdit.command}: ${
					editingAction.command || t.hooksConfig.actionEdit.commandNotSet
				}`,
				value: 'command',
				infoText: t.hooksConfig.actionEdit.commandInfo,
				color: theme.colors.menuNormal,
			});
		} else {
			options.push({
				label: `${t.hooksConfig.actionEdit.prompt}: ${
					editingAction.prompt || t.hooksConfig.actionEdit.promptNotSet
				}`,
				value: 'prompt',
				infoText: t.hooksConfig.actionEdit.promptInfo,
				color: theme.colors.menuNormal,
			});
		}

		options.push(
			{
				label: `${t.hooksConfig.actionEdit.timeout}: ${
					editingAction.timeout || t.hooksConfig.actionEdit.commandNotSet
				}`,
				value: 'timeout',
				infoText: t.hooksConfig.actionEdit.timeoutInfo,
				color: theme.colors.menuNormal,
			},
			{
				label: t.hooksConfig.actionEdit.deleteAction,
				value: 'delete',
				infoText: t.hooksConfig.actionEdit.deleteActionInfo,
				color: theme.colors.warning,
			},
			{
				label: t.hooksConfig.actionEdit.saveAction,
				value: 'save',
				infoText: t.hooksConfig.actionEdit.saveActionInfo,
				color: theme.colors.success,
			},
			{
				label: t.hooksConfig.actionEdit.cancel,
				value: 'back',
				infoText: t.hooksConfig.actionEdit.cancelInfo,
				color: theme.colors.error,
			},
		);

		return (
			<>
				<Box marginBottom={1} flexDirection="column">
					<Text bold color={theme.colors.menuSelected}>
						{t.hooksConfig.actionEdit.title}
					</Text>
					<Text color={theme.colors.menuSecondary}>
						{t.hooksConfig.actionEdit.hint}
					</Text>
				</Box>
				<Menu
					options={options}
					onSelect={value => {
						if (value === 'back') {
							handleBack();
						} else if (value === 'save') {
							// 保存 action
							const newHooks = [...editingRule.hooks];
							if (selectedActionIndex >= 0) {
								newHooks[selectedActionIndex] = editingAction;
							} else {
								newHooks.push(editingAction);
							}
							setEditingRule({
								...editingRule,
								hooks: newHooks,
							});
							handleBack();
						} else if (value === 'delete') {
							// 删除 action
							const newHooks = editingRule.hooks.filter(
								(_, i) => i !== selectedActionIndex,
							);
							setEditingRule({
								...editingRule,
								hooks: newHooks,
							});
							handleBack();
						} else if (value === 'enabled') {
							// 切换启用状态
							setEditingAction({
								...editingAction,
								enabled: !enabled,
							});
						} else if (value === 'type') {
							// 切换类型
							const newType: HookActionType =
								editingAction.type === 'command' ? 'prompt' : 'command';

							// 检查规则中除当前 Action 外的其他 Actions
							const otherActions = editingRule.hooks.filter(
								(_, i) => i !== selectedActionIndex,
							);

							// 验证是否可以切换到新类型
							if (!canAddActionType(newType, otherActions)) {
								// 不能切换类型，因为与现有 Actions 冲突
								// 这里可以显示错误提示，暂时直接返回
								return;
							}

							setEditingAction({
								...editingAction,
								type: newType,
								// 清除旧类型的字段
								command:
									newType === 'command' ? editingAction.command : undefined,
								prompt: newType === 'prompt' ? editingAction.prompt : undefined,
							});
						} else if (value === 'command') {
							setEditingActionField('command');
							setActionFieldValue(editingAction.command || '');
						} else if (value === 'prompt') {
							setEditingActionField('prompt');
							setActionFieldValue(editingAction.prompt || '');
						} else if (value === 'timeout') {
							setEditingActionField('timeout');
							setActionFieldValue(editingAction.timeout?.toString() || '');
						}
					}}
				/>
			</>
		);
	};

	// 处理键盘快捷键
	useInput(
		(input, key) => {
			if (key.escape) {
				// 如果正在编辑字段，先取消编辑
				if (editingRuleField) {
					setEditingRuleField(null);
					setRuleFieldValue('');
				} else if (editingActionField) {
					setEditingActionField(null);
					setActionFieldValue('');
				} else {
					// 否则返回上一级
					handleBack();
				}
			} else if (input === 'd' || input === 'D') {
				// D 键删除规则或 Action
				// 如果正在编辑字段，忽略
				if (editingRuleField || editingActionField) {
					return;
				}

				if (screen === 'rule-edit' && editingRule && selectedHookType) {
					// 删除当前规则
					const rules = loadHookConfig(selectedHookType, selectedScope);
					if (selectedRuleIndex >= 0) {
						rules.splice(selectedRuleIndex, 1);
						saveHookConfig(selectedHookType, selectedScope, rules);
					}
					handleBack();
				} else if (
					screen === 'action-edit' &&
					editingAction &&
					editingRule &&
					selectedActionIndex >= 0
				) {
					// 删除当前 Action
					const newHooks = editingRule.hooks.filter(
						(_, i) => i !== selectedActionIndex,
					);
					setEditingRule({
						...editingRule,
						hooks: newHooks,
					});
					handleBack();
				}
			}
		},
		{isActive: true},
	);

	// 根据当前屏幕渲染
	return (
		<Box flexDirection="column" padding={1}>
			{screen === 'scope-select' && renderScopeSelect()}
			{screen === 'hook-list' && renderHookList()}
			{screen === 'hook-detail' && renderHookDetail()}
			{screen === 'rule-edit' && renderRuleEdit()}
			{screen === 'action-edit' && renderActionEdit()}

			{selectedHookInfo && screen === 'hook-list' && (
				<Box marginTop={1}>
					<Alert variant="info">{selectedHookInfo}</Alert>
				</Box>
			)}
		</Box>
	);
}
