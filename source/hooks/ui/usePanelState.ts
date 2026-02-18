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
	showCustomCommandConfig: boolean;
	showSkillsCreation: boolean;
	showRoleCreation: boolean;
	showRoleDeletion: boolean;
	showRoleList: boolean;
	showWorkingDirPanel: boolean;
	showReviewCommitPanel: boolean;
	showBranchPanel: boolean;
	showProfilePanel: boolean;
	showModelsPanel: boolean;
	showDiffReviewPanel: boolean;
	profileSelectedIndex: number;
	profileSearchQuery: string;
	currentProfileName: string;
};

export type PanelActions = {
	setShowSessionPanel: Dispatch<SetStateAction<boolean>>;
	setShowMcpPanel: Dispatch<SetStateAction<boolean>>;
	setShowUsagePanel: Dispatch<SetStateAction<boolean>>;
	setShowCustomCommandConfig: Dispatch<SetStateAction<boolean>>;
	setShowSkillsCreation: Dispatch<SetStateAction<boolean>>;
	setShowRoleCreation: Dispatch<SetStateAction<boolean>>;
	setShowRoleDeletion: Dispatch<SetStateAction<boolean>>;
	setShowRoleList: Dispatch<SetStateAction<boolean>>;
	setShowWorkingDirPanel: Dispatch<SetStateAction<boolean>>;
	setShowReviewCommitPanel: Dispatch<SetStateAction<boolean>>;
	setShowBranchPanel: Dispatch<SetStateAction<boolean>>;
	setShowProfilePanel: Dispatch<SetStateAction<boolean>>;
	setShowModelsPanel: Dispatch<SetStateAction<boolean>>;
	setShowDiffReviewPanel: Dispatch<SetStateAction<boolean>>;
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
	const [showCustomCommandConfig, setShowCustomCommandConfig] = useState(false);
	const [showSkillsCreation, setShowSkillsCreation] = useState(false);
	const [showRoleCreation, setShowRoleCreation] = useState(false);
	const [showRoleDeletion, setShowRoleDeletion] = useState(false);
	const [showRoleList, setShowRoleList] = useState(false);
	const [showWorkingDirPanel, setShowWorkingDirPanel] = useState(false);
	const [showReviewCommitPanel, setShowReviewCommitPanel] = useState(false);
	const [showBranchPanel, setShowBranchPanel] = useState(false);
	const [showProfilePanel, setShowProfilePanel] = useState(false);
	const [showModelsPanel, setShowModelsPanel] = useState(false);
	const [showDiffReviewPanel, setShowDiffReviewPanel] = useState(false);
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
			showCustomCommandConfig ||
			showSkillsCreation ||
			showRoleCreation ||
			showRoleDeletion ||
			showRoleList ||
			showReviewCommitPanel ||
			showBranchPanel ||
			showProfilePanel ||
			showModelsPanel ||
			showDiffReviewPanel ||
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
		// CustomCommandConfigPanel handles its own ESC key logic internally
		// Don't close it here - let the panel decide when to close
		if (showCustomCommandConfig) {
			return false; // Let CustomCommandConfigPanel handle ESC
		}
		// SkillsCreationPanel handles its own ESC key logic internally
		// Don't close it here - let the panel decide when to close
		if (showSkillsCreation) {
			return false; // Let SkillsCreationPanel handle ESC
		}
		// RoleCreationPanel handles its own ESC key logic internally
		// Don't close it here - let the panel decide when to close
		if (showRoleCreation) {
			return false; // Let RoleCreationPanel handle ESC
		}

		if (showRoleDeletion) {
			setShowRoleDeletion(false);
			return true;
		}

		if (showRoleList) {
			setShowRoleList(false);
			return true;
		}

		// WorkingDirectoryPanel handles its own ESC key logic internally
		// Don't close it here - let the panel decide when to close
		if (showWorkingDirPanel) {
			return false; // Let WorkingDirectoryPanel handle ESC
		}

		if (showReviewCommitPanel) {
			setShowReviewCommitPanel(false);
			return true;
		}

		// BranchPanel handles its own ESC key logic internally
		// Don't close it here - let the panel decide when to close
		if (showBranchPanel) {
			return false; // Let BranchPanel handle ESC
		}

		if (showDiffReviewPanel) {
			setShowDiffReviewPanel(false);
			return true;
		}

		if (showProfilePanel) {
			setShowProfilePanel(false);
			return true;
		}

		// ModelsPanel handles its own ESC key logic internally
		// Don't close it here - let the panel decide when to close
		if (showModelsPanel) {
			return false; // Let ModelsPanel handle ESC
		}

		return false; // ESC not handled
	};

	const isAnyPanelOpen = (): boolean => {
		return (
			showSessionPanel ||
			showMcpPanel ||
			showUsagePanel ||
			showCustomCommandConfig ||
			showSkillsCreation ||
			showRoleCreation ||
			showRoleDeletion ||
			showRoleList ||
			showWorkingDirPanel ||
			showReviewCommitPanel ||
			showBranchPanel ||
			showProfilePanel ||
			showModelsPanel ||
			showDiffReviewPanel
		);
	};

	return {
		// State
		showSessionPanel,
		showMcpPanel,
		showUsagePanel,
		showCustomCommandConfig,
		showSkillsCreation,
		showRoleCreation,
		showRoleDeletion,
		showRoleList,
		showWorkingDirPanel,
		showReviewCommitPanel,
		showBranchPanel,
		showProfilePanel,
		showModelsPanel,
		showDiffReviewPanel,
		profileSelectedIndex,
		profileSearchQuery,
		currentProfileName,
		// Actions
		setShowSessionPanel,
		setShowMcpPanel,
		setShowUsagePanel,
		setShowCustomCommandConfig,
		setShowSkillsCreation,
		setShowRoleCreation,
		setShowRoleDeletion,
		setShowRoleList,
		setShowWorkingDirPanel,
		setShowReviewCommitPanel,
		setShowBranchPanel,
		setShowProfilePanel,
		setShowModelsPanel,
		setShowDiffReviewPanel,
		setProfileSelectedIndex,
		setProfileSearchQuery,
		handleSwitchProfile,
		handleProfileSelect,
		handleEscapeKey,
		isAnyPanelOpen,
	};
}
