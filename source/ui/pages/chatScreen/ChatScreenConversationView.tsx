import React, {useCallback, useMemo} from 'react';
import {Box, Static} from 'ink';
import type {Message} from '../../components/chat/MessageList.js';
import VirtualScrollView from '../../components/common/VirtualScrollView.js';
import {useTheme} from '../../contexts/ThemeContext.js';
import PendingMessages from '../../components/chat/PendingMessages.js';
import ToolConfirmation from '../../components/tools/ToolConfirmation.js';
import AskUserQuestion from '../../components/special/AskUserQuestion.js';
import {
	BashCommandConfirmation,
	BashCommandExecutionStatus,
} from '../../components/bash/BashCommandConfirmation.js';
import {CustomCommandExecutionDisplay} from '../../components/bash/CustomCommandExecutionDisplay.js';
import {SchedulerCountdown} from '../../components/scheduler/SchedulerCountdown.js';
import MessageRenderer, {
	computeParallelGroupEdges,
} from '../../components/chat/MessageRenderer.js';
import ChatHeader from '../../components/special/ChatHeader.js';
import {HookErrorDisplay} from '../../components/special/HookErrorDisplay.js';
import {HookStatusDisplay} from '../../components/special/HookStatusDisplay.js';
import type {HookStatusEvent} from '../../../utils/execution/hookStatusEvents.js';
import {CompressionStatus} from '../../components/compression/CompressionStatus.js';
import type {CompressionStatus as CompressionStatusType} from '../../components/compression/CompressionStatus.js';
import type {ThinkDisplayMode} from '../../../utils/config/themeConfig.js';
import type {HookErrorDetails} from '../../../utils/execution/hookResultInterpreter.js';
import type {
	BashSensitiveCommandState,
	CustomCommandExecutionState,
	PendingMessageInput,
	PendingUserQuestionState,
} from './types.js';

type Props = {
	remountKey: number;
	terminalWidth: number;
	workingDirectory: string;
	simpleMode: boolean;
	messages: Message[];
	showThinking: boolean;
	toolDisplayMode: 'full' | 'compact' | 'hidden';
	thinkDisplayMode: ThinkDisplayMode;
	pendingMessages: PendingMessageInput[];
	pendingToolConfirmation: any;
	pendingUserQuestion: PendingUserQuestionState;
	bashSensitiveCommand: BashSensitiveCommandState;
	terminalExecutionState: any;
	schedulerExecutionState: any;
	customCommandExecution: CustomCommandExecutionState;
	bashMode: any;
	hookError: HookErrorDetails | null;
	hookStatus: HookStatusEvent | null;
	handleUserQuestionAnswer: (result: any) => void;
	setHookError: React.Dispatch<React.SetStateAction<HookErrorDetails | null>>;
	compressionStatus: CompressionStatusType | null;
	/**
	 * Total terminal height, used to shrink the fixed header on small screens.
	 */
	terminalHeight: number;
	/**
	 * Whether PageUp/PageDown should scroll the conversation (disabled while
	 * a blocking panel owns the keyboard).
	 */
	scrollKeyboardActive: boolean;
	/**
	 * Render mode. false = classic inline renderer (<Static> history in the
	 * terminal scrollback, default); true = full-screen TUI with a fixed header
	 * and a virtualized, scrollable conversation area.
	 */
	fullscreen: boolean;
};

/**
 * Below this height the full banner header would leave too little room for
 * the conversation, so the compact header is used instead.
 */
const FULL_HEADER_MIN_ROWS = 30;

/**
 * Rough row-count guess for a message that has not been measured yet. Only
 * used for scrollbar size / offscreen spacing; real heights replace it as
 * soon as the item is rendered once.
 */
function estimateMessageHeight(message: Message, width: number): number {
	const usable = Math.max(10, width - 4);
	const text = message.content || '';
	let rows = 0;
	for (const line of text.split('\n')) {
		rows += Math.max(1, Math.ceil(line.length / usable));
	}

	if (message.toolResult || message.toolCall) {
		rows += 2;
	}

	return Math.min(rows, 400) + 1;
}

