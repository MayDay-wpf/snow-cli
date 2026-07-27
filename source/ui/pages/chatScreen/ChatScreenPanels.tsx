import React, {lazy, Suspense} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import type {Dispatch, SetStateAction} from 'react';
import type {Message} from '../../components/chat/MessageList.js';
import PanelsManager from '../../components/panels/PanelsManager.js';
import FileRollbackConfirmation, {
	type RollbackMode,
} from '../../components/tools/FileRollbackConfirmation.js';
import {
	saveCustomCommand,
	registerCustomCommands,
} from '../../../utils/commands/custom.js';
import {
	createSkillFromGenerated,
	createSkillTemplate,
} from '../../../utils/commands/skills.js';
import {sessionManager} from '../../../utils/session/sessionManager.js';
import type {
	PanelActions,
	PanelState,
} from '../../../hooks/ui/usePanelState.js';
import PixelEditorScreen from '../PixelEditorScreen.js';
import GamesScreen from '../GamesScreen.js';
import AnyPanelScreen from '../AnyPanelScreen.js';
const PermissionsPanel = lazy(
	() => import('../../components/panels/PermissionsPanel.js'),
);
const NewPromptPanel = lazy(
	() => import('../../components/panels/NewPromptPanel.js'),
);
const SubAgentDepthPanel = lazy(
	() => import('../../components/panels/SubAgentDepthPanel.js'),
);
const DisplayPanel = lazy(
	() => import('../../components/panels/DisplayPanel.js'),
);
const ProfileEditPanel = lazy(
	() => import('../../components/panels/ProfileEditPanel.js'),
);
const TaskManagerScreen = lazy(() => import('../TaskManagerScreen.js'));
const ModelsPanel = lazy(() =>
	import('../../components/panels/ModelsPanel.js').then(m => ({
		default: m.ModelsPanel,
	})),
);

type SnapshotState = {
	snapshotFileCount: Map<number, number>;
	pendingRollback: {
		messageIndex: number;
		previewTargetMessageIndex?: number;
		fileCount: number;
		filePaths?: string[];
		notebookCount?: number;
		teamCount?: number;
		todoCount?: number;
	} | null;
};

type Props = {
	terminalWidth: number;
	workingDirectory: string;
	panelState: PanelState & PanelActions;
	snapshotState: SnapshotState;
	handleSessionPanelSelect: (sessionId: string) => Promise<void>;
	handleGoalSessionPanelSelect: (sessionId: string) => Promise<void>;
	showPermissionsPanel: boolean;
	setShowPermissionsPanel: Dispatch<SetStateAction<boolean>>;
	showSubAgentDepthPanel: boolean;
	setShowSubAgentDepthPanel: Dispatch<SetStateAction<boolean>>;
	showDisplayPanel: boolean;
	setShowDisplayPanel: Dispatch<SetStateAction<boolean>>;
	modelsPanelAdvancedModel: string;
	modelsPanelBasicModel: string;
	alwaysApprovedTools: Set<string>;
	removeFromAlwaysApproved: (toolName: string) => void;
	clearAllAlwaysApproved: () => void;
	setMessages: Dispatch<SetStateAction<Message[]>>;
	t: any;
	onPromptAccept: (prompt: string) => void;
	onTaskResume: () => void;
	handleRollbackConfirm: (
		mode: RollbackMode | null,
		selectedFiles?: string[],
	) => void;
	showAnyPanel: boolean;
	activeAnyPanelPluginId: string | null;
	setShowAnyPanel: (show: boolean) => void;
	setActiveAnyPanelPluginId: (id: string | null) => void;
};

