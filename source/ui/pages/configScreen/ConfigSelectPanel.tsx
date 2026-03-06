import React from 'react';
import {Box, Text} from 'ink';
import ScrollableSelectInput from '../../components/common/ScrollableSelectInput.js';
import type {RequestMethod} from '../../../utils/config/apiConfig.js';
import {switchProfile} from '../../../utils/config/configManager.js';
import type {ConfigStateReturn} from './useConfigState.js';

type Props = {
	state: ConfigStateReturn;
};

export default function ConfigSelectPanel({state}: Props) {
	const {
		t,
		theme,
		currentField,
		setIsEditing,
		requestMethod,
		setRequestMethod,
		requestMethodOptions,
		searchTerm,
		thinkingMode,
		setThinkingMode,
		thinkingEffort,
		setThinkingEffort,
		responsesVerbosity,
		setResponsesVerbosity,
		getCurrentOptions,
		getCurrentValue,
		getCustomHeadersSchemeSelectItems,
		getCustomHeadersSchemeSelectedValue,
		applyCustomHeadersSchemeSelectValue,
		handleModelChange,
	} = state;

	const getFieldLabel = () => {
		switch (currentField) {
			case 'profile':
				return t.configScreen.profile.replace(':', '');
			case 'requestMethod':
				return t.configScreen.requestMethod.replace(':', '');
			case 'advancedModel':
				return t.configScreen.advancedModel.replace(':', '');
			case 'basicModel':
				return t.configScreen.basicModel.replace(':', '');
			case 'thinkingMode':
				return t.configScreen.thinkingMode.replace(':', '');
			case 'thinkingEffort':
				return t.configScreen.thinkingEffort.replace(':', '');
			case 'responsesReasoningEffort':
				return t.configScreen.responsesReasoningEffort.replace(':', '');
			case 'responsesVerbosity':
				return t.configScreen.responsesVerbosity.replace(':', '');
			case 'systemPromptId':
				return t.configScreen.systemPrompt;
			case 'customHeadersSchemeId':
				return t.configScreen.customHeadersField;
			default:
				return '';
		}
	};

	return (
		<Box flexDirection="column">
			<Text color={theme.colors.menuSelected}>❯ {getFieldLabel()}</Text>
			<Box marginLeft={3} marginTop={1}>
				{currentField === 'profile' && <ProfileSelect state={state} />}
				{currentField === 'requestMethod' && (
					<ScrollableSelectInput
						items={requestMethodOptions}
						initialIndex={requestMethodOptions.findIndex(
							opt => opt.value === requestMethod,
						)}
						isFocused={true}
						onSelect={item => {
							setRequestMethod(item.value as RequestMethod);
							setIsEditing(false);
						}}
					/>
				)}
				{currentField === 'systemPromptId' && (
					<SystemPromptSelect state={state} />
				)}
				{currentField === 'customHeadersSchemeId' &&
					(() => {
						const items = getCustomHeadersSchemeSelectItems();
						const selected = getCustomHeadersSchemeSelectedValue();
						return (
							<ScrollableSelectInput
								items={items}
								limit={10}
								initialIndex={Math.max(
									0,
									items.findIndex(opt => opt.value === selected),
								)}
								isFocused={true}
								onSelect={item => {
									applyCustomHeadersSchemeSelectValue(item.value);
									setIsEditing(false);
								}}
							/>
						);
					})()}
				{(currentField === 'advancedModel' ||
					currentField === 'basicModel') && (
					<Box flexDirection="column">
						{searchTerm && (
							<Text color={theme.colors.menuInfo}>
								Filter: {searchTerm}
							</Text>
						)}
						<ScrollableSelectInput
							items={getCurrentOptions()}
							limit={10}
							disableNumberShortcuts={true}
							initialIndex={Math.max(
								0,
								getCurrentOptions().findIndex(
									opt => opt.value === getCurrentValue(),
								),
							)}
							isFocused={true}
							onSelect={item => {
								handleModelChange(item.value);
							}}
						/>
					</Box>
				)}
				{currentField === 'thinkingMode' && (
					<ScrollableSelectInput
						items={[
							{label: t.configScreen.thinkingModeTokens, value: 'tokens'},
							{
								label: t.configScreen.thinkingModeAdaptive,
								value: 'adaptive',
							},
						]}
						initialIndex={thinkingMode === 'tokens' ? 0 : 1}
						isFocused={true}
						onSelect={item => {
							setThinkingMode(item.value as 'tokens' | 'adaptive');
							setIsEditing(false);
						}}
					/>
				)}
				{currentField === 'thinkingEffort' && (
					<ScrollableSelectInput
						items={[
							{label: 'low', value: 'low'},
							{label: 'medium', value: 'medium'},
							{label: 'high', value: 'high'},
							{label: 'max', value: 'max'},
						]}
						initialIndex={
							thinkingEffort === 'low'
								? 0
								: thinkingEffort === 'medium'
								? 1
								: thinkingEffort === 'high'
								? 2
								: 3
						}
						isFocused={true}
						onSelect={item => {
							setThinkingEffort(
								item.value as 'low' | 'medium' | 'high' | 'max',
							);
							setIsEditing(false);
						}}
					/>
				)}
				{currentField === 'responsesReasoningEffort' && (
					<ReasoningEffortSelect state={state} />
				)}
				{currentField === 'responsesVerbosity' && (
					<ScrollableSelectInput
						items={[
							{label: 'LOW', value: 'low'},
							{label: 'MEDIUM', value: 'medium'},
							{label: 'HIGH', value: 'high'},
						]}
						initialIndex={Math.max(
							0,
							[
								{label: 'LOW', value: 'low'},
								{label: 'MEDIUM', value: 'medium'},
								{label: 'HIGH', value: 'high'},
							].findIndex(opt => opt.value === responsesVerbosity),
						)}
						isFocused={true}
						onSelect={item => {
							setResponsesVerbosity(
								item.value as 'low' | 'medium' | 'high',
							);
							setIsEditing(false);
						}}
					/>
				)}
			</Box>
		</Box>
	);
}

