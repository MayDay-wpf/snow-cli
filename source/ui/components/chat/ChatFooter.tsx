import React from 'react';
import {Box, Text} from 'ink';
import Spinner from 'ink-spinner';
import ChatInput from './ChatInput.js';
import StatusLine from '../common/StatusLine.js';
import {useI18n} from '../../../i18n/I18nContext.js';
import type {Message} from './MessageList.js';

type ChatFooterProps = {
	onSubmit: (
		message: string,
		images?: Array<{data: string; mimeType: string}>,
	) => Promise<void>;
	onCommand: (commandName: string, result: any) => Promise<void>;
	onHistorySelect: (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => Promise<void>;
	onSwitchProfile: () => void;
	handleProfileSelect: (profileName: string) => void;
	handleHistorySelect: (
		selectedIndex: number,
		message: string,
		images?: Array<{type: 'image'; data: string; mimeType: string}>,
	) => Promise<void>;

	disabled: boolean;
	isStopping: boolean;
	isProcessing: boolean;
	chatHistory: Message[];
	yoloMode: boolean;
	setYoloMode: (value: boolean) => void;
	planMode: boolean;
	setPlanMode: (value: boolean) => void;
	vulnerabilityHuntingMode: boolean;
	setVulnerabilityHuntingMode: (value: boolean) => void;
	contextUsage?: {
		inputTokens: number;
		maxContextTokens: number;
		cacheCreationTokens?: number;
		cacheReadTokens?: number;
		cachedTokens?: number;
	};
	initialContent: {
		text: string;
		images?: Array<{type: 'image'; data: string; mimeType: string}>;
	} | null;
	onContextPercentageChange: (percentage: number) => void;
	showProfilePicker: boolean;
	setShowProfilePicker: (value: boolean | ((prev: boolean) => boolean)) => void;
	profileSelectedIndex: number;
	setProfileSelectedIndex: (index: number | ((prev: number) => number)) => void;
	getFilteredProfiles: () => any[];
	profileSearchQuery: string;
	setProfileSearchQuery: (query: string) => void;

	vscodeConnectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
	editorContext?: {
		activeFile?: string;
		selectedText?: string;
		cursorPosition?: {line: number; character: number};
		workspacePath?: string;
	};
	codebaseIndexing: boolean;
	codebaseProgress: {
		totalFiles: number;
		processedFiles: number;
		totalChunks: number;
		currentFile: string;
		status: string;
		error?: string;
	} | null;
	watcherEnabled: boolean;
	fileUpdateNotification: {file: string; timestamp: number} | null;
	currentProfileName: string;

	isCompressing: boolean;
	compressionError: string | null;
};

export default function ChatFooter(props: ChatFooterProps) {
	const {t} = useI18n();

	return (
		<>
			<ChatInput
				onSubmit={props.onSubmit}
				onCommand={props.onCommand}
				placeholder={t.chatScreen.inputPlaceholder}
				disabled={props.disabled || props.isStopping}
				isProcessing={props.isProcessing}
				chatHistory={props.chatHistory}
				onHistorySelect={props.handleHistorySelect}
				yoloMode={props.yoloMode}
				setYoloMode={props.setYoloMode}
				planMode={props.planMode}
				setPlanMode={props.setPlanMode}
				vulnerabilityHuntingMode={props.vulnerabilityHuntingMode}
				setVulnerabilityHuntingMode={props.setVulnerabilityHuntingMode}
				contextUsage={props.contextUsage}
				initialContent={props.initialContent}
				onContextPercentageChange={props.onContextPercentageChange}
				showProfilePicker={props.showProfilePicker}
				setShowProfilePicker={props.setShowProfilePicker}
				profileSelectedIndex={props.profileSelectedIndex}
				setProfileSelectedIndex={props.setProfileSelectedIndex}
				getFilteredProfiles={props.getFilteredProfiles}
				handleProfileSelect={props.handleProfileSelect}
				profileSearchQuery={props.profileSearchQuery}
				setProfileSearchQuery={props.setProfileSearchQuery}
				onSwitchProfile={props.onSwitchProfile}
			/>

			<StatusLine
				yoloMode={props.yoloMode}
				planMode={props.planMode}
				vulnerabilityHuntingMode={props.vulnerabilityHuntingMode}
				vscodeConnectionStatus={props.vscodeConnectionStatus}
				editorContext={props.editorContext}
				contextUsage={props.contextUsage}
				codebaseIndexing={props.codebaseIndexing}
				codebaseProgress={props.codebaseProgress}
				watcherEnabled={props.watcherEnabled}
				fileUpdateNotification={props.fileUpdateNotification}
				currentProfileName={props.currentProfileName}
			/>

			{props.isCompressing && (
				<Box marginTop={1}>
					<Text color="cyan">
						<Spinner type="dots" /> {t.chatScreen.compressionInProgress}
					</Text>
				</Box>
			)}

			{props.compressionError && (
				<Box marginTop={1}>
					<Text color="red">
						{t.chatScreen.compressionFailed.replace(
							'{error}',
							props.compressionError,
						)}
					</Text>
				</Box>
			)}
		</>
	);
}
