import React from 'react';
import {Box, Text} from 'ink';
import Gradient from 'ink-gradient';
import {Alert} from '@inkjs/ui';
import {type ConfigScreenProps, MAX_VISIBLE_FIELDS, isSelectField} from './configScreen/types.js';
import {useConfigState} from './configScreen/useConfigState.js';
import {useConfigInput} from './configScreen/useConfigInput.js';
import ConfigFieldRenderer from './configScreen/ConfigFieldRenderer.js';
import ConfigSelectPanel from './configScreen/ConfigSelectPanel.js';
import {
	ProfileCreateView,
	ProfileDeleteView,
	LoadingView,
	ManualInputView,
} from './configScreen/ConfigSubViews.js';

export default function ConfigScreen({
	onBack,
	onSave,
	inlineMode = false,
}: ConfigScreenProps) {
	const state = useConfigState();
	useConfigInput(state, {onBack, onSave});

	const {
		t,
		theme,
		profileMode,
		loading,
		manualInputMode,
		isEditing,
		currentField,
		activeProfile,
		errors,
		currentFieldIndex,
		totalFields,
		fieldsDisplayWindow,
		hiddenAboveFieldsCount,
		hiddenBelowFieldsCount,
		getRequestUrl,
	} = state;

	if (profileMode === 'creating') {
		return <ProfileCreateView state={state} inlineMode={inlineMode} />;
	}

	if (profileMode === 'deleting') {
		return <ProfileDeleteView state={state} inlineMode={inlineMode} />;
	}

	if (loading) {
		return <LoadingView state={state} inlineMode={inlineMode} />;
	}

	if (manualInputMode) {
		return <ManualInputView state={state} inlineMode={inlineMode} />;
	}

	const isSelectEditing = isEditing && isSelectField(currentField);

	return (
		<Box flexDirection="column" padding={1}>
			{!inlineMode && (
				<Box
					marginBottom={1}
					borderStyle="double"
					borderColor={theme.colors.menuInfo}
					paddingX={2}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">{t.configScreen.title}</Gradient>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.configScreen.subtitle}
						</Text>
						{activeProfile && (
							<Text color={theme.colors.menuInfo} dimColor>
								{t.configScreen.activeProfile} {activeProfile}
							</Text>
						)}
					</Box>
				</Box>
			)}

			{/* Position indicator */}
			<Box marginBottom={1}>
				<Text color={theme.colors.warning} bold>
					{t.configScreen.settingsPosition} ({currentFieldIndex + 1}/
					{totalFields})
				</Text>
				{totalFields > MAX_VISIBLE_FIELDS && (
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.configScreen.scrollHint}
						{hiddenAboveFieldsCount > 0 && (
							<>
								·{' '}
								{t.configScreen.moreAbove.replace(
									'{count}',
									hiddenAboveFieldsCount.toString(),
								)}
							</>
						)}
						{hiddenBelowFieldsCount > 0 && (
							<>
								·{' '}
								{t.configScreen.moreBelow.replace(
									'{count}',
									hiddenBelowFieldsCount.toString(),
								)}
							</>
						)}
					</Text>
				)}
			</Box>

			{isSelectEditing ? (
				<ConfigSelectPanel state={state} />
			) : (
				<Box flexDirection="column">
					{fieldsDisplayWindow.items.map(field => (
						<ConfigFieldRenderer key={field} field={field} state={state} />
					))}
				</Box>
			)}

			{errors.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color={theme.colors.error} bold>
						{t.configScreen.errors}
					</Text>
					{errors.map((error, index) => (
						<Text key={index} color={theme.colors.error}>
							• {error}
						</Text>
					))}
				</Box>
			)}

			{!isSelectEditing && (
				<Box flexDirection="column" marginTop={1}>
					<Alert variant="info">
						{isEditing
							? `${
									currentField === 'maxContextTokens' ||
									currentField === 'maxTokens'
										? t.configScreen.editingHintNumeric
										: t.configScreen.editingHintGeneral
							  }
${t.configScreen.requestUrlLabel}${getRequestUrl()}`
							: `${t.configScreen.navigationHint}
${t.configScreen.requestUrlLabel}${getRequestUrl()}`}
					</Alert>
				</Box>
			)}
		</Box>
	);
}
