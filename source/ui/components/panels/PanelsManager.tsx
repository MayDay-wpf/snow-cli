import React, {lazy, Suspense} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {CustomCommandConfigPanel} from './CustomCommandConfigPanel.js';
import {SkillsCreationPanel} from './SkillsCreationPanel.js';
import {RoleCreationPanel} from './RoleCreationPanel.js';
import {RoleDeletionPanel} from './RoleDeletionPanel.js';
import {RoleListPanel} from './RoleListPanel.js';
import {RoleSubagentCreationPanel} from './RoleSubagentCreationPanel.js';
import {RoleSubagentDeletionPanel} from './RoleSubagentDeletionPanel.js';
import {RoleSubagentListPanel} from './RoleSubagentListPanel.js';
import {ModelsPanel} from './ModelsPanel.js';
import WorkingDirectoryPanel from './WorkingDirectoryPanel.js';
import {BranchPanel} from './BranchPanel.js';
import {ConnectionPanel} from './ConnectionPanel.js';
import TodoListPanel from './TodoListPanel.js';
import type {CommandLocation} from '../../../utils/commands/custom.js';
import type {
	GeneratedSkillContent,
	SkillLocation,
} from '../../../utils/commands/skills.js';
import type {RoleLocation} from '../../../utils/commands/role.js';
import type {RoleSubagentLocation} from '../../../utils/commands/roleSubagent.js';

// Lazy load panel components
const MCPInfoPanel = lazy(() => import('./MCPInfoPanel.js'));
const SessionListPanel = lazy(() => import('./SessionListPanel.js'));
const UsagePanel = lazy(() => import('./UsagePanel.js'));
const DiffReviewPanel = lazy(() => import('./DiffReviewPanel.js'));

type PanelsManagerProps = {
	terminalWidth: number;
	workingDirectory: string;
	showSessionPanel: boolean;
	showMcpPanel: boolean;
	showUsagePanel: boolean;
	showModelsPanel: boolean;
	showCustomCommandConfig: boolean;
	showSkillsCreation: boolean;
	showRoleCreation: boolean;
	showRoleDeletion: boolean;
	showRoleList: boolean;
	showRoleSubagentCreation: boolean;
	showRoleSubagentDeletion: boolean;
	showRoleSubagentList: boolean;
	showWorkingDirPanel: boolean;
	showBranchPanel: boolean;
	showDiffReviewPanel: boolean;
	showConnectionPanel: boolean;
	showTodoListPanel: boolean;
	connectionPanelApiUrl?: string;
	diffReviewMessages: Array<{
		role: string;
		content: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
		subAgentDirected?: unknown;
	}>;
	diffReviewSnapshotFileCount: Map<number, number>;
	advancedModel: string;
	basicModel: string;
	setShowSessionPanel: (show: boolean) => void;
	setShowMcpPanel: (show: boolean) => void;
	setShowModelsPanel: (show: boolean) => void;
	setShowCustomCommandConfig: (show: boolean) => void;
	setShowSkillsCreation: (show: boolean) => void;
	setShowRoleCreation: (show: boolean) => void;
	setShowRoleDeletion: (show: boolean) => void;
	setShowRoleList: (show: boolean) => void;
	setShowRoleSubagentCreation: (show: boolean) => void;
	setShowRoleSubagentDeletion: (show: boolean) => void;
	setShowRoleSubagentList: (show: boolean) => void;
	setShowWorkingDirPanel: (show: boolean) => void;
	setShowBranchPanel: (show: boolean) => void;
	setShowDiffReviewPanel: (show: boolean) => void;
	setShowConnectionPanel: (show: boolean) => void;
	setShowTodoListPanel: (show: boolean) => void;
	handleSessionPanelSelect: (sessionId: string) => Promise<void>;

	onCustomCommandSave: (
		name: string,
		command: string,
		type: 'execute' | 'prompt',
		location: CommandLocation,
		description?: string,
	) => Promise<void>;
	onSkillsSave: (
		skillName: string,
		description: string,
		location: SkillLocation,
		generated?: GeneratedSkillContent,
	) => Promise<void>;
	onRoleSave: (location: RoleLocation) => Promise<void>;
	onRoleDelete: (location: RoleLocation) => Promise<void>;
	onRoleSubagentSave: (
		agentName: string,
		location: RoleSubagentLocation,
	) => Promise<void>;
	onRoleSubagentDelete: (
		agentName: string,
		location: RoleSubagentLocation,
	) => Promise<void>;
};

