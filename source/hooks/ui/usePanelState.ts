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
	showRoleSubagentCreation: boolean;
	showRoleSubagentDeletion: boolean;
	showRoleSubagentList: boolean;
	showWorkingDirPanel: boolean;
	showReviewCommitPanel: boolean;
	showBranchPanel: boolean;
	showProfilePanel: boolean;
	// 配置编辑面板：从 ProfilePanel 按右方向键进入，编辑指定 profile（不切换 active）
	showProfileEditPanel: boolean;
	editingProfileName: string | null;
	showDiffReviewPanel: boolean;
	showConnectionPanel: boolean;
	showNewPromptPanel: boolean;
	showTodoListPanel: boolean;
	showPixelEditor: boolean;
	showIdeSelectPanel: boolean;
	connectionPanelApiUrl?: string;
	profileSelectedIndex: number;
	profileSearchQuery: string;
	currentProfileName: string;
};

export type PanelActions = {
	setShowSessionPanel: Dispatch<SetStateAction<boolean>>;
	setShowMcpPanel: Dispatch<SetStateAction<boolean>>;
	setShowUsagePanel: Dispatch<SetStateAction<boolean>>;
	setShowConnectionPanel: Dispatch<SetStateAction<boolean>>;
	setShowNewPromptPanel: Dispatch<SetStateAction<boolean>>;
	setConnectionPanelApiUrl: Dispatch<SetStateAction<string | undefined>>;
	setShowCustomCommandConfig: Dispatch<SetStateAction<boolean>>;
	setShowSkillsCreation: Dispatch<SetStateAction<boolean>>;
	setShowRoleCreation: Dispatch<SetStateAction<boolean>>;
	setShowRoleDeletion: Dispatch<SetStateAction<boolean>>;
	setShowRoleList: Dispatch<SetStateAction<boolean>>;
	setShowRoleSubagentCreation: Dispatch<SetStateAction<boolean>>;
	setShowRoleSubagentDeletion: Dispatch<SetStateAction<boolean>>;
	setShowRoleSubagentList: Dispatch<SetStateAction<boolean>>;
	setShowWorkingDirPanel: Dispatch<SetStateAction<boolean>>;
	setShowReviewCommitPanel: Dispatch<SetStateAction<boolean>>;
	setShowBranchPanel: Dispatch<SetStateAction<boolean>>;
	setShowProfilePanel: Dispatch<SetStateAction<boolean>>;
	setShowProfileEditPanel: Dispatch<SetStateAction<boolean>>;
	setEditingProfileName: Dispatch<SetStateAction<string | null>>;
	/**
	 * 打开 ProfileEditPanel 编辑指定 profile：
	 * 同时关闭 ProfilePanel（picker），切换为编辑视图。
	 */
	openProfileEdit: (profileName: string) => void;
	/**
	 * 关闭 ProfileEditPanel 并回到 ProfilePanel（picker）。
	 */
	closeProfileEditAndReturnToPicker: () => void;
	setShowDiffReviewPanel: Dispatch<SetStateAction<boolean>>;
	setShowTodoListPanel: Dispatch<SetStateAction<boolean>>;
	setShowPixelEditor: Dispatch<SetStateAction<boolean>>;
	setShowIdeSelectPanel: Dispatch<SetStateAction<boolean>>;
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
	const [showRoleSubagentCreation, setShowRoleSubagentCreation] =
		useState(false);
	const [showRoleSubagentDeletion, setShowRoleSubagentDeletion] =
		useState(false);
	const [showRoleSubagentList, setShowRoleSubagentList] = useState(false);
	const [showWorkingDirPanel, setShowWorkingDirPanel] = useState(false);
	const [showReviewCommitPanel, setShowReviewCommitPanel] = useState(false);
	const [showBranchPanel, setShowBranchPanel] = useState(false);
	const [showProfilePanel, setShowProfilePanel] = useState(false);
	const [showProfileEditPanel, setShowProfileEditPanel] = useState(false);
	const [editingProfileName, setEditingProfileName] = useState<string | null>(
		null,
	);
	const [showDiffReviewPanel, setShowDiffReviewPanel] = useState(false);
	const [showConnectionPanel, setShowConnectionPanel] = useState(false);
	const [showNewPromptPanel, setShowNewPromptPanel] = useState(false);
	const [showTodoListPanel, setShowTodoListPanel] = useState(false);
	const [showPixelEditor, setShowPixelEditor] = useState(false);
	const [showIdeSelectPanel, setShowIdeSelectPanel] = useState(false);
	const [connectionPanelApiUrl, setConnectionPanelApiUrl] = useState<
		string | undefined
	>(undefined);
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
			showRoleSubagentCreation ||
			showRoleSubagentDeletion ||
			showRoleSubagentList ||
			showReviewCommitPanel ||
			showBranchPanel ||
			showProfilePanel ||
			showDiffReviewPanel ||
			showConnectionPanel ||
			showNewPromptPanel ||
			showTodoListPanel ||
			showPixelEditor ||
			showIdeSelectPanel ||
			options.hasPendingRollback ||
			options.hasPendingToolConfirmation ||
			options.hasPendingUserQuestion ||
			options.isStreaming
		) {
			return;
		}

		// Show profile selection panel instead of cycling
		setShowProfilePanel(true);
		setProfileSearchQuery('');
		const profiles = getAllProfiles();
		const activeName = getActiveProfileName();
		const activeIndex = profiles.findIndex(p => p.name === activeName);
		setProfileSelectedIndex(activeIndex >= 0 ? activeIndex : 0);
	};

	// 从 ProfilePanel 进入 ProfileEditPanel：编辑光标焦点的 profile
	// 注意：保留 profileSelectedIndex 与 profileSearchQuery，
	// 这样 ESC 返回 picker 时光标停留在原来的 profile 上。
	const openProfileEdit = (profileName: string) => {
		setEditingProfileName(profileName);
		setShowProfileEditPanel(true);
		// 关闭 picker 让 footer 不再渲染 ProfilePanel；
		// ProfileEditPanel 会在 PanelsManager 里独立渲染。
		setShowProfilePanel(false);
	};

	// 关闭 ProfileEditPanel 后回到 ProfilePanel（picker）
	// 同样保留 profileSelectedIndex，让光标回到进入编辑面板时的位置。
	const closeProfileEditAndReturnToPicker = () => {
		setShowProfileEditPanel(false);
		setEditingProfileName(null);
		setShowProfilePanel(true);
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
			// Let MCPInfoPanel handle ESC internally (tool list page vs main page)
			return false;
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

		if (showRoleSubagentCreation) {
			return false; // Let the panel handle ESC
		}

		if (showRoleSubagentDeletion) {
			return false; // Let the panel handle ESC
		}

		if (showRoleSubagentList) {
			setShowRoleSubagentList(false);
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

		// ConnectionPanel handles its own ESC key logic internally
		if (showConnectionPanel) {
			return false; // Let ConnectionPanel handle ESC
		}

		// ProfileEditPanel 完全交由 ConfigScreen 内部处理 ESC：
		// 内部 useConfigInput 会按层级处理（先关闭 select 子项 / 退出编辑模式，
		// 再按 ESC 才会保存并通过 onBack 触发 closeProfileEditAndReturnToPicker）。
		// 外层若也处理，会一次 ESC 直接弹出整个面板，破坏多级返回体验。
		if (showProfileEditPanel) {
			return false;
		}

		if (showProfilePanel) {
			setShowProfilePanel(false);
			return true;
		}

		// NewPromptPanel handles its own ESC key logic internally
		if (showNewPromptPanel) {
			return false; // Let NewPromptPanel handle ESC
		}

		if (showTodoListPanel) {
			setShowTodoListPanel(false);
			return true;
		}
		if (showPixelEditor) {
			return false; // Let PixelEditorScreen handle ESC
		}

		if (showIdeSelectPanel) {
			setShowIdeSelectPanel(false);
			return true;
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
			showRoleSubagentCreation ||
			showRoleSubagentDeletion ||
			showRoleSubagentList ||
			showWorkingDirPanel ||
			showReviewCommitPanel ||
			showBranchPanel ||
			showProfilePanel ||
			showProfileEditPanel ||
			showDiffReviewPanel ||
			showConnectionPanel ||
			showNewPromptPanel ||
			showTodoListPanel ||
			showPixelEditor ||
			showIdeSelectPanel
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
		showRoleSubagentCreation,
		showRoleSubagentDeletion,
		showRoleSubagentList,
		showWorkingDirPanel,
		showReviewCommitPanel,
		showBranchPanel,
		showProfilePanel,
		showProfileEditPanel,
		editingProfileName,
		showDiffReviewPanel,
		showConnectionPanel,
		showNewPromptPanel,
		showTodoListPanel,
		showPixelEditor,
		showIdeSelectPanel,
		connectionPanelApiUrl,
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
		setShowRoleSubagentCreation,
		setShowRoleSubagentDeletion,
		setShowRoleSubagentList,
		setShowWorkingDirPanel,
		setShowReviewCommitPanel,
		setShowBranchPanel,
		setShowProfilePanel,
		setShowProfileEditPanel,
		setEditingProfileName,
		openProfileEdit,
		closeProfileEditAndReturnToPicker,
		setShowDiffReviewPanel,
		setShowConnectionPanel,
		setShowNewPromptPanel,
		setShowTodoListPanel,
		setShowPixelEditor,
		setShowIdeSelectPanel,
		setConnectionPanelApiUrl,
		setProfileSelectedIndex,
		setProfileSearchQuery,
		handleSwitchProfile,
		handleProfileSelect,
		handleEscapeKey,
		isAnyPanelOpen,
	};
}
