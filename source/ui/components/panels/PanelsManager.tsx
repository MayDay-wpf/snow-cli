import React, {lazy, Suspense} from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import {useTheme} from '../../contexts/ThemeContext.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import {CustomCommandConfigPanel} from './CustomCommandConfigPanel.js';
import {SkillsCreationPanel} from './SkillsCreationPanel.js';
import {RoleCreationPanel} from './RoleCreationPanel.js';
import {RoleDeletionPanel} from './RoleDeletionPanel.js';
import WorkingDirectoryPanel from './WorkingDirectoryPanel.js';
import type {CommandLocation} from '../../../utils/commands/custom.js';
import type {
	GeneratedSkillContent,
	SkillLocation,
} from '../../../utils/commands/skills.js';
import type {RoleLocation} from '../../../utils/commands/role.js';

// Lazy load panel components
const MCPInfoPanel = lazy(() => import('./MCPInfoPanel.js'));
const SessionListPanel = lazy(() => import('./SessionListPanel.js'));
const UsagePanel = lazy(() => import('./UsagePanel.js'));
const HelpPanel = lazy(() => import('./HelpPanel.js'));

type PanelsManagerProps = {
	terminalWidth: number;
	workingDirectory: string;
	showSessionPanel: boolean;
	showMcpPanel: boolean;
	showUsagePanel: boolean;
	showHelpPanel: boolean;
	showCustomCommandConfig: boolean;
	showSkillsCreation: boolean;
	showRoleCreation: boolean;
	showRoleDeletion: boolean;
	showWorkingDirPanel: boolean;
	setShowSessionPanel: (show: boolean) => void;
	setShowCustomCommandConfig: (show: boolean) => void;
	setShowSkillsCreation: (show: boolean) => void;
	setShowRoleCreation: (show: boolean) => void;
	setShowRoleDeletion: (show: boolean) => void;
	setShowWorkingDirPanel: (show: boolean) => void;
	handleSessionPanelSelect: (sessionId: string) => Promise<void>;

	onCustomCommandSave: (
		name: string,
		command: string,
		type: 'execute' | 'prompt',
		location: CommandLocation,
	) => Promise<void>;
	onSkillsSave: (
		skillName: string,
		description: string,
		location: SkillLocation,
		generated?: GeneratedSkillContent,
	) => Promise<void>;
	onRoleSave: (location: RoleLocation) => Promise<void>;
	onRoleDelete: (location: RoleLocation) => Promise<void>;
};

export default function PanelsManager({
	terminalWidth,
	workingDirectory,
	showSessionPanel,
	showMcpPanel,
	showUsagePanel,
	showHelpPanel,
	showCustomCommandConfig,
	showSkillsCreation,
	showRoleCreation,
	showRoleDeletion,
	showWorkingDirPanel,
	setShowSessionPanel,
	setShowCustomCommandConfig,
	setShowSkillsCreation,
	setShowRoleCreation,
	setShowRoleDeletion,
	setShowWorkingDirPanel,
	handleSessionPanelSelect,
	onCustomCommandSave,
	onSkillsSave,
	onRoleSave,
	onRoleDelete,
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
						<MCPInfoPanel />
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

			{/* Show help panel if active - replaces input */}
			{showHelpPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<Suspense fallback={loadingFallback}>
						<HelpPanel />
					</Suspense>
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

			{/* Show working directory panel if active */}
			{showWorkingDirPanel && (
				<Box paddingX={1} flexDirection="column" width={terminalWidth}>
					<WorkingDirectoryPanel
						onClose={() => setShowWorkingDirPanel(false)}
					/>
				</Box>
			)}
		</>
	);
}