export default function PanelsManager({
	terminalWidth,
	workingDirectory,
	showSessionPanel,
	showMcpPanel,
	showUsagePanel,
	showModelsPanel,
	showCustomCommandConfig,
	showSkillsCreation,
	showRoleCreation,
	showRoleDeletion,
	showRoleList,
	showRoleSubagentCreation,
	showRoleSubagentDeletion,
	showRoleSubagentList,
	showWorkingDirPanel,
	showBranchPanel,
	showDiffReviewPanel,
	showConnectionPanel,
	showTodoListPanel,
	connectionPanelApiUrl,
	diffReviewMessages,
	diffReviewSnapshotFileCount,
	advancedModel,
	basicModel,
	setShowSessionPanel,
	setShowMcpPanel,
	setShowModelsPanel,
	setShowCustomCommandConfig,
	setShowSkillsCreation,
	setShowRoleCreation,
	setShowRoleDeletion,
	setShowRoleList,
	setShowRoleSubagentCreation,
	setShowRoleSubagentDeletion,
	setShowRoleSubagentList,
	setShowWorkingDirPanel,
	setShowBranchPanel,
	setShowDiffReviewPanel,
	setShowConnectionPanel,
	setShowTodoListPanel,
	handleSessionPanelSelect,
	onCustomCommandSave,
	onSkillsSave,
	onRoleSave,
	onRoleDelete,
	onRoleSubagentSave,
	onRoleSubagentDelete,
}: PanelsManagerProps) {
	const {theme} = useTheme();
	const {t} = useI18n();

	const loadingFallback = (
		<Box>
			<Text>
				<Spinner type="dots" /> Loading...
			</Text>
		</Box>
	);

	return (
		<>
			{/* Show session list panel if active - replaces input */}
			{showSessionPanel && (
				<Box paddingX={1} width={terminalWidth}>
					<Suspense fallback={loadingFallback}>
						<SessionListPanel
							onSelectSession={handleSessionPanelSelect}
							onClose={() => setShowSessionPanel(false)}
						/>
					</Suspense>
				</Box>
			)}

			{/* Show MCP info panel if active - replaces input */}
			{showMcpPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense fallback={loadingFallback}>
						<MCPInfoPanel onClose={() => setShowMcpPanel(false)} />
					</Suspense>
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.chatScreen.pressEscToClose}
						</Text>
					</Box>
				</Box>
			)}

			{/* Show usage panel if active - replaces input */}
			{showUsagePanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense fallback={loadingFallback}>
						<UsagePanel />
					</Suspense>
					<Box marginTop={1}>
						<Text color={theme.colors.menuSecondary} dimColor>
							{t.chatScreen.pressEscToClose}
						</Text>
					</Box>
				</Box>
			)}

			{/* Show models panel if active - replaces input */}
			{showModelsPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<ModelsPanel
						advancedModel={advancedModel}
						basicModel={basicModel}
						visible={showModelsPanel}
						onClose={() => setShowModelsPanel(false)}
					/>
				</Box>
			)}

			{/* Show custom command config panel if active */}
			{showCustomCommandConfig && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<CustomCommandConfigPanel
						projectRoot={workingDirectory}
						onSave={onCustomCommandSave}
						onCancel={() => setShowCustomCommandConfig(false)}
					/>
				</Box>
			)}

			{/* Show skills creation panel if active */}
			{showSkillsCreation && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<SkillsCreationPanel
						projectRoot={workingDirectory}
						onSave={onSkillsSave}
						onCancel={() => setShowSkillsCreation(false)}
					/>
				</Box>
			)}

			{/* Show role creation panel if active */}
			{showRoleCreation && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<RoleCreationPanel
						projectRoot={workingDirectory}
						onSave={onRoleSave}
						onCancel={() => setShowRoleCreation(false)}
					/>
				</Box>
			)}

			{/* Show role deletion panel if active */}
			{showRoleDeletion && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<RoleDeletionPanel
						projectRoot={workingDirectory}
						onDelete={onRoleDelete}
						onCancel={() => setShowRoleDeletion(false)}
					/>
				</Box>
			)}

			{/* Show role list panel if active */}
			{showRoleList && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<RoleListPanel
						projectRoot={workingDirectory}
						onClose={() => setShowRoleList(false)}
					/>
				</Box>
			)}

			{/* Show sub-agent role creation panel if active */}
			{showRoleSubagentCreation && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<RoleSubagentCreationPanel
						projectRoot={workingDirectory}
						onSave={onRoleSubagentSave}
						onCancel={() => setShowRoleSubagentCreation(false)}
					/>
				</Box>
			)}

			{/* Show sub-agent role deletion panel if active */}
			{showRoleSubagentDeletion && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<RoleSubagentDeletionPanel
						projectRoot={workingDirectory}
						onDelete={onRoleSubagentDelete}
						onCancel={() => setShowRoleSubagentDeletion(false)}
					/>
				</Box>
			)}

			{/* Show sub-agent role list panel if active */}
			{showRoleSubagentList && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<RoleSubagentListPanel
						projectRoot={workingDirectory}
						onClose={() => setShowRoleSubagentList(false)}
					/>
				</Box>
			)}

			{/* Show working directory panel if active */}
			{showWorkingDirPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<WorkingDirectoryPanel
						onClose={() => setShowWorkingDirPanel(false)}
					/>
				</Box>
			)}

			{/* Show branch management panel if active */}
			{showBranchPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<BranchPanel onClose={() => setShowBranchPanel(false)} />
				</Box>
			)}

			{/* Show diff review panel if active */}
			{showDiffReviewPanel && (
				<Box paddingX={1} width={terminalWidth}>
					<Suspense fallback={loadingFallback}>
						<DiffReviewPanel
							messages={diffReviewMessages}
							snapshotFileCount={diffReviewSnapshotFileCount}
							onClose={() => setShowDiffReviewPanel(false)}
						/>
					</Suspense>
				</Box>
			)}

			{/* Show connection panel if active */}
			{showConnectionPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<ConnectionPanel
						onClose={() => setShowConnectionPanel(false)}
						initialApiUrl={connectionPanelApiUrl}
					/>
				</Box>
			)}

			{showTodoListPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<TodoListPanel onClose={() => setShowTodoListPanel(false)} />
				</Box>
			)}
		</>
	);
}
