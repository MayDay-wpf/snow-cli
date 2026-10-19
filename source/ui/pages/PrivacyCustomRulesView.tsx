import React, {useCallback, useMemo, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import Menu from '../components/common/Menu.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {
	readSettings,
	updateSettings,
	type SettingsScope,
} from '../../utils/config/unifiedSettings.js';
import {
	isCustomRuleEnabled,
	newCustomRuleId,
	previewCustomRules,
	validateCustomRule,
	validateCustomRules,
	type PrivacyCustomRule,
} from '../../api/privacyMaskCustomRules.js';

type Props = {
	scope: SettingsScope;
	onBack: () => void;
	onInfoChange: (infoText: string) => void;
};

type View = 'list' | 'rule';
type DraftField = 'name' | 'pattern' | 'group' | 'replacement' | 'sample';

type RuleDraft = {
	id: string;
	name: string;
	pattern: string;
	group: string;
	replacement: string;
	enabled: boolean;
};

const PREVIEW_MAX_CHARS = 60;

export function loadCustomRules(scope: SettingsScope): PrivacyCustomRule[] {
	return readSettings(scope).privacy?.customRules ?? [];
}

function truncate(value: string, maxLength: number): string {
	const singleLine = value.replace(/\s+/g, ' ');
	return singleLine.length > maxLength
		? `${singleLine.slice(0, maxLength - 3)}...`
		: singleLine;
}

function toDraft(rule?: PrivacyCustomRule): RuleDraft {
	return {
		id: rule?.id ?? newCustomRuleId(),
		name: rule?.name ?? '',
		pattern: rule?.pattern ?? '',
		group: String(rule?.group ?? 0),
		replacement: rule?.replacement ?? '',
		enabled: rule ? isCustomRuleEnabled(rule) : true,
	};
}

function draftToRule(draft: RuleDraft): PrivacyCustomRule | null {
	const groupText = draft.group.trim() || '0';
	if (!/^\d+$/.test(groupText)) {
		return null;
	}
	const group = Number(groupText);
	const rule: PrivacyCustomRule = {
		id: draft.id,
		name: draft.name.trim(),
		pattern: draft.pattern,
		enabled: draft.enabled,
	};
	if (group > 0) {
		rule.group = group;
	}
	if (draft.replacement) {
		rule.replacement = draft.replacement;
	}
	return rule;
}