export default function ChatScreenConversationView({
	remountKey,
	terminalWidth,
	workingDirectory,
	simpleMode,
	messages,
	showThinking,
	toolDisplayMode,
	thinkDisplayMode,
	pendingMessages,
	pendingToolConfirmation,
	pendingUserQuestion,
	bashSensitiveCommand,
	terminalExecutionState,
	schedulerExecutionState,
	customCommandExecution,
	bashMode,
	hookError,
	hookStatus,
	handleUserQuestionAnswer,
	setHookError,
	compressionStatus,
	terminalHeight,
	scrollKeyboardActive,
	fullscreen,
}: Props) {
	const {theme} = useTheme();
	// Pre-compute parallel group edges for non-streaming messages.
	// This replaces the old index-based lookups inside MessageRenderer,
	// enabling React.memo to skip re-renders for unchanged messages.
	const staticMessages = useMemo(
		() => messages.filter(m => !m.streaming),
		[messages],
	);
	const {isFirstInGroup, isLastInGroup} = useMemo(
		() => computeParallelGroupEdges(staticMessages),
		[staticMessages],
	);

	// Full-screen: the conversation scrolls inside a fixed region and 1 column
	// is reserved for the scrollbar. Classic: use the whole terminal width.
	const contentWidth = fullscreen
		? Math.max(1, terminalWidth - 1)
		: terminalWidth;

	const renderMessage = useCallback(
		(message: Message, index: number) => (
			<MessageRenderer
				message={message}
				terminalWidth={contentWidth}
				isFirstInGroup={isFirstInGroup[index]}
				isLastInGroup={isLastInGroup[index]}
				showThinking={showThinking}
				toolDisplayMode={toolDisplayMode}
				thinkDisplayMode={thinkDisplayMode}
			/>
		),
		[
			contentWidth,
			isFirstInGroup,
			isLastInGroup,
			showThinking,
			toolDisplayMode,
			thinkDisplayMode,
		],
	);

	const estimateHeight = useCallback(
		(message: Message) => estimateMessageHeight(message, contentWidth),
		[contentWidth],
	);

	// Jump back to the bottom whenever the user sends a new message or an
	// interactive prompt appears; otherwise keep the user's scroll position.
	const userMessageCount = useMemo(
		() => messages.reduce((n, m) => (m.role === 'user' ? n + 1 : n), 0),
		[messages],
	);
	const stickToBottomKey = [
		remountKey,
		userMessageCount,
		pendingToolConfirmation ? 1 : 0,
		pendingUserQuestion ? 1 : 0,
		bashSensitiveCommand ? 1 : 0,
		terminalExecutionState.state.needsInput ? 1 : 0,
	].join('|');

	const layoutKey = [
		contentWidth,
		showThinking ? 1 : 0,
		toolDisplayMode,
		thinkDisplayMode,
		remountKey,
	].join('|');

	const compactHeader = simpleMode || terminalHeight < FULL_HEADER_MIN_ROWS;

	const liveContent = (
		<Box flexDirection="column" width={contentWidth}>
			<Box paddingX={1} width={contentWidth}>
				<PendingMessages pendingMessages={pendingMessages} />
			</Box>

			{hookStatus && (
				<Box paddingX={1} width={contentWidth} marginBottom={1}>
					<HookStatusDisplay status={hookStatus} />
				</Box>
			)}

			{hookError && (
				<Box paddingX={1} width={contentWidth} marginBottom={1}>
					<HookErrorDisplay details={hookError} />
				</Box>
			)}

			{compressionStatus && (
				<Box paddingX={1} width={contentWidth} marginBottom={1}>
					<CompressionStatus
						status={compressionStatus}
						terminalWidth={contentWidth}
					/>
				</Box>
			)}

			{/* 当同时存在工具确认和交互问题时，优先显示交互组件（AskUserQuestion）*/}
			{pendingToolConfirmation && !pendingUserQuestion && (
				<ToolConfirmation
					toolName={
						pendingToolConfirmation.batchToolNames ||
						pendingToolConfirmation.tool.function.name
					}
					toolArguments={
						!pendingToolConfirmation.allTools
							? pendingToolConfirmation.tool.function.arguments
							: undefined
					}
					allTools={pendingToolConfirmation.allTools}
					onConfirm={pendingToolConfirmation.resolve}
					onHookError={error => {
						setHookError(error);
					}}
				/>
			)}

			{bashSensitiveCommand && (
				<Box paddingX={1} width={contentWidth}>
					<BashCommandConfirmation
						command={bashSensitiveCommand.command}
						onConfirm={bashSensitiveCommand.resolve}
						terminalWidth={contentWidth}
					/>
				</Box>
			)}

			{bashMode.state.isExecuting && bashMode.state.currentCommand && (
				<Box paddingX={1} width={contentWidth}>
					<BashCommandExecutionStatus
						command={bashMode.state.currentCommand}
						timeout={bashMode.state.currentTimeout || 30000}
						terminalWidth={contentWidth}
						output={bashMode.state.output}
					/>
				</Box>
			)}

			{customCommandExecution && (
				<Box paddingX={1} width={contentWidth}>
					<CustomCommandExecutionDisplay
						command={customCommandExecution.command}
						commandName={customCommandExecution.commandName}
						isRunning={customCommandExecution.isRunning}
						output={customCommandExecution.output}
						exitCode={customCommandExecution.exitCode}
						error={customCommandExecution.error}
					/>
				</Box>
			)}

			{terminalExecutionState.state.isExecuting &&
				!terminalExecutionState.state.isBackgrounded &&
				terminalExecutionState.state.command && (
					<Box paddingX={1} width={contentWidth}>
						<BashCommandExecutionStatus
							command={terminalExecutionState.state.command}
							timeout={terminalExecutionState.state.timeout || 30000}
							terminalWidth={contentWidth}
							output={terminalExecutionState.state.output}
							needsInput={terminalExecutionState.state.needsInput}
							inputPrompt={terminalExecutionState.state.inputPrompt}
						/>
					</Box>
				)}

			{schedulerExecutionState?.state?.isRunning &&
				schedulerExecutionState?.state?.description && (
					<Box paddingX={1} width={contentWidth}>
						<SchedulerCountdown
							description={schedulerExecutionState.state.description}
							totalDuration={schedulerExecutionState.state.totalDuration}
							remainingSeconds={schedulerExecutionState.state.remainingSeconds}
							terminalWidth={contentWidth}
						/>
					</Box>
				)}

			{pendingUserQuestion && (
				<AskUserQuestion
					question={pendingUserQuestion.question}
					options={pendingUserQuestion.options}
					multiSelect={pendingUserQuestion.multiSelect}
					onAnswer={handleUserQuestionAnswer}
				/>
			)}
		</Box>
	);

	if (!fullscreen) {
		// Classic inline mode: completed messages are flushed once into the
		// terminal scrollback through <Static>; only live content re-renders.
		return (
			<>
				<Static
					key={remountKey}
					items={[
						<ChatHeader
							key="header"
							terminalWidth={terminalWidth}
							simpleMode={simpleMode}
							workingDirectory={workingDirectory}
						/>,
						...staticMessages.map((message, index) => (
							<MessageRenderer
								key={`msg-${index}`}
								message={message}
								terminalWidth={terminalWidth}
								isFirstInGroup={isFirstInGroup[index]}
								isLastInGroup={isLastInGroup[index]}
								showThinking={showThinking}
								toolDisplayMode={toolDisplayMode}
								thinkDisplayMode={thinkDisplayMode}
							/>
						)),
					]}
				>
					{item => item}
				</Static>
				{liveContent}
			</>
		);
	}

	return (
		<Box
			flexDirection="column"
			flexGrow={1}
			flexShrink={1}
			flexBasis={0}
			width={terminalWidth}
			overflow="hidden"
		>
			{/* Fixed title area: never scrolls away. */}
			<Box flexShrink={0} width={terminalWidth}>
				<ChatHeader
					key={`header-${remountKey}`}
					terminalWidth={terminalWidth}
					simpleMode={compactHeader}
					workingDirectory={workingDirectory}
				/>
			</Box>

			{/* Conversation: virtualized, scrolls between header and input. */}
			<VirtualScrollView
				items={staticMessages}
				renderItem={renderMessage}
				estimateItemHeight={estimateHeight}
				width={terminalWidth}
				layoutKey={layoutKey}
				footer={liveContent}
				stickToBottomKey={stickToBottomKey}
				keyboardActive={scrollKeyboardActive}
				thumbColor={theme.colors.menuInfo}
				trackColor={theme.colors.menuSecondary}
			/>
		</Box>
	);
}
