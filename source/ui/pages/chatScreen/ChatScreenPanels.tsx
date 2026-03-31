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

const PermissionsPanel = lazy(
	() => import('../../components/panels/PermissionsPanel.js'),
);
const NewPromptPanel = lazy(
	() => import('../../components/panels/NewPromptPanel.js'),
);
const SubAgentDepthPanel = lazy(
	() => import('../../components/panels/SubAgentDepthPanel.js'),
);

type SnapshotState = {
	snapshotFileCount: Map<number, number>;
	pendingRollback: {
		messageIndex: number;
		fileCount: number;
		filePaths?: string[];
		notebookCount?: number;
		teamCount?: number;
	} | null;
};

type Props = {
	terminalWidth: number;
	workingDirectory: string;
	panelState: PanelState & PanelActions;
	messages: Message[];
	snapshotState: SnapshotState;
	advancedModel: string;
	basicModel: string;
	handleSessionPanelSelect: (sessionId: string) => Promise<void>;
	showPermissionsPanel: boolean;
	setShowPermissionsPanel: Dispatch<SetStateAction<boolean>>;
	showSubAgentDepthPanel: boolean;
	setShowSubAgentDepthPanel: Dispatch<SetStateAction<boolean>>;
	alwaysApprovedTools: Set<string>;
	removeFromAlwaysApproved: (toolName: string) => void;
	clearAllAlwaysApproved: () => void;
	setMessages: Dispatch<SetStateAction<Message[]>>;
	t: any;
	onPromptAccept: (prompt: string) => void;
	handleRollbackConfirm: (
		mode: RollbackMode | null,
		selectedFiles?: string[],
	) => void;
};

export default function ChatScreenPanels({
	terminalWidth,
	workingDirectory,
	panelState,
	messages,
	snapshotState,
	advancedModel,
	basicModel,
	handleSessionPanelSelect,
	showPermissionsPanel,
	setShowPermissionsPanel,
	showSubAgentDepthPanel,
	setShowSubAgentDepthPanel,
	alwaysApprovedTools,
	removeFromAlwaysApproved,
	clearAllAlwaysApproved,
	setMessages,
	t,
	onPromptAccept,
	handleRollbackConfirm,
}: Props) {
	return (
		<>
			<PanelsManager
				terminalWidth={terminalWidth}
				workingDirectory={workingDirectory}
				showSessionPanel={panelState.showSessionPanel}
				showMcpPanel={panelState.showMcpPanel}
				showUsagePanel={panelState.showUsagePanel}
				showModelsPanel={panelState.showModelsPanel}
				showCustomCommandConfig={panelState.showCustomCommandConfig}
				showSkillsCreation={panelState.showSkillsCreation}
				showRoleCreation={panelState.showRoleCreation}
				showRoleDeletion={panelState.showRoleDeletion}
				showRoleList={panelState.showRoleList}
				showRoleSubagentCreation={panelState.showRoleSubagentCreation}
				showRoleSubagentDeletion={panelState.showRoleSubagentDeletion}
				showRoleSubagentList={panelState.showRoleSubagentList}
				showWorkingDirPanel={panelState.showWorkingDirPanel}
				showBranchPanel={panelState.showBranchPanel}
				showDiffReviewPanel={panelState.showDiffReviewPanel}
				showConnectionPanel={panelState.showConnectionPanel}
				showTodoListPanel={panelState.showTodoListPanel}
				connectionPanelApiUrl={panelState.connectionPanelApiUrl}
				diffReviewMessages={messages}
				diffReviewSnapshotFileCount={snapshotState.snapshotFileCount}
				advancedModel={advancedModel}
				basicModel={basicModel}
				setShowSessionPanel={panelState.setShowSessionPanel}
				setShowMcpPanel={panelState.setShowMcpPanel}
				setShowModelsPanel={panelState.setShowModelsPanel}
				setShowCustomCommandConfig={panelState.setShowCustomCommandConfig}
				setShowSkillsCreation={panelState.setShowSkillsCreation}
				setShowRoleCreation={panelState.setShowRoleCreation}
				setShowRoleDeletion={panelState.setShowRoleDeletion}
				setShowRoleList={panelState.setShowRoleList}
				setShowRoleSubagentCreation={panelState.setShowRoleSubagentCreation}
				setShowRoleSubagentDeletion={panelState.setShowRoleSubagentDeletion}
				setShowRoleSubagentList={panelState.setShowRoleSubagentList}
				setShowWorkingDirPanel={panelState.setShowWorkingDirPanel}
				setShowBranchPanel={panelState.setShowBranchPanel}
				setShowDiffReviewPanel={panelState.setShowDiffReviewPanel}
				setShowConnectionPanel={panelState.setShowConnectionPanel}
				setShowTodoListPanel={panelState.setShowTodoListPanel}
				handleSessionPanelSelect={handleSessionPanelSelect}
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
							: t.customCommand.resultTypePrompt;
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
									<Spinner type="dots" /> Loading...
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
									<Spinner type="dots" /> Loading...
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

			{showPermissionsPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense
						fallback={
							<Box>
								<Text>
									<Spinner type="dots" /> Loading...
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
					previewSessionId={sessionManager.getCurrentSession()?.id}
					previewTargetMessageIndex={snapshotState.pendingRollback.messageIndex}
					onConfirm={handleRollbackConfirm}
				/>
			)}
		</>
	);
}
