import React, {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import Gradient from 'ink-gradient';
import {Alert} from '@inkjs/ui';
import TextInput from 'ink-text-input';
import {
	getAllProfiles,
	switchProfile,
	createProfile,
	deleteProfile,
	renameProfile,
	type ConfigProfile,
} from '../../utils/configManager.js';
import ConfigScreen from './ConfigScreen.js';

type Props = {
	onBack: () => void;
	onSelectProfile: (profileName: string) => void;
};

type Mode =
	| 'list'
	| 'create'
	| 'rename'
	| 'delete-confirm'
	| 'edit';

const focusEventTokenRegex = /(?:\x1b)?\[[0-9;]*[IO]/g;

const isFocusEventInput = (value?: string) => {
	if (!value) {
		return false;
	}

	if (
		value === '\x1b[I' ||
		value === '\x1b[O' ||
		value === '[I' ||
		value === '[O'
	) {
		return true;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return false;
	}

	const tokens = trimmed.match(focusEventTokenRegex);
	if (!tokens) {
		return false;
	}

	const normalized = trimmed.replace(/\s+/g, '');
	const tokensCombined = tokens.join('');
	return tokensCombined === normalized;
};

const stripFocusArtifacts = (value: string) => {
	if (!value) {
		return '';
	}

	return value
		.replace(/\x1b\[[0-9;]*[IO]/g, '')
		.replace(/\[[0-9;]*[IO]/g, '')
		.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
};

export default function ConfigProfileScreen({
	onBack,
	onSelectProfile,
}: Props) {
	const [profiles, setProfiles] = useState<ConfigProfile[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [mode, setMode] = useState<Mode>('list');
	const [inputValue, setInputValue] = useState('');
	const [error, setError] = useState<string>('');

	// Load profiles on mount
	useEffect(() => {
		refreshProfiles();
	}, []);

	const refreshProfiles = () => {
		const loadedProfiles = getAllProfiles();
		setProfiles(loadedProfiles);

		// Find active profile and set selected index
		const activeIndex = loadedProfiles.findIndex(p => p.isActive);
		if (activeIndex !== -1) {
			setSelectedIndex(activeIndex);
		}
	};

	const handleCreateProfile = () => {
		const cleaned = stripFocusArtifacts(inputValue).trim();

		if (!cleaned) {
			setError('Profile name cannot be empty');
			return;
		}

		try {
			createProfile(cleaned);
			refreshProfiles();
			setMode('list');
			setInputValue('');
			setError('');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to create profile');
		}
	};

	const handleRenameProfile = () => {
		const cleaned = stripFocusArtifacts(inputValue).trim();
		const currentProfile = profiles[selectedIndex];

		if (!currentProfile) {
			setError('No profile selected');
			return;
		}

		if (!cleaned) {
			setError('Profile name cannot be empty');
			return;
		}

		try {
			renameProfile(currentProfile.name, cleaned);
			refreshProfiles();
			setMode('list');
			setInputValue('');
			setError('');
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to rename profile');
		}
	};

	const handleDeleteProfile = () => {
		const currentProfile = profiles[selectedIndex];

		if (!currentProfile) {
			return;
		}

		try {
			deleteProfile(currentProfile.name);
			refreshProfiles();
			setMode('list');
			setError('');
			setSelectedIndex(Math.max(0, selectedIndex - 1));
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete profile');
			setMode('list');
		}
	};

	const handleSwitchProfile = () => {
		const currentProfile = profiles[selectedIndex];

		if (!currentProfile) {
			return;
		}

		try {
			switchProfile(currentProfile.name);
			onSelectProfile(currentProfile.name);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to switch profile',
			);
		}
	};

	const handleEditProfile = () => {
		const currentProfile = profiles[selectedIndex];

		if (!currentProfile) {
			return;
		}

		// Switch to this profile first to make it active for editing
		try {
			switchProfile(currentProfile.name);
			setMode('edit');
			setError('');
		} catch (err) {
			setError(
				err instanceof Error ? err.message : 'Failed to edit profile',
			);
		}
	};

	const handleEditComplete = () => {
		// Refresh profiles to show updated config
		refreshProfiles();
		setMode('list');
		setError('');
	};

	useInput((rawInput, key) => {
		const input = stripFocusArtifacts(rawInput);

		if (!input && isFocusEventInput(rawInput)) {
			return;
		}

		if (isFocusEventInput(rawInput)) {
			return;
		}

		// Handle text input modes
		if (mode === 'create' || mode === 'rename') {
			if (key.return) {
				if (mode === 'create') {
					handleCreateProfile();
				} else if (mode === 'rename') {
					handleRenameProfile();
				}
			} else if (key.escape) {
				setMode('list');
				setInputValue('');
				setError('');
			}
			return;
		}

		// Handle edit mode - don't intercept input
		if (mode === 'edit') {
			// ConfigScreen handles all input
			return;
		}

		// Handle delete confirmation
		if (mode === 'delete-confirm') {
			if (input === 'y' || input === 'Y') {
				handleDeleteProfile();
			} else if (input === 'n' || input === 'N' || key.escape) {
				setMode('list');
				setError('');
			}
			return;
		}

		// Handle list mode
		if (mode === 'list') {
			if (key.escape) {
				onBack();
			} else if (key.upArrow) {
				setSelectedIndex(Math.max(0, selectedIndex - 1));
				setError('');
			} else if (key.downArrow) {
				setSelectedIndex(Math.min(profiles.length - 1, selectedIndex + 1));
				setError('');
			} else if (key.return) {
				handleSwitchProfile();
			} else if (input === 'n' || input === 'N') {
				setMode('create');
				setInputValue('');
				setError('');
			} else if (input === 'e' || input === 'E') {
				handleEditProfile();
			} else if (input === 'r' || input === 'R') {
				const currentProfile = profiles[selectedIndex];
				if (currentProfile) {
					setInputValue(currentProfile.name);
					setMode('rename');
					setError('');
				}
			} else if (input === 'd' || input === 'D') {
				const currentProfile = profiles[selectedIndex];
				if (currentProfile && currentProfile.name !== 'default') {
					setMode('delete-confirm');
					setError('');
				} else if (currentProfile?.name === 'default') {
					setError('Cannot delete the default profile');
				}
			}
		}
	});

	// Render input mode
	if (mode === 'create' || mode === 'rename') {
		return (
			<Box flexDirection="column" padding={1}>
				<Box
					marginBottom={1}
					borderStyle="double"
					borderColor="cyan"
					paddingX={2}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">
							{mode === 'create' ? 'Create New Profile' : 'Rename Profile'}
						</Gradient>
						<Text color="gray" dimColor>
							{mode === 'create'
								? 'Enter a name for the new profile'
								: 'Enter a new name for the profile'}
						</Text>
					</Box>
				</Box>

				<Box flexDirection="column">
					<Text color="cyan">Profile Name:</Text>
					<Box marginLeft={2}>
						<TextInput
							value={inputValue}
							onChange={value => setInputValue(stripFocusArtifacts(value))}
							placeholder="e.g., work, personal, test"
						/>
					</Box>
				</Box>

				{error && (
					<Box marginTop={1}>
						<Text color="red">Error: {error}</Text>
					</Box>
				)}

				<Box marginTop={1}>
					<Alert variant="info">Press Enter to save, Esc to cancel</Alert>
				</Box>
			</Box>
		);
	}

	// Render delete confirmation
	if (mode === 'delete-confirm') {
		const currentProfile = profiles[selectedIndex];

		return (
			<Box flexDirection="column" padding={1}>
				<Box
					marginBottom={1}
					borderStyle="double"
					borderColor="cyan"
					paddingX={2}
				>
					<Box flexDirection="column">
						<Gradient name="rainbow">Delete Profile</Gradient>
						<Text color="gray" dimColor>
							Confirm profile deletion
						</Text>
					</Box>
				</Box>

				<Box flexDirection="column">
					<Text color="yellow">
						Are you sure you want to delete the profile &quot;
						{currentProfile?.displayName}&quot;?
					</Text>
					<Text color="gray" dimColor>
						This action cannot be undone.
					</Text>
				</Box>

				<Box marginTop={1}>
					<Alert variant="warning">
						Press Y to confirm, N or Esc to cancel
					</Alert>
				</Box>
			</Box>
		);
	}

	// Render edit mode
	if (mode === 'edit') {
		return (
			<ConfigScreen
				onBack={handleEditComplete}
				onSave={handleEditComplete}
				inlineMode={false}
			/>
		);
	}

	// Render profile list
	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1} borderStyle="double" borderColor="cyan" paddingX={2}>
				<Box flexDirection="column">
					<Gradient name="rainbow">Configuration Profiles</Gradient>
					<Text color="gray" dimColor>
						Manage multiple configuration profiles
					</Text>
				</Box>
			</Box>

			<Box flexDirection="column">
				<Text color="cyan" bold>
					Available Profiles:
				</Text>

				{profiles.map((profile, index) => (
					<Box key={profile.name} flexDirection="column" marginLeft={1}>
						<Text
							color={index === selectedIndex ? 'green' : 'white'}
							bold={profile.isActive}
						>
							{index === selectedIndex ? '❯ ' : '  '}
							{profile.displayName}
							{profile.isActive && (
								<Text color="cyan" dimColor>
									{' '}
									(Active)
								</Text>
							)}
						</Text>
						{index === selectedIndex && (
							<Box marginLeft={3}>
								<Text color="gray" dimColor>
									API: {profile.config.snowcfg.baseUrl}
								</Text>
							</Box>
						)}
					</Box>
				))}
			</Box>

			{error && (
				<Box marginTop={1}>
					<Text color="red">Error: {error}</Text>
				</Box>
			)}

			<Box flexDirection="column" marginTop={1}>
				<Alert variant="info">
					↑↓: Navigate • Enter: Switch • E: Edit • N: New • R: Rename • D:
					Delete • Esc: Back
				</Alert>
			</Box>
		</Box>
	);
}