function ProfileSelect({state}: Props) {
	const {
		t,
		theme,
		profiles,
		activeProfile,
		markedProfiles,
		setMarkedProfiles,
		setErrors,
		setIsEditing,
		loadProfilesAndConfig,
	} = state;

	return (
		<Box flexDirection="column">
			{profiles.length > 1 && (
				<Text color={theme.colors.menuSecondary} dimColor>
					Scroll to see more profiles (↑↓)
				</Text>
			)}
			<ScrollableSelectInput
				items={profiles.map(p => ({
					label: p.displayName,
					value: p.name,
					isActive: p.name === activeProfile,
				}))}
				limit={5}
				initialIndex={Math.max(
					0,
					profiles.findIndex(p => p.name === activeProfile),
				)}
				isFocused={true}
				selectedValues={markedProfiles}
				renderItem={({label, isSelected, isMarked, isActive}) => {
					return (
						<Text>
							<Text
								color={
									isMarked ? 'yellow' : isSelected ? 'cyan' : 'white'
								}
							>
								{isMarked ? '✓ ' : '  '}
							</Text>
							{isActive && <Text color="green">[active] </Text>}
							<Text color={isSelected ? 'cyan' : 'white'}>
								{label}
							</Text>
						</Text>
					);
				}}
				onSelect={item => {
					switchProfile(item.value);
					loadProfilesAndConfig();
					setIsEditing(false);
					setErrors([]);
				}}
				onToggleItem={item => {
					if (item.value === 'default') {
						setErrors([t.configScreen.cannotDeleteDefault]);
						return;
					}
					setMarkedProfiles(prev => {
						const next = new Set(prev);
						if (next.has(item.value)) {
							next.delete(item.value);
						} else {
							next.add(item.value);
						}
						return next;
					});
					setErrors([]);
				}}
			/>
			<Box flexDirection="row" marginTop={1}>
				<Box marginRight={2}>
					<Text color={theme.colors.menuSelected}>
						{t.configScreen.newProfile}
					</Text>
					<Text color={theme.colors.menuSecondary}> (n)</Text>
				</Box>
				<Box marginRight={2}>
					<Text color={theme.colors.warning}>
						{t.configScreen.mark}
					</Text>
					<Text color={theme.colors.menuSecondary}> (space)</Text>
				</Box>
				<Box>
					<Text color={theme.colors.error}>
						{t.configScreen.deleteProfileShort}
					</Text>
					<Text color={theme.colors.menuSecondary}> (d)</Text>
					{markedProfiles.size > 0 && (
						<Text color={theme.colors.warning}>
							[{markedProfiles.size}]
						</Text>
					)}
				</Box>
			</Box>
		</Box>
	);
}

