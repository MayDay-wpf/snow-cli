import {useState, type Dispatch, type SetStateAction} from 'react';
import {reloadConfig} from '../../utils/config/apiConfig.js';
import {
	getAllProfiles,
	getActiveProfileName,
	switchProfile,
} from '../../utils/config/configManager.js';

export type PanelState = {
	showSessionPanel: boolean;
	showMcpPanel: boolean;
	showUsagePanel: boolean;
	showHelpPanel: boolean;
	showCustomCommandConfig: boolean;
	showSkillsCreation: boolean;
	showRoleCreation: boolean;
	showRoleDeletion: boolean;
	showWorkingDirPanel: boolean;
	showReviewCommitPanel: boolean;
	showProfilePanel: boolean;
	profileSelectedIndex: number;
	profileSearchQuery: string;
	currentProfileName: string;
};

export type PanelActions = {
	setShowSessionPanel: Dispatch<SetStateAction<boolean>>;
	setShowMcpPanel: Dispatch<SetStateAction<boolean>>;
	setShowUsagePanel: Dispatch<SetStateAction<boolean>>;
	setShowHelpPanel: Dispatch<SetStateAction<boolean>>;
	setShowCustomCommandConfig: Dispatch<SetStateAction<boolean>>;
	setShowSkillsCreation: Dispatch<SetStateAction<boolean>>;
	setShowRoleCreation: Dispatch<SetStateAction<boolean>>;
	setShowRoleDeletion: Dispatch<SetStateAction<boolean>>;
	setShowWorkingDirPanel: Dispatch<SetStateAction<boolean>>;
	setShowReviewCommitPanel: Dispatch<SetStateAction<boolean>>;
	setShowProfilePanel: Dispatch<SetStateAction<boolean>>;
	setProfileSelectedIndex: Dispatch<SetStateAction<number>>;
	setProfileSearchQuery: Dispatch<SetStateAction<string>>;
	handleSwitchProfile: (options: {
		isStreaming: boolean;
		hasPendingRollback: boolean;
		hasPendingToolConfirmation: boolean;
		hasPendingUserQuestion: boolean;
	}) => void;
	handleProfileSelect: (profileName: string) => void;
	handleEscapeKey: () => boolean; // Returns true if ESC was handled
	isAnyPanelOpen: () => boolean;
};

export function usePanelState(): PanelState & PanelActions {
	const [showSessionPanel, setShowSessionPanel] = useState(false);
	const [showMcpPanel, setShowMcpPanel] = useState(false);
	const [showUsagePanel, setShowUsagePanel] = useState(false);
	const [showHelpPanel, setShowHelpPanel] = useState(false);
	const [showCustomCommandConfig, setShowCustomCommandConfig] = useState(false);
	const [showSkillsCreation, setShowSkillsCreation] = useState(false);
	const [showRoleCreation, setShowRoleCreation] = useState(false);
	const [showRoleDeletion, setShowRoleDeletion] = useState(false);
	const [showWorkingDirPanel, setShowWorkingDirPanel] = useState(false);
	const [showReviewCommitPanel, setShowReviewCommitPanel] = useState(false);
	const [showProfilePanel, setShowProfilePanel] = useState(false);
	const [profileSelectedIndex, setProfileSelectedIndex] = useState(0);
	const [profileSearchQuery, setProfileSearchQuery] = useState('');
	const [currentProfileName, setCurrentProfileName] = useState(() => {
		const profiles = getAllProfiles();
		const activeName = getActiveProfileName();
		const profile = profiles.find(p => p.name === activeName);
		return profile?.displayName || activeName;
	});

	const handleSwitchProfile = (options: {
		isStreaming: boolean;
		hasPendingRollback: boolean;
		hasPendingToolConfirmation: boolean;
		hasPendingUserQuestion: boolean;
	}) => {
		// Don't switch if any panel is open or streaming
		if (
			showSessionPanel ||
			showMcpPanel ||
			showUsagePanel ||
			showHelpPanel ||
			showCustomCommandConfig ||
			showSkillsCreation ||
			showRoleCreation ||
			showRoleDeletion ||
			showReviewCommitPanel ||
			showProfilePanel ||
			options.hasPendingRollback ||
			options.hasPendingToolConfirmation ||
			options.hasPendingUserQuestion ||
			options.isStreaming
		) {
			return;
		}

		// Show profile selection panel instead of cycling
		setShowProfilePanel(true);
		setProfileSelectedIndex(0);
	};

	const handleProfileSelect = (profileName: string) => {
		// Switch to selected profile
		switchProfile(profileName);

		// Reload config to pick up new profile's configuration
		reloadConfig();

		// Update display name
		const profiles = getAllProfiles();
		const profile = profiles.find(p => p.name === profileName);
		setCurrentProfileName(profile?.displayName || profileName);

		// Close panel and reset search
		setShowProfilePanel(false);
		setProfileSelectedIndex(0);
		setProfileSearchQuery('');
	};

	const handleEscapeKey = (): boolean => {
		// Check each panel in priority order and close if open
		if (showSessionPanel) {
			setShowSessionPanel(false);
			return true;
		}

		if (showMcpPanel) {
			setShowMcpPanel(false);
			return true;
		}

		if (showUsagePanel) {
			setShowUsagePanel(false);
			return true;
		}

		if (showHelpPanel) {
			setShowHelpPanel(false);
			return true;
		}

		if (showCustomCommandConfig) {
			setShowCustomCommandConfig(false);
			return true;
		}

		if (showSkillsCreation) {
			setShowSkillsCreation(false);
			return true;
		}

		if (showRoleCreation) {
			setShowRoleCreation(false);
			return true;
		}

		if (showRoleDeletion) {
			setShowRoleDeletion(false);
			return true;
		}

		if (showWorkingDirPanel) {
			setShowWorkingDirPanel(false);
			return true;
		}

		if (showReviewCommitPanel) {
			setShowReviewCommitPanel(false);
			return true;
		}

		if (showProfilePanel) {
			setShowProfilePanel(false);
			return true;
		}

		return false; // ESC not handled
	};

	const isAnyPanelOpen = (): boolean => {
		return (
			showSessionPanel ||
			showMcpPanel ||
			showUsagePanel ||
			showHelpPanel ||
			showCustomCommandConfig ||
			showSkillsCreation ||
			showRoleCreation ||
			showRoleDeletion ||
			showWorkingDirPanel ||
			showReviewCommitPanel ||
			showProfilePanel
		);
	};

	return {
		// State
		showSessionPanel,
		showMcpPanel,
		showUsagePanel,
		showHelpPanel,
		showCustomCommandConfig,
		showSkillsCreation,
		showRoleCreation,
		showRoleDeletion,
		showWorkingDirPanel,
		showReviewCommitPanel,
		showProfilePanel,
		profileSelectedIndex,
		profileSearchQuery,
		currentProfileName,
		// Actions
		setShowSessionPanel,
		setShowMcpPanel,
		setShowUsagePanel,
		setShowHelpPanel,
		setShowCustomCommandConfig,
		setShowSkillsCreation,
		setShowRoleCreation,
		setShowRoleDeletion,
		setShowWorkingDirPanel,
		setShowReviewCommitPanel,
		setShowProfilePanel,
		setProfileSelectedIndex,
		setProfileSearchQuery,
		handleSwitchProfile,
		handleProfileSelect,
		handleEscapeKey,
		isAnyPanelOpen,
	};
}
