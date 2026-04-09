import React, {useState, useCallback, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {Alert} from '@inkjs/ui';
import {
	getAllSensitiveCommands,
	toggleSensitiveCommand,
	addSensitiveCommand,
	removeSensitiveCommand,
	resetToDefaults,
	isDuplicatePattern,
	type SensitiveCommand,
	type SensitiveCommandScope,
} from '../../utils/execution/sensitiveCommandManager.js';
import {useI18n} from '../../i18n/index.js';
import {useTheme} from '../contexts/ThemeContext.js';

// Focus event handling
const focusEventTokenRegex = /(?:\x1b)?\[[0-9;]*[IO]/g;

const isFocusEventInput = (value?: string) => {
	if (!value) return false;
	if (
		value === '\x1b[I' ||
		value === '\x1b[O' ||
		value === '[I' ||
		value === '[O'
	) {
		return true;
	}
	const trimmed = value.trim();
	if (!trimmed) return false;
	const tokens = trimmed.match(focusEventTokenRegex);
	if (!tokens) return false;
	const normalized = trimmed.replace(/\s+/g, '');
	const tokensCombined = tokens.join('');
	return tokensCombined === normalized;
};

const stripFocusArtifacts = (value: string) => {
	if (!value) return '';
	return value
		.replace(/\x1b\[[0-9;]*[IO]/g, '')
		.replace(/\[[0-9;]*[IO]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

type Props = {
	onBack: () => void;
	inlineMode?: boolean;
};

type ViewMode = 'list' | 'scope-select' | 'add';
type ScopeSelectPurpose = 'add' | 'reset';

const SCOPE_OPTIONS: SensitiveCommandScope[] = ['project', 'global'];

export default function SensitiveCommandConfigScreen({
	onBack,
	inlineMode = false,
}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [commands, setCommands] = useState<SensitiveCommand[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [viewMode, setViewMode] = useState<ViewMode>('list');
	const [showSuccess, setShowSuccess] = useState(false);
	const [successMessage, setSuccessMessage] = useState('');

	// Confirmation states
	const [confirmDelete, setConfirmDelete] = useState(false);

	// Scope selection states
	const [scopeSelectIndex, setScopeSelectIndex] = useState(0);
	const [scopeSelectPurpose, setScopeSelectPurpose] =
		useState<ScopeSelectPurpose>('add');
	const [selectedScope, setSelectedScope] =
		useState<SensitiveCommandScope>('global');
	const [confirmResetScope, setConfirmResetScope] = useState(false);

	// Add custom command fields
	const [customPattern, setCustomPattern] = useState('');
	const [customDescription, setCustomDescription] = useState('');
	const [addField, setAddField] = useState<'pattern' | 'description'>(
		'pattern',
	);
	const [addError, setAddError] = useState('');

	const getScopeLabel = useCallback(
		(scope: SensitiveCommandScope) => {
			return scope === 'project'
				? t.sensitiveCommandConfig.scopeProject
				: t.sensitiveCommandConfig.scopeGlobal;
		},
		[t],
	);

	// Load commands
	const loadCommands = useCallback(() => {
		const allCommands = getAllSensitiveCommands();
		setCommands(allCommands);
	}, []);

	useEffect(() => {
		loadCommands();
	}, [loadCommands]);

	// Handle list view input
	const handleListInput = useCallback(
		(input: string, key: any) => {
			if (key.escape) {
				if (confirmDelete) {
					setConfirmDelete(false);
					return;
				}
				onBack();
				return;
			}

			if (key.upArrow) {
				if (commands.length === 0) return;
				setSelectedIndex(prev => (prev > 0 ? prev - 1 : commands.length - 1));
				setConfirmDelete(false);
			} else if (key.downArrow) {
				if (commands.length === 0) return;
				setSelectedIndex(prev => (prev < commands.length - 1 ? prev + 1 : 0));
				setConfirmDelete(false);
			} else if (input === ' ') {
				const cmd = commands[selectedIndex];
				if (cmd) {
					toggleSensitiveCommand(cmd.id, cmd.scope);
					loadCommands();
					const message = cmd.enabled
						? t.sensitiveCommandConfig.disabledMessage
						: t.sensitiveCommandConfig.enabledMessage;
					setSuccessMessage(message.replace('{pattern}', cmd.pattern));
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
				}
			} else if (input === 'a' || input === 'A') {
				setScopeSelectPurpose('add');
				setScopeSelectIndex(0);
				setConfirmResetScope(false);
				setViewMode('scope-select');
			} else if (input === 'd' || input === 'D') {
				const cmd = commands[selectedIndex];
				if (cmd && !cmd.isPreset) {
					if (!confirmDelete) {
						setConfirmDelete(true);
					} else {
						removeSensitiveCommand(cmd.id, cmd.scope);
						loadCommands();
						setSelectedIndex(prev => Math.min(prev, commands.length - 2));
						setSuccessMessage(
							t.sensitiveCommandConfig.deletedMessage.replace(
								'{pattern}',
								cmd.pattern,
							),
						);
						setShowSuccess(true);
						setTimeout(() => setShowSuccess(false), 2000);
						setConfirmDelete(false);
					}
				}
			} else if (input === 'r' || input === 'R') {
				setScopeSelectPurpose('reset');
				setScopeSelectIndex(0);
				setConfirmResetScope(false);
				setViewMode('scope-select');
			}
		},
		[commands, selectedIndex, onBack, loadCommands, confirmDelete, t],
	);

	// Handle scope selection input (shared for add & reset)
	const handleScopeSelectInput = useCallback(
		(_input: string, key: any) => {
			if (key.escape) {
				if (confirmResetScope) {
					setConfirmResetScope(false);
					return;
				}
				setViewMode('list');
				return;
			}

			if (confirmResetScope) {
				if (key.return) {
					const scope = SCOPE_OPTIONS[scopeSelectIndex]!;
					resetToDefaults(scope);
					loadCommands();
					setSelectedIndex(0);
					setSuccessMessage(t.sensitiveCommandConfig.resetMessage);
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
					setConfirmResetScope(false);
					setViewMode('list');
				}
				return;
			}

			if (key.upArrow) {
				setScopeSelectIndex(prev =>
					prev > 0 ? prev - 1 : SCOPE_OPTIONS.length - 1,
				);
			} else if (key.downArrow) {
				setScopeSelectIndex(prev =>
					prev < SCOPE_OPTIONS.length - 1 ? prev + 1 : 0,
				);
			} else if (key.return) {
				const scope = SCOPE_OPTIONS[scopeSelectIndex]!;
				if (scopeSelectPurpose === 'add') {
					setSelectedScope(scope);
					setViewMode('add');
					setCustomPattern('');
					setCustomDescription('');
					setAddField('pattern');
					setAddError('');
				} else {
					setConfirmResetScope(true);
				}
			}
		},
		[
			scopeSelectIndex,
			scopeSelectPurpose,
			confirmResetScope,
			loadCommands,
			t,
		],
	);

	// Handle add view input — ESC returns to scope-select
	const handleAddInput = useCallback((_input: string, key: any) => {
		if (key.escape) {
			setViewMode('scope-select');
			setAddError('');
			return;
		}

		if (key.tab) {
			setAddField(prev => (prev === 'pattern' ? 'description' : 'pattern'));
		}
	}, []);

	// Use input hook
	useInput(
		(input, key) => {
			if (viewMode === 'list') {
				handleListInput(input, key);
			} else if (viewMode === 'scope-select') {
				handleScopeSelectInput(input, key);
			} else {
				handleAddInput(input, key);
			}
		},
		{isActive: true},
	);

	// Handle pattern input change
	const handlePatternChange = useCallback((value: string) => {
		if (!isFocusEventInput(value)) {
			setCustomPattern(stripFocusArtifacts(value));
			setAddError('');
		}
	}, []);

	// Handle description input change
	const handleDescriptionChange = useCallback((value: string) => {
		if (!isFocusEventInput(value)) {
			setCustomDescription(stripFocusArtifacts(value));
		}
	}, []);

	// Handle add submit
	const handleAddSubmit = useCallback(() => {
		if (addField === 'pattern') {
			if (customPattern.trim()) {
				const {isDuplicate, existingScope} = isDuplicatePattern(
					customPattern.trim(),
				);
				if (isDuplicate) {
					setAddError(
						t.sensitiveCommandConfig.duplicatePattern
							.replace('{pattern}', customPattern.trim())
							.replace('{scope}', getScopeLabel(existingScope!)),
					);
					return;
				}
			}
			setAddField('description');
		} else {
			if (customPattern.trim() && customDescription.trim()) {
				try {
					addSensitiveCommand(
						customPattern.trim(),
						customDescription.trim(),
						selectedScope,
					);
					loadCommands();
					setViewMode('list');
					setSuccessMessage(
						t.sensitiveCommandConfig.addedMessage.replace(
							'{pattern}',
							customPattern,
						),
					);
					setShowSuccess(true);
					setTimeout(() => setShowSuccess(false), 2000);
					setAddError('');
				} catch (error: any) {
					if (
						typeof error?.message === 'string' &&
						error.message.startsWith('DUPLICATE:')
					) {
						const scope = error.message.split(':')[1] as SensitiveCommandScope;
						setAddError(
							t.sensitiveCommandConfig.duplicatePattern
								.replace('{pattern}', customPattern.trim())
								.replace('{scope}', getScopeLabel(scope)),
						);
					}
				}
			}
		}
	}, [
		addField,
		customPattern,
		customDescription,
		selectedScope,
		loadCommands,
		t,
		getScopeLabel,
	]);

	// Scope selection view (shared for add & reset)
	if (viewMode === 'scope-select') {
		const isReset = scopeSelectPurpose === 'reset';
		const title = isReset
			? t.sensitiveCommandConfig.resetScopeSelectTitle
			: t.sensitiveCommandConfig.scopeSelectTitle;

		const scopeItems: Array<{
			label: string;
			desc: string;
			scope: SensitiveCommandScope;
		}> = [
			{
				label: t.sensitiveCommandConfig.scopeProject,
				desc: isReset
					? t.sensitiveCommandConfig.resetProjectDesc
					: '.snow/sensitive-commands.json',
				scope: 'project',
			},
			{
				label: t.sensitiveCommandConfig.scopeGlobal,
				desc: isReset
					? t.sensitiveCommandConfig.resetGlobalDesc
					: '~/.snow/sensitive-commands.json',
				scope: 'global',
			},
		];

		return (
			<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
				<Text bold color={theme.colors.menuInfo}>
					{title}
				</Text>

				<Box marginTop={1} flexDirection="column">
					{scopeItems.map((item, idx) => {
						const isSelected = idx === scopeSelectIndex;
						return (
							<Box key={item.scope} marginBottom={1} flexDirection="column">
								<Text
									color={
										isSelected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
									bold={isSelected}
								>
									{isSelected ? '> ' : '  '}
									{item.label}
								</Text>
								<Box marginLeft={3}>
									<Text color={theme.colors.menuSecondary} dimColor>
										{item.desc}
									</Text>
								</Box>
							</Box>
						);
					})}
				</Box>

				{confirmResetScope && (
					<Box marginTop={1}>
						<Text bold color={theme.colors.warning}>
							{t.sensitiveCommandConfig.confirmResetScopeMessage.replace(
								'{scope}',
								getScopeLabel(SCOPE_OPTIONS[scopeSelectIndex]!),
							)}
						</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Text dimColor>
						{confirmResetScope
							? t.sensitiveCommandConfig.confirmHint
							: t.sensitiveCommandConfig.scopeSelectHint}
					</Text>
				</Box>
			</Box>
		);
	}

	if (viewMode === 'add') {
		return (
			<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
				<Text bold color={theme.colors.menuInfo}>
					{t.sensitiveCommandConfig.addTitle.replace(
						'{scope}',
						getScopeLabel(selectedScope),
					)}
				</Text>
				<Box marginTop={1} />

				<Text dimColor>{t.sensitiveCommandConfig.patternLabel}</Text>
				<Box>
					<Text
						color={
							addField === 'pattern'
								? theme.colors.menuInfo
								: theme.colors.menuSecondary
						}
					>
						❯{' '}
					</Text>
					<TextInput
						value={customPattern}
						onChange={handlePatternChange}
						onSubmit={handleAddSubmit}
						focus={addField === 'pattern'}
						placeholder={t.sensitiveCommandConfig.patternPlaceholder}
					/>
				</Box>

				{addError && (
					<Box marginTop={0}>
						<Text color={theme.colors.warning}>⚠️ {addError}</Text>
					</Box>
				)}

				<Box marginTop={1} />
				<Text dimColor>{t.sensitiveCommandConfig.descriptionLabel}</Text>
				<Box>
					<Text
						color={
							addField === 'description'
								? theme.colors.menuInfo
								: theme.colors.menuSecondary
						}
					>
						❯{' '}
					</Text>
					<TextInput
						value={customDescription}
						onChange={handleDescriptionChange}
						onSubmit={handleAddSubmit}
						focus={addField === 'description'}
					/>
				</Box>

				<Box marginTop={1} />
				<Text dimColor>{t.sensitiveCommandConfig.addEditingHint}</Text>
			</Box>
		);
	}

	// Calculate visible range for scrolling
	const viewportHeight = 13;
	const startIndex = Math.max(
		0,
		selectedIndex - Math.floor(viewportHeight / 2),
	);
	const endIndex = Math.min(commands.length, startIndex + viewportHeight);
	const adjustedStart = Math.max(0, endIndex - viewportHeight);

	const selectedCmd = commands[selectedIndex];

	return (
		<Box flexDirection="column" paddingX={inlineMode ? 0 : 2} paddingY={1}>
			<Text bold color={theme.colors.menuInfo}>
				{t.sensitiveCommandConfig.title}
			</Text>
			<Text dimColor>{t.sensitiveCommandConfig.subtitle}</Text>

			{showSuccess && (
				<Box marginTop={1}>
					<Alert variant="success">{successMessage}</Alert>
				</Box>
			)}

			<Box marginTop={1} />

			{commands.length === 0 ? (
				<Text dimColor>{t.sensitiveCommandConfig.noCommands}</Text>
			) : (
				commands.map((cmd, index) => {
					if (index < adjustedStart || index >= endIndex) {
						return null;
					}

					const scopeTag = cmd.isPreset
						? ''
						: ` · ${getScopeLabel(cmd.scope)}`;

					return (
						<Text
							key={`${cmd.scope}-${cmd.id}`}
							color={
								selectedIndex === index
									? theme.colors.menuInfo
									: cmd.enabled
										? theme.colors.menuNormal
										: theme.colors.menuSecondary
							}
							bold={selectedIndex === index}
							dimColor={!cmd.enabled}
						>
							{selectedIndex === index ? '❯ ' : '  '}[{cmd.enabled ? '✓' : ' '}]{' '}
							{cmd.pattern}
							{!cmd.isPreset && (
								<Text color={theme.colors.warning}>
									{' '}
									({t.sensitiveCommandConfig.custom}
									{scopeTag})
								</Text>
							)}
						</Text>
					);
				})
			)}

			<Box marginTop={1} />
			{selectedCmd && !confirmDelete && (
				<Text dimColor>
					{selectedCmd.description} (
					{selectedCmd.enabled
						? t.sensitiveCommandConfig.enabled
						: t.sensitiveCommandConfig.disabled}
					)
					{!selectedCmd.isPreset &&
						` [${t.sensitiveCommandConfig.customLabel}]`}
				</Text>
			)}

			{confirmDelete && selectedCmd && (
				<Text bold color={theme.colors.warning}>
					{t.sensitiveCommandConfig.confirmDeleteMessage.replace(
						'{pattern}',
						selectedCmd.pattern,
					)}
				</Text>
			)}

			<Box marginTop={1} />
			<Text dimColor>
				{confirmDelete
					? t.sensitiveCommandConfig.confirmHint
					: t.sensitiveCommandConfig.listNavigationHint}
			</Text>
		</Box>
	);
}
