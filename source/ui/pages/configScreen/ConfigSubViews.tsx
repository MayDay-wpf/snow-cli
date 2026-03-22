import React from 'react';
import {Box, Text} from 'ink';
import Gradient from 'ink-gradient';
import {Alert, Spinner} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {stripFocusArtifacts} from './types.js';
import type {ConfigStateReturn} from './useConfigState.js';

type SubViewProps = {
	state: ConfigStateReturn;
	inlineMode: boolean;
};

type ProfileNameInputViewProps = SubViewProps & {
	title: string;
	subtitle: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	hint: string;
};

function ProfileNameInputView({
	state,
	inlineMode,
	title,
	subtitle,
	label,
	value,
	onChange,
	placeholder,
	hint,
}: ProfileNameInputViewProps) {
	const {theme, errors} = state;

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
						<Gradient name="rainbow">{title}</Gradient>
						<Text color={theme.colors.menuSecondary} dimColor>
							{subtitle}
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column">
				<Text color={theme.colors.menuInfo}>{label}</Text>
				<Box marginLeft={2}>
					<TextInput
						value={value}
						onChange={nextValue => onChange(stripFocusArtifacts(nextValue))}
						placeholder={placeholder}
					/>
				</Box>
			</Box>

			{errors.length > 0 && (
				<Box marginTop={1}>
					<Text color={theme.colors.error}>{errors[0]}</Text>
				</Box>
			)}

			<Box marginTop={1}>
				<Alert variant="info">{hint}</Alert>
			</Box>
		</Box>
	);
}

export function ProfileCreateView({state, inlineMode}: SubViewProps) {
	const {t, newProfileName, setNewProfileName} = state;

	return (
		<ProfileNameInputView
			state={state}
			inlineMode={inlineMode}
			title={t.configScreen.createNewProfile}
			subtitle={t.configScreen.enterProfileName}
			label={t.configScreen.profileNameLabel}
			value={newProfileName}
			onChange={setNewProfileName}
			placeholder={t.configScreen.profileNamePlaceholder}
			hint={t.configScreen.createHint}
		/>
	);
}

export function ProfileRenameView({state, inlineMode}: SubViewProps) {
	const {t, renameProfileName, setRenameProfileName} = state;

	return (
		<ProfileNameInputView
			state={state}
			inlineMode={inlineMode}
			title={t.configScreen.renameProfile}
			subtitle={t.configScreen.enterRenameProfileName}
			label={t.configScreen.profileNameLabel}
			value={renameProfileName}
			onChange={setRenameProfileName}
			placeholder={t.configScreen.renameProfilePlaceholder}
			hint={t.configScreen.renameHint}
		/>
	);
}

export function ProfileDeleteView({state, inlineMode}: SubViewProps) {
	const {t, theme, markedProfiles, errors} = state;
	const profilesToDelete = Array.from(markedProfiles);

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
						<Gradient name="rainbow">{t.configScreen.deleteProfile}</Gradient>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.configScreen.confirmDelete}
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column">
				<Text color={theme.colors.warning}>
					{t.configScreen.confirmDeleteProfiles.replace(
						'{count}',
						String(profilesToDelete.length),
					)}
				</Text>
				<Box marginTop={1} flexDirection="column">
					{profilesToDelete.map(profileName => (
						<Text key={profileName} color={theme.colors.menuSecondary}>
							• {profileName}
						</Text>
					))}
				</Box>
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.configScreen.deleteWarning}
				</Text>
			</Box>

			{errors.length > 0 && (
				<Box marginTop={1}>
					<Text color={theme.colors.error}>{errors[0]}</Text>
				</Box>
			)}

			<Box marginTop={1}>
				<Alert variant="warning">{t.configScreen.confirmHint}</Alert>
			</Box>
		</Box>
	);
}

export function LoadingView({state, inlineMode}: SubViewProps) {
	const {t, theme} = state;

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
							{t.configScreen.loadingMessage}
						</Text>
					</Box>
				</Box>
			)}

			<Box flexDirection="column">
				<Box>
					<Spinner type="dots" />
					<Text color={theme.colors.menuInfo}>
						{' '}
						{t.configScreen.fetchingModels}
					</Text>
				</Box>
				<Box marginLeft={2}>
					<Text color={theme.colors.menuSecondary} dimColor>
						{t.configScreen.fetchingHint}
					</Text>
				</Box>
			</Box>

			<Box flexDirection="column" marginTop={1}>
				<Alert variant="info">{t.configScreen.loadingCancelHint}</Alert>
			</Box>
		</Box>
	);
}

export function ManualInputView({state, inlineMode}: SubViewProps) {
	const {t, theme, currentField, manualInputValue, loadError} = state;

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
						<Gradient name="rainbow">
							{t.configScreen.manualInputTitle}
						</Gradient>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.configScreen.manualInputSubtitle}
						</Text>
					</Box>
				</Box>
			)}

			{loadError && (
				<Box flexDirection="column" marginBottom={1}>
					<Text color={theme.colors.warning}>
						{t.configScreen.loadingError}
					</Text>
					<Text color={theme.colors.menuSecondary} dimColor>
						{loadError}
					</Text>
				</Box>
			)}

			<Box flexDirection="column">
				<Text color={theme.colors.menuInfo}>
					{currentField === 'advancedModel' && t.configScreen.advancedModel}
					{currentField === 'basicModel' && t.configScreen.basicModel}
				</Text>
				<Box marginLeft={2}>
					<Text color={theme.colors.menuSelected}>
						{`> ${manualInputValue}`}
						<Text color={theme.colors.menuNormal}>_</Text>
					</Text>
				</Box>
			</Box>

			<Box flexDirection="column" marginTop={1}>
				<Alert variant="info">{t.configScreen.manualInputHint}</Alert>
			</Box>
		</Box>
	);
}
