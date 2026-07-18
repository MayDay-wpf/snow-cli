import {setPickerActive} from '../../../../utils/ui/pickerState.js';
import type {HandlerContext} from '../types.js';

export function escapeHandler(ctx: HandlerContext): boolean {
	const {key, buffer, options, helpers} = ctx;
	const {
		showArgsPicker,
		setShowArgsPicker,
		setArgsSelectedIndex,
		showProfilePicker,
		setShowProfilePicker,
		setProfileSelectedIndex,
		setProfileSearchQuery,
		showSkillsPicker,
		closeSkillsPicker,
		showGitLinePicker,
		closeGitLinePicker,
		showRunningAgentsPicker,
		closeRunningAgentsPicker,
		showTodoPicker,
		setShowTodoPicker,
		setTodoSelectedIndex,
		showAgentPicker,
		setShowAgentPicker,
		setAgentSelectedIndex,
		showFilePicker,
		setShowFilePicker,
		setFileSelectedIndex,
		setFileQuery,
		setAtSymbolPosition,
		showCommands,
		setShowCommands,
		setCommandSelectedIndex,
		showHistoryMenu,
		setShowHistoryMenu,
		setHistorySelectedIndex,
		escapeKeyCount,
		setEscapeKeyCount,
		escapeKeyTimer,
		getUserMessages,
	} = options;

	if (!key.escape) return false;

	if (showArgsPicker) {
		setShowArgsPicker(false);
		setArgsSelectedIndex(0);
		setPickerActive(true);
		return true;
	}

	if (showProfilePicker) {
		setShowProfilePicker(false);
		setProfileSelectedIndex(0);
		setProfileSearchQuery('');
		setPickerActive(true);
		return true;
	}

	if (showSkillsPicker) {
		closeSkillsPicker();
		setPickerActive(true);
		return true;
	}

	if (showGitLinePicker) {
		closeGitLinePicker();
		setPickerActive(true);
		return true;
	}

	if (showRunningAgentsPicker) {
		closeRunningAgentsPicker();
		setPickerActive(true);
		return true;
	}

	if (showTodoPicker) {
		setShowTodoPicker(false);
		setTodoSelectedIndex(0);
		setPickerActive(true);
		return true;
	}

	if (showAgentPicker) {
		setShowAgentPicker(false);
		setAgentSelectedIndex(0);
		setPickerActive(true);
		return true;
	}

	if (showFilePicker) {
		setShowFilePicker(false);
		setFileSelectedIndex(0);
		setFileQuery('');
		setAtSymbolPosition(-1);
		setPickerActive(true);
		return true;
	}

	if (showCommands) {
		setShowCommands(false);
		setCommandSelectedIndex(0);
		setPickerActive(true);
		return true;
	}

	setPickerActive(false);

	if (showHistoryMenu) {
		setShowHistoryMenu(false);
		return true;
	}

	setEscapeKeyCount(prev => prev + 1);

	if (escapeKeyTimer.current) {
		clearTimeout(escapeKeyTimer.current);
	}

	escapeKeyTimer.current = setTimeout(() => {
		setEscapeKeyCount(0);
	}, 500);

	if (escapeKeyCount >= 1) {
		setEscapeKeyCount(0);
		if (escapeKeyTimer.current) {
			clearTimeout(escapeKeyTimer.current);
			escapeKeyTimer.current = null;
		}

		const text = buffer.getFullText();
		if (text.trim().length > 0) {
			buffer.setText('');
			helpers.forceStateUpdate();
		} else {
			const userMessages = getUserMessages();
			if (userMessages.length > 0) {
				setShowHistoryMenu(true);
				setHistorySelectedIndex(userMessages.length - 1);
			}
		}
	}
	return true;
}
