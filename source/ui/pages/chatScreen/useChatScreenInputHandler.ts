import type {Dispatch, SetStateAction} from 'react';
import {useInput} from 'ink';
import {
	isPickerActive,
	setPickerActive,
} from '../../../utils/ui/pickerState.js';
import type {BackgroundProcess} from '../../../hooks/execution/useBackgroundProcesses.js';
import type {PendingConfirmation} from '../../../hooks/conversation/useToolConfirmation.js';
import type {HookErrorDetails} from '../../../utils/execution/hookResultHandler.js';
import type {
	BashSensitiveCommandState,
	PendingUserQuestionState,
} from './types.js';

type InputKey = {
	escape: boolean;
	ctrl: boolean;
	upArrow?: boolean;
	downArrow?: boolean;
	return?: boolean;
};

type BackgroundProcessesState = {
	showPanel: boolean;
	killProcess: (id: string) => void;
	hidePanel: () => void;
};

type Options = {
	backgroundProcesses: BackgroundProcessesState;
	sortedBackgroundProcesses: BackgroundProcess[];
	selectedProcessIndex: number;
	setSelectedProcessIndex: Dispatch<SetStateAction<number>>;
	terminalExecutionState: any;
	pendingToolConfirmation: PendingConfirmation | null;
	pendingUserQuestion: PendingUserQuestionState;
	bashSensitiveCommand: BashSensitiveCommandState;
	setBashSensitiveCommand: Dispatch<SetStateAction<BashSensitiveCommandState>>;
	hookError: HookErrorDetails | null;
	setHookError: Dispatch<SetStateAction<HookErrorDetails | null>>;
	snapshotState: any;
	panelState: {handleEscapeKey: () => boolean};
	handleEscKey: (key: InputKey, input: string) => boolean;
};

export function useChatScreenInputHandler({
	backgroundProcesses,
	sortedBackgroundProcesses,
	selectedProcessIndex,
	setSelectedProcessIndex,
	terminalExecutionState,
	pendingToolConfirmation,
	pendingUserQuestion,
	bashSensitiveCommand,
	setBashSensitiveCommand,
	hookError,
	setHookError,
	snapshotState,
	panelState,
	handleEscKey,
}: Options) {
	useInput((input, key) => {
		if (backgroundProcesses.showPanel) {
			if (key.escape) {
				backgroundProcesses.hidePanel();
				return;
			}

			if (sortedBackgroundProcesses.length > 0) {
				if (key.upArrow) {
					setSelectedProcessIndex(prev =>
						prev > 0 ? prev - 1 : sortedBackgroundProcesses.length - 1,
					);
					return;
				}

				if (key.downArrow) {
					setSelectedProcessIndex(prev =>
						prev < sortedBackgroundProcesses.length - 1 ? prev + 1 : 0,
					);
					return;
				}

				if (key.return) {
					const selectedProcess =
						sortedBackgroundProcesses[selectedProcessIndex];
					if (selectedProcess && selectedProcess.status === 'running') {
						backgroundProcesses.killProcess(selectedProcess.id);
					}
					return;
				}
			}
		}

		if (
			key.ctrl &&
			input === 'b' &&
			terminalExecutionState.state.isExecuting &&
			!terminalExecutionState.state.isBackgrounded
		) {
			Promise.all([
				import('../../../mcp/bash.js'),
				import('../../../hooks/execution/useBackgroundProcesses.js'),
			]).then(([{markCommandAsBackgrounded}, {showBackgroundPanel}]) => {
				markCommandAsBackgrounded();
				showBackgroundPanel();
			});
			terminalExecutionState.moveToBackground();
			return;
		}

		if (pendingToolConfirmation || pendingUserQuestion) {
			return;
		}

		if (bashSensitiveCommand) {
			if (input.toLowerCase() === 'y') {
				bashSensitiveCommand.resolve(true);
				setBashSensitiveCommand(null);
			} else if (input.toLowerCase() === 'n' || key.escape) {
				bashSensitiveCommand.resolve(false);
				setBashSensitiveCommand(null);
			}
			return;
		}

		if (hookError && key.escape) {
			setHookError(null);
			return;
		}

		if (snapshotState.pendingRollback) {
			if (key.escape) {
				snapshotState.setPendingRollback(null);
			}
			return;
		}

		if (key.escape && panelState.handleEscapeKey()) {
			return;
		}

		if (key.escape && isPickerActive()) {
			setPickerActive(false);
			return;
		}

		if (handleEscKey(key, input)) {
			return;
		}
	});
}