function SystemPromptSelect({state}: Props) {
	const {
		t,
		theme,
		pendingPromptIds,
		setPendingPromptIds,
		setIsEditing,
		setSystemPromptId,
		getSystemPromptSelectItems,
		getSystemPromptSelectedValue,
		applySystemPromptSelectValue,
	} = state;

	const items = getSystemPromptSelectItems();
	const selected = getSystemPromptSelectedValue();

	return (
		<Box flexDirection="column">
			<ScrollableSelectInput
				items={items}
				limit={10}
				initialIndex={Math.max(
					0,
					items.findIndex(opt => opt.value === selected),
				)}
				isFocused={true}
				selectedValues={pendingPromptIds}
				renderItem={({label, value, isSelected, isMarked}) => {
					const isMeta =
						value === '__FOLLOW__' || value === '__DISABLED__';
					return (
						<Text
							color={
								isSelected
									? 'cyan'
									: isMarked
									? theme.colors.menuInfo
									: 'white'
							}
						>
							{isMeta ? '' : isMarked ? '[✓] ' : '[ ] '}
							{label}
						</Text>
					);
				}}
				onToggleItem={item => {
					if (
						item.value === '__FOLLOW__' ||
						item.value === '__DISABLED__'
					) {
						applySystemPromptSelectValue(item.value);
						setPendingPromptIds(new Set());
						setIsEditing(false);
						return;
					}
					setPendingPromptIds(prev => {
						const next = new Set(prev);
						if (next.has(item.value)) {
							next.delete(item.value);
						} else {
							next.add(item.value);
						}
						return next;
					});
				}}
				onSelect={item => {
					if (
						item.value === '__FOLLOW__' ||
						item.value === '__DISABLED__'
					) {
						applySystemPromptSelectValue(item.value);
						setPendingPromptIds(new Set());
						setIsEditing(false);
						return;
					}
					const finalIds =
						pendingPromptIds.size > 0
							? Array.from(pendingPromptIds)
							: [item.value];
					if (
						pendingPromptIds.size > 0 &&
						!pendingPromptIds.has(item.value)
					) {
						finalIds.push(item.value);
					}
					setSystemPromptId(
						finalIds.length === 1 ? finalIds[0]! : finalIds,
					);
					setPendingPromptIds(new Set());
					setIsEditing(false);
				}}
			/>
			<Box marginTop={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.configScreen.systemPromptMultiSelectHint ||
						'Space: toggle | Enter: confirm | Esc: cancel'}
				</Text>
			</Box>
		</Box>
	);
}

function ReasoningEffortSelect({state}: Props) {
	const {
		supportsXHigh,
		responsesReasoningEffort,
		setResponsesReasoningEffort,
		setIsEditing,
	} = state;

	const effortOptions = [
		{label: 'NONE', value: 'none'},
		{label: 'LOW', value: 'low'},
		{label: 'MEDIUM', value: 'medium'},
		{label: 'HIGH', value: 'high'},
		...(supportsXHigh ? [{label: 'XHIGH', value: 'xhigh'}] : []),
	];

	return (
		<ScrollableSelectInput
			items={effortOptions}
			initialIndex={Math.max(
				0,
				effortOptions.findIndex(
					opt => opt.value === responsesReasoningEffort,
				),
			)}
			isFocused={true}
			onSelect={item => {
				const nextEffort = item.value as
					| 'none'
					| 'low'
					| 'medium'
					| 'high'
					| 'xhigh';
				setResponsesReasoningEffort(
					nextEffort === 'xhigh' && !supportsXHigh
						? 'high'
						: nextEffort,
				);
				setIsEditing(false);
			}}
		/>
	);
}