export default function ChatScreenPanels({
	terminalWidth,
	workingDirectory,
	panelState,
	snapshotState,
	handleSessionPanelSelect,
	handleGoalSessionPanelSelect,
	showPermissionsPanel,
	setShowPermissionsPanel,
	showSubAgentDepthPanel,
	setShowSubAgentDepthPanel,
	showDisplayPanel,
	setShowDisplayPanel,
	modelsPanelAdvancedModel,
	modelsPanelBasicModel,
	alwaysApprovedTools,
	removeFromAlwaysApproved,
	clearAllAlwaysApproved,
	setMessages,
	t,
	onPromptAccept,
	onTaskResume,
	handleRollbackConfirm,
	showAnyPanel,
	activeAnyPanelPluginId,
	setShowAnyPanel,
	setActiveAnyPanelPluginId,
}: Props) {
	return (
		<>
			<PanelsManager
				terminalWidth={terminalWidth}
				workingDirectory={workingDirectory}
				showSessionPanel={panelState.showSessionPanel}
				showGoalSessionPanel={panelState.showGoalSessionPanel}
				showMcpPanel={panelState.showMcpPanel}
				showUsagePanel={panelState.showUsagePanel}
				showContextPanel={panelState.showContextPanel}
				showHelpPanel={panelState.showHelpPanel}
				showCustomCommandConfig={panelState.showCustomCommandConfig}
				showSkillsCreation={panelState.showSkillsCreation}
				showSkillsInstall={panelState.showSkillsInstall}
				showRoleCreation={panelState.showRoleCreation}
				showRoleDeletion={panelState.showRoleDeletion}
				showRoleList={panelState.showRoleList}
				showRoleSubagentCreation={panelState.showRoleSubagentCreation}
				showRoleSubagentDeletion={panelState.showRoleSubagentDeletion}
				showRoleSubagentList={panelState.showRoleSubagentList}
				showWorkingDirPanel={panelState.showWorkingDirPanel}
				showBranchPanel={panelState.showBranchPanel}
				showConnectionPanel={panelState.showConnectionPanel}
				showTelemetryPanel={panelState.showTelemetryPanel}
				showTodoListPanel={panelState.showTodoListPanel}
				connectionPanelApiUrl={panelState.connectionPanelApiUrl}
				setShowSessionPanel={panelState.setShowSessionPanel}
				setShowGoalSessionPanel={panelState.setShowGoalSessionPanel}
				setShowMcpPanel={panelState.setShowMcpPanel}
				setShowCustomCommandConfig={panelState.setShowCustomCommandConfig}
				setShowSkillsCreation={panelState.setShowSkillsCreation}
				setShowSkillsInstall={panelState.setShowSkillsInstall}
				setShowRoleCreation={panelState.setShowRoleCreation}
				setShowRoleDeletion={panelState.setShowRoleDeletion}
				setShowRoleList={panelState.setShowRoleList}
				setShowRoleSubagentCreation={panelState.setShowRoleSubagentCreation}
				setShowRoleSubagentDeletion={panelState.setShowRoleSubagentDeletion}
				setShowRoleSubagentList={panelState.setShowRoleSubagentList}
				setShowWorkingDirPanel={panelState.setShowWorkingDirPanel}
				setShowBranchPanel={panelState.setShowBranchPanel}
				setShowConnectionPanel={panelState.setShowConnectionPanel}
				setShowTelemetryPanel={panelState.setShowTelemetryPanel}
				setShowTodoListPanel={panelState.setShowTodoListPanel}
				handleSessionPanelSelect={handleSessionPanelSelect}
				handleGoalSessionPanelSelect={handleGoalSessionPanelSelect}
				onCustomCommandSave={async (
					name,
					command,
					type,
					location,
					description,
				) => {
					await saveCustomCommand(
						name,
						command,
						type,
						description,
						location,
						workingDirectory,
					);
					await registerCustomCommands(workingDirectory);
					panelState.setShowCustomCommandConfig(false);
					const typeDesc =
						type === 'execute'
							? t.customCommand.resultTypeExecute
							: type === 'prompt'
							? t.customCommand.resultTypePrompt
							: t.customCommand.resultTypePanel;
					const locationDesc =
						location === 'global'
							? t.customCommand.resultLocationGlobal
							: t.customCommand.resultLocationProject;
					const content = t.customCommand.saveSuccessMessage
						.replace('{name}', name)
						.replace('{type}', typeDesc)
						.replace('{location}', locationDesc);
					const successMessage: Message = {
						role: 'command',
						content,
						commandName: 'custom',
					};
					setMessages(prev => [...prev, successMessage]);
				}}
				onSkillsSave={async (skillName, description, location, generated) => {
					const result = generated
						? await createSkillFromGenerated(
								skillName,
								description,
								generated,
								location,
								workingDirectory,
						  )
						: await createSkillTemplate(
								skillName,
								description,
								location,
								workingDirectory,
						  );
					panelState.setShowSkillsCreation(false);

					if (result.success) {
						const locationDesc =
							location === 'global'
								? t.skillsCreation.locationGlobal
								: t.skillsCreation.locationProject;
						const modeDesc = generated
							? t.skillsCreation.resultModeAi
							: t.skillsCreation.resultModeManual;
						const content = t.skillsCreation.createSuccessMessage
							.replace('{name}', skillName)
							.replace('{mode}', modeDesc)
							.replace('{location}', locationDesc)
							.replace('{path}', result.path);
						const successMessage: Message = {
							role: 'command',
							content,
							commandName: 'skills',
						};
						setMessages(prev => [...prev, successMessage]);
					} else {
						const errorText = result.error || t.skillsCreation.errorUnknown;
						const content = t.skillsCreation.createErrorMessage.replace(
							'{error}',
							errorText,
						);
						const errorMessage: Message = {
							role: 'command',
							content,
							commandName: 'skills',
						};
						setMessages(prev => [...prev, errorMessage]);
					}
				}}
				onSkillsInstall={(success, _skillId, message) => {
					const content = success ? message : message;
					const resultMessage: Message = {
						role: 'command',
						content,
						commandName: 'skills',
					};
					setMessages(prev => [...prev, resultMessage]);
				}}
				onRoleSave={async location => {
					const {createRoleFile} = await import(
						'../../../utils/commands/role.js'
					);
					const result = await createRoleFile(location, workingDirectory);
					panelState.setShowRoleCreation(false);

					if (result.success) {
						const locationDesc =
							location === 'global'
								? t.roleCreation.locationGlobal
								: t.roleCreation.locationProject;
						const content = t.roleCreation.createSuccessMessage
							.replace('{location}', locationDesc)
							.replace('{path}', result.path);
						const successMessage: Message = {
							role: 'command',
							content,
							commandName: 'role',
						};
						setMessages(prev => [...prev, successMessage]);
					} else {
						const errorText = result.error || t.roleCreation.errorUnknown;
						const content = t.roleCreation.createErrorMessage.replace(
							'{error}',
							errorText,
						);
						const errorMessage: Message = {
							role: 'command',
							content,
							commandName: 'role',
						};
						setMessages(prev => [...prev, errorMessage]);
					}
				}}
				onRoleSubagentSave={async (agentName, location) => {
					const {createRoleSubagentFile} = await import(
						'../../../utils/commands/roleSubagent.js'
					);
					const result = await createRoleSubagentFile(
						agentName,
						location,
						workingDirectory,
					);
					panelState.setShowRoleSubagentCreation(false);

					if (result.success) {
						const locationDesc =
							location === 'global'
								? t.roleSubagentCreation?.locationGlobal || 'Global'
								: t.roleSubagentCreation?.locationProject || 'Project';
						const content = (
							t.roleSubagentCreation?.createSuccessMessage ||
							'Created sub-agent role successfully! | Agent: {agent} | Location: {location} | Path: {path}'
						)
							.replace('{agent}', agentName)
							.replace('{location}', locationDesc)
							.replace('{path}', result.path);
						const successMessage: Message = {
							role: 'command',
							content,
							commandName: 'role-subagent',
						};
						setMessages(prev => [...prev, successMessage]);
					} else {
						const errorText =
							result.error ||
							t.roleSubagentCreation?.errorUnknown ||
							'Unknown error';
						const content = (
							t.roleSubagentCreation?.createErrorMessage ||
							'Failed to create sub-agent role: {error}'
						).replace('{error}', errorText);
						const errorMessage: Message = {
							role: 'command',
							content,
							commandName: 'role-subagent',
						};
						setMessages(prev => [...prev, errorMessage]);
					}
				}}
				onRoleSubagentDelete={async (agentName, location) => {
					const {deleteRoleSubagentFile} = await import(
						'../../../utils/commands/roleSubagent.js'
					);
					const result = await deleteRoleSubagentFile(
						agentName,
						location,
						workingDirectory,
					);
					panelState.setShowRoleSubagentDeletion(false);

					if (result.success) {
						const locationDesc =
							location === 'global'
								? t.roleSubagentDeletion?.locationGlobal || 'Global'
								: t.roleSubagentDeletion?.locationProject || 'Project';
						const content = (
							t.roleSubagentDeletion?.deleteSuccessMessage ||
							'Deleted sub-agent role successfully! | Agent: {agent} | Location: {location} | Path: {path}'
						)
							.replace('{agent}', agentName)
							.replace('{location}', locationDesc)
							.replace('{path}', result.path);
						const successMessage: Message = {
							role: 'command',
							content,
							commandName: 'role-subagent',
						};
						setMessages(prev => [...prev, successMessage]);
					} else {
						const errorText =
							result.error ||
							t.roleSubagentDeletion?.errorUnknown ||
							'Unknown error';
						const content = (
							t.roleSubagentDeletion?.deleteErrorMessage ||
							'Failed to delete sub-agent role: {error}'
						).replace('{error}', errorText);
						const errorMessage: Message = {
							role: 'command',
							content,
							commandName: 'role-subagent',
						};
						setMessages(prev => [...prev, errorMessage]);
					}
				}}
				onRoleDelete={async location => {
					const {deleteRoleFile} = await import(
						'../../../utils/commands/role.js'
					);
					const result = await deleteRoleFile(location, workingDirectory);
					panelState.setShowRoleDeletion(false);

					if (result.success) {
						const locationDesc =
							location === 'global'
								? t.roleDeletion.locationGlobal
								: t.roleDeletion.locationProject;
						const content = t.roleDeletion.deleteSuccessMessage
							.replace('{location}', locationDesc)
							.replace('{path}', result.path);
						const successMessage: Message = {
							role: 'command',
							content,
							commandName: 'role',
						};
						setMessages(prev => [...prev, successMessage]);
					} else {
						const errorText = result.error || t.roleDeletion.errorUnknown;
						const content = t.roleDeletion.deleteErrorMessage.replace(
							'{error}',
							errorText,
						);
						const errorMessage: Message = {
							role: 'command',
							content,
							commandName: 'role',
						};
						setMessages(prev => [...prev, errorMessage]);
					}
				}}
			/>

			{panelState.showNewPromptPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" />{' '}
									{(t as any).panelChrome?.loading || 'Loading…'}
								</Text>
							</Box>
						}
					>
						<NewPromptPanel
							onAccept={(prompt: string) => {
								panelState.setShowNewPromptPanel(false);
								onPromptAccept(prompt);
							}}
							onCancel={() => {
								panelState.setShowNewPromptPanel(false);
							}}
						/>
					</Suspense>
				</Box>
			)}

			{showSubAgentDepthPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" />{' '}
									{(t as any).panelChrome?.loading || 'Loading…'}
								</Text>
							</Box>
						}
					>
						<SubAgentDepthPanel
							visible={showSubAgentDepthPanel}
							onClose={() => setShowSubAgentDepthPanel(false)}
						/>
					</Suspense>
				</Box>
			)}

			{showDisplayPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" />{' '}
									{(t as any).panelChrome?.loading || 'Loading…'}
								</Text>
							</Box>
						}
					>
						<DisplayPanel
							visible={showDisplayPanel}
							onClose={() => setShowDisplayPanel(false)}
						/>
					</Suspense>
				</Box>
			)}

			{showPermissionsPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" />{' '}
									{(t as any).panelChrome?.loading || 'Loading…'}
								</Text>
							</Box>
						}
					>
						<PermissionsPanel
							alwaysApprovedTools={alwaysApprovedTools}
							onRemoveTool={removeFromAlwaysApproved}
							onClearAll={clearAllAlwaysApproved}
							onClose={() => setShowPermissionsPanel(false)}
						/>
					</Suspense>
				</Box>
			)}

			{snapshotState.pendingRollback && (
				<FileRollbackConfirmation
					fileCount={snapshotState.pendingRollback.fileCount}
					filePaths={snapshotState.pendingRollback.filePaths || []}
					notebookCount={snapshotState.pendingRollback.notebookCount}
					teamCount={snapshotState.pendingRollback.teamCount}
					todoCount={snapshotState.pendingRollback.todoCount}
					previewSessionId={sessionManager.getCurrentSession()?.id}
					previewTargetMessageIndex={
						snapshotState.pendingRollback.previewTargetMessageIndex ??
						snapshotState.pendingRollback.messageIndex
					}
					terminalWidth={terminalWidth}
					onConfirm={handleRollbackConfirm}
				/>
			)}

			{panelState.showPixelEditor && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<PixelEditorScreen
						onBack={() => panelState.setShowPixelEditor(false)}
					/>
				</Box>
			)}

			{panelState.showGamesPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<GamesScreen
						onBack={() => panelState.setShowGamesPanel(false)}
						terminalWidth={terminalWidth}
					/>
				</Box>
			)}
			{showAnyPanel && activeAnyPanelPluginId && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<AnyPanelScreen
						pluginId={activeAnyPanelPluginId}
						terminalWidth={terminalWidth}
						sessionId={sessionManager.getCurrentSession()?.id ?? ''}
						sessionJson={
							sessionManager.getCurrentSession()
								? JSON.stringify(sessionManager.getCurrentSession())
								: ''
						}
						onClose={() => {
							setShowAnyPanel(false);
							setActiveAnyPanelPluginId(null);
						}}
					/>
				</Box>
			)}

			{panelState.showTaskManagerPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" />{' '}
									{(t as any).panelChrome?.loading || 'Loading…'}
								</Text>
							</Box>
						}
					>
						<TaskManagerScreen
							onBack={() => panelState.setShowTaskManagerPanel(false)}
							onResumeTask={() => {
								panelState.setShowTaskManagerPanel(false);
								onTaskResume();
							}}
						/>
					</Suspense>
				</Box>
			)}

			{panelState.showModelsPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" />{' '}
									{(t as any).panelChrome?.loading || 'Loading…'}
								</Text>
							</Box>
						}
					>
						<ModelsPanel
							advancedModel={modelsPanelAdvancedModel}
							basicModel={modelsPanelBasicModel}
							visible={panelState.showModelsPanel}
							onClose={() => panelState.setShowModelsPanel(false)}
						/>
					</Suspense>
				</Box>
			)}

			{/* ProfileEditPanel：从 ProfilePanel 按右方向键进入，
			    编辑指定 profile（不切换 active）。ESC 由 ConfigScreen 内部处理：
			    保存配置并通过 onBack 触发 closeProfileEditAndReturnToPicker，
			    返回到 ProfilePanel（picker）。 */}
			{panelState.showProfileEditPanel && panelState.editingProfileName && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" />{' '}
									{(t as any).panelChrome?.loading || 'Loading…'}
								</Text>
							</Box>
						}
					>
						<ProfileEditPanel
							profileName={panelState.editingProfileName}
							onClose={panelState.closeProfileEditAndReturnToPicker}
						/>
					</Suspense>
				</Box>
			)}
		</>
	);
}
