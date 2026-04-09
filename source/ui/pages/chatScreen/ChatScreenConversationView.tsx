import React from 'react';
import {Box, Static} from 'ink';
import type {Message} from '../../components/chat/MessageList.js';
import PendingMessages from '../../components/chat/PendingMessages.js';
import ToolConfirmation from '../../components/tools/ToolConfirmation.js';
import AskUserQuestion from '../../components/special/AskUserQuestion.js';
import {
	BashCommandConfirmation,
	BashCommandExecutionStatus,
} from '../../components/bash/BashCommandConfirmation.js';
import {CustomCommandExecutionDisplay} from '../../components/bash/CustomCommandExecutionDisplay.js';
import {SchedulerCountdown} from '../../components/scheduler/SchedulerCountdown.js';
import MessageRenderer from '../../components/chat/MessageRenderer.js';
import ChatHeader from '../../components/special/ChatHeader.js';
import {HookErrorDisplay} from '../../components/special/HookErrorDisplay.js';
import {CompressionStatus} from '../../components/compression/CompressionStatus.js';
import type {CompressionStatus as CompressionStatusType} from '../../components/compression/CompressionStatus.js';
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
	pendingMessages: PendingMessageInput[];
	pendingToolConfirmation: any;
	pendingUserQuestion: PendingUserQuestionState;
	bashSensitiveCommand: BashSensitiveCommandState;
	terminalExecutionState: any;
	schedulerExecutionState: any;
	customCommandExecution: CustomCommandExecutionState;
	bashMode: any;
	hookError: HookErrorDetails | null;
	handleUserQuestionAnswer: (result: any) => void;
	setHookError: React.Dispatch<React.SetStateAction<HookErrorDetails | null>>;
	compressionStatus: CompressionStatusType | null;
};

export default function ChatScreenConversationView({
	remountKey,
	terminalWidth,
	workingDirectory,
	simpleMode,
	messages,
	showThinking,
	pendingMessages,
	pendingToolConfirmation,
	pendingUserQuestion,
	bashSensitiveCommand,
	terminalExecutionState,
	schedulerExecutionState,
	customCommandExecution,
	bashMode,
	hookError,
	handleUserQuestionAnswer,
	setHookError,
	compressionStatus,
}: Props) {
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
					...messages
						.filter(m => !m.streaming)
						.map((message, index, filteredMessages) => (
							<MessageRenderer
								key={`msg-${index}`}
								message={message}
								index={index}
								filteredMessages={filteredMessages}
								terminalWidth={terminalWidth}
								showThinking={showThinking}
							/>
						)),
				]}
			>
				{item => item}
			</Static>

			<Box paddingX={1} width={terminalWidth}>
				<PendingMessages pendingMessages={pendingMessages} />
			</Box>

			{hookError && (
				<Box paddingX={1} width={terminalWidth} marginBottom={1}>
					<HookErrorDisplay details={hookError} />
				</Box>
			)}

			{compressionStatus && (
				<Box paddingX={1} width={terminalWidth} marginBottom={1}>
					<CompressionStatus
						status={compressionStatus}
						terminalWidth={terminalWidth}
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
				<Box paddingX={1} width={terminalWidth}>
					<BashCommandConfirmation
						command={bashSensitiveCommand.command}
						onConfirm={bashSensitiveCommand.resolve}
						terminalWidth={terminalWidth}
					/>
				</Box>
			)}

			{bashMode.state.isExecuting && bashMode.state.currentCommand && (
				<Box paddingX={1} width={terminalWidth}>
					<BashCommandExecutionStatus
						command={bashMode.state.currentCommand}
						timeout={bashMode.state.currentTimeout || 30000}
						terminalWidth={terminalWidth}
						output={bashMode.state.output}
					/>
				</Box>
			)}

			{customCommandExecution && (
				<Box paddingX={1} width={terminalWidth}>
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
					<Box paddingX={1} width={terminalWidth}>
						<BashCommandExecutionStatus
							command={terminalExecutionState.state.command}
							timeout={terminalExecutionState.state.timeout || 30000}
							terminalWidth={terminalWidth}
							output={terminalExecutionState.state.output}
							needsInput={terminalExecutionState.state.needsInput}
							inputPrompt={terminalExecutionState.state.inputPrompt}
						/>
					</Box>
				)}

			{schedulerExecutionState?.state?.isRunning &&
				schedulerExecutionState?.state?.description && (
					<Box paddingX={1} width={terminalWidth}>
						<SchedulerCountdown
							description={schedulerExecutionState.state.description}
							totalDuration={schedulerExecutionState.state.totalDuration}
							remainingSeconds={schedulerExecutionState.state.remainingSeconds}
							terminalWidth={terminalWidth}
						/>
					</Box>
				)}

			{pendingUserQuestion && (
				<AskUserQuestion
					question={pendingUserQuestion.question}
					options={pendingUserQuestion.options}
					onAnswer={handleUserQuestionAnswer}
				/>
			)}
		</>
	);
}