export default function PrivacyCustomRulesView({
	scope,
	onBack,
	onInfoChange,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [rules, setRules] = useState<PrivacyCustomRule[]>(() =>
		loadCustomRules(scope),
	);
	const [view, setView] = useState<View>('list');
	const [draft, setDraft] = useState<RuleDraft>(() => toDraft());
	const [isNewRule, setIsNewRule] = useState(true);
	const [editingField, setEditingField] = useState<DraftField | undefined>();
	const [editingInitialValue, setEditingInitialValue] = useState('');
	const [sample, setSample] = useState('');
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [listIndex, setListIndex] = useState(0);
	const [ruleMenuIndex, setRuleMenuIndex] = useState(0);

	const persistRules = useCallback(
		(nextRules: PrivacyCustomRule[]) => {
			updateSettings(scope, settings => {
				settings.privacy = {
					...settings.privacy,
					customRules: nextRules,
				};
			});
			setRules(nextRules);
		},
		[scope],
	);

	const openRule = useCallback((rule: PrivacyCustomRule | undefined) => {
		setDraft(toDraft(rule));
		setIsNewRule(!rule);
		setSample('');
		setError(null);
		setConfirmDelete(false);
		setEditingField(undefined);
		setRuleMenuIndex(0);
		setView('rule');
	}, []);

	const returnToList = useCallback(
		(message?: string) => {
			setEditingField(undefined);
			setConfirmDelete(false);
			setError(null);
			setView('list');
			if (message) {
				onInfoChange(message);
			}
		},
		[onInfoChange],
	);

	const saveDraft = useCallback(() => {
		const rule = draftToRule(draft);
		if (!rule) {
			setError(t.privacySettings.ruleGroupInvalid);
			return;
		}
		const nextRules = isNewRule
			? [...rules, rule]
			: rules.map(item => (item.id === rule.id ? rule : item));
		const validationError =
			validateCustomRule(rule) ?? validateCustomRules(nextRules);
		if (validationError) {
			setError(validationError);
			return;
		}
		persistRules(nextRules);
		const index = nextRules.findIndex(item => item.id === rule.id);
		setListIndex(index >= 0 ? index : 0);
		returnToList(t.privacySettings.ruleSaved);
	}, [draft, isNewRule, persistRules, returnToList, rules, t.privacySettings]);

	const deleteDraft = useCallback(() => {
		if (!confirmDelete) {
			setConfirmDelete(true);
			return;
		}
		const nextRules = rules.filter(item => item.id !== draft.id);
		persistRules(nextRules);
		setListIndex(0);
		returnToList(t.privacySettings.ruleDeleted);
	}, [
		confirmDelete,
		draft.id,
		persistRules,
		returnToList,
		rules,
		t.privacySettings.ruleDeleted,
	]);

	const previewResult = useMemo(() => {
		if (!sample || !draft.pattern) {
			return null;
		}
		const rule = draftToRule({...draft, enabled: true});
		if (!rule) {
			return null;
		}
		const validationError = validateCustomRule({
			...rule,
			name: rule.name || rule.id,
		});
		if (validationError) {
			return {ok: false, text: validationError};
		}
		return {ok: true, text: previewCustomRules(sample, [rule])};
	}, [draft, sample]);

	const listOptions = useMemo(() => {
		const options: Array<{
			label: string;
			value: string;
			infoText: string;
			color?: string;
		}> = rules.map(rule => ({
			label: `${isCustomRuleEnabled(rule) ? '[✓]' : '[ ]'} ${truncate(
				rule.name,
				30,
			)}  /${truncate(rule.pattern, 40)}/`,
			value: `rule:${rule.id}`,
			infoText: `${rule.name}: ${truncate(rule.pattern, 200)}`,
		}));
		options.push(
			{
				label: t.privacySettings.addRule,
				value: 'add',
				infoText: t.privacySettings.addRuleInfo,
			},
			{
				label: t.privacySettings.back,
				value: 'back',
				color: theme.colors.menuSecondary,
				infoText: t.privacySettings.customRulesBackInfo,
			},
		);
		return options;
	}, [rules, t.privacySettings, theme.colors.menuSecondary]);

	const ruleOptions = useMemo(() => {
		const notSet = t.privacySettings.notSet;
		const options: Array<{
			label: string;
			value: string;
			infoText: string;
			color?: string;
		}> = [
			{
				label: `${t.privacySettings.ruleNameLabel}: ${
					draft.name ? truncate(draft.name, 50) : notSet
				}`,
				value: 'name',
				infoText: t.privacySettings.ruleNameInfo,
			},
			{
				label: `${t.privacySettings.rulePatternLabel}: ${
					draft.pattern ? truncate(draft.pattern, 60) : notSet
				}`,
				value: 'pattern',
				infoText: t.privacySettings.rulePatternInfo,
			},
			{
				label: `${t.privacySettings.ruleGroupLabel}: ${draft.group || '0'}`,
				value: 'group',
				infoText: t.privacySettings.ruleGroupInfo,
			},
			{
				label: `${t.privacySettings.ruleReplacementLabel}: ${
					draft.replacement
						? truncate(draft.replacement, 40)
						: t.privacySettings.ruleReplacementEmpty
				}`,
				value: 'replacement',
				infoText: t.privacySettings.ruleReplacementInfo,
			},
			{
				label: `${t.privacySettings.ruleEnabledLabel}: ${
					draft.enabled ? t.privacySettings.enabled : t.privacySettings.disabled
				}`,
				value: 'toggle-enabled',
				infoText: t.privacySettings.ruleEnabledInfo,
			},
			{
				label: `${t.privacySettings.ruleSampleLabel}: ${
					sample ? truncate(sample, 50) : notSet
				}`,
				value: 'sample',
				infoText: t.privacySettings.ruleSampleInfo,
			},
			{
				label: t.privacySettings.ruleSave,
				value: 'save',
				infoText: t.privacySettings.ruleSaveInfo,
			},
		];
		if (!isNewRule) {
			options.push({
				label: confirmDelete
					? t.privacySettings.ruleDeleteConfirm
					: t.privacySettings.ruleDelete,
				value: 'delete',
				color: theme.colors.warning,
				infoText: t.privacySettings.ruleDeleteInfo,
			});
		}
		options.push({
			label: t.privacySettings.ruleCancel,
			value: 'cancel',
			color: theme.colors.menuSecondary,
			infoText: t.privacySettings.ruleCancelInfo,
		});
		return options;
	}, [
		confirmDelete,
		draft,
		isNewRule,
		sample,
		t.privacySettings,
		theme.colors.menuSecondary,
		theme.colors.warning,
	]);

	const handleListSelect = useCallback(
		(value: string) => {
			if (value === 'back') {
				onBack();
				return;
			}
			if (value === 'add') {
				setListIndex(rules.length);
				openRule(undefined);
				return;
			}
			const ruleId = value.slice('rule:'.length);
			const index = rules.findIndex(rule => rule.id === ruleId);
			if (index >= 0) {
				setListIndex(index);
				openRule(rules[index]);
			}
		},
		[onBack, openRule, rules],
	);

	const handleRuleSelect = useCallback(
		(value: string) => {
			const index = ruleOptions.findIndex(option => option.value === value);
			setRuleMenuIndex(index >= 0 ? index : 0);
			if (value !== 'delete') {
				setConfirmDelete(false);
			}

			if (value === 'cancel') {
				returnToList();
			} else if (value === 'save') {
				saveDraft();
			} else if (value === 'delete') {
				deleteDraft();
			} else if (value === 'toggle-enabled') {
				setDraft(current => ({...current, enabled: !current.enabled}));
			} else {
				const field = value as DraftField;
				setEditingInitialValue(field === 'sample' ? sample : draft[field]);
				setEditingField(field);
				setError(null);
			}
		},
		[deleteDraft, draft, returnToList, ruleOptions, sample, saveDraft],
	);

	const updateEditingValue = useCallback(
		(value: string) => {
			if (!editingField) return;
			if (editingField === 'sample') {
				setSample(value);
			} else {
				setDraft(current => ({...current, [editingField]: value}));
			}
		},
		[editingField],
	);

	const handleFieldSubmit = useCallback(() => {
		setEditingField(undefined);
		setEditingInitialValue('');
	}, []);

	useInput((_input, key) => {
		if (!key.escape) return;

		if (editingField) {
			updateEditingValue(editingInitialValue);
			setEditingField(undefined);
			setEditingInitialValue('');
			return;
		}

		if (view === 'rule') {
			returnToList();
			return;
		}

		onBack();
	});

	const editingLabel =
		editingField === 'name'
			? t.privacySettings.ruleNameLabel
			: editingField === 'pattern'
			? t.privacySettings.rulePatternLabel
			: editingField === 'group'
			? t.privacySettings.ruleGroupLabel
			: editingField === 'replacement'
			? t.privacySettings.ruleReplacementLabel
			: t.privacySettings.ruleSampleLabel;
	const editingValue =
		editingField === 'sample'
			? sample
			: editingField
			? draft[editingField]
			: '';

	return (
		<Box flexDirection="column">
			<Box paddingX={1} marginBottom={1}>
				<Text bold color={theme.colors.menuInfo}>
					{view === 'list'
						? `${t.privacySettings.customRules} (${rules.length})`
						: isNewRule
						? t.privacySettings.addRule
						: `${t.privacySettings.customRules}: ${truncate(
								draft.name || draft.id,
								40,
						  )}`}
				</Text>
			</Box>

			{view === 'list' && rules.length === 0 && (
				<Box paddingX={1}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.privacySettings.ruleEmptyList}
					</Text>
				</Box>
			)}

			{view === 'list' && (
				<Menu
					options={listOptions}
					onSelect={handleListSelect}
					onSelectionChange={onInfoChange}
					defaultIndex={listIndex}
				/>
			)}

			{view === 'rule' &&
				(editingField ? (
					<Box paddingX={1}>
						<Text color={theme.colors.menuInfo}>{editingLabel}: </Text>
						<TextInput
							value={editingValue}
							onChange={updateEditingValue}
							onSubmit={handleFieldSubmit}
						/>
					</Box>
				) : (
					<Menu
						options={ruleOptions}
						onSelect={handleRuleSelect}
						onSelectionChange={onInfoChange}
						defaultIndex={ruleMenuIndex}
					/>
				))}

			{view === 'rule' && previewResult && (
				<Box paddingX={1} flexDirection="column">
					<Text color={theme.colors.menuSecondary}>
						{t.privacySettings.ruleSampleResult}:
					</Text>
					<Text
						color={previewResult.ok ? theme.colors.success : theme.colors.error}
					>
						{truncate(previewResult.text, PREVIEW_MAX_CHARS * 4)}
					</Text>
				</Box>
			)}

			{error && (
				<Box paddingX={1}>
					<Text color={theme.colors.error}>{error}</Text>
				</Box>
			)}
		</Box>
	);
}
