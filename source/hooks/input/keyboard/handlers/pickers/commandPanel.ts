import {executeCommand} from '../../../../../utils/execution/commandExecutor.js';
import {commandUsageManager} from '../../../../../utils/session/commandUsageManager.js';
import {COMMAND_ARGS_OPTIONS} from '../../../../ui/useCommandPanel.js';
import type {HandlerContext} from '../../types.js';

export function commandPanelHandler(ctx: HandlerContext): boolean {
	const {key, buffer, options} = ctx;
	const {
		showCommands,
		getFilteredCommands,
		commandSelectedIndex,
		setCommandSelectedIndex,
		setShowCommands,
		setShowArgsPicker,
		setArgsSelectedIndex,
		setShowTodoPicker,
		setShowAgentPicker,
		setShowSkillsPicker,
		setShowGitLinePicker,
		isProcessing,
		getAllCommands,
		onCommand,
		triggerUpdate,
	} = options;

	if (!showCommands) return false;
	const filteredCommands = getFilteredCommands();

	// Up arrow in command panel - 循环导航:第一项 → 最后一项
	if (key.upArrow) {
		setCommandSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, filteredCommands.length - 1),
		);
		return true;
	}

	// Down arrow in command panel - 循环导航:最后一项 → 第一项
	if (key.downArrow) {
		const maxIndex = Math.max(0, filteredCommands.length - 1);
		setCommandSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Tab - autocomplete command to input
	if (key.tab) {
		if (
			filteredCommands.length > 0 &&
			commandSelectedIndex < filteredCommands.length
		) {
			const selectedCommand = filteredCommands[commandSelectedIndex];
			if (selectedCommand) {
				buffer.setText('/' + selectedCommand.name);
				buffer.setCursorPosition(buffer.text.length);
				setShowCommands(false);
				setCommandSelectedIndex(0);
				const cmdArgsOptions = COMMAND_ARGS_OPTIONS[selectedCommand.name];
				if (cmdArgsOptions && cmdArgsOptions.length > 0) {
					setShowArgsPicker(true);
					setArgsSelectedIndex(0);
				}
				triggerUpdate();
				return true;
			}
		}
		return true;
	}

	// Enter - select command
	if (key.return) {
		if (
			filteredCommands.length > 0 &&
			commandSelectedIndex < filteredCommands.length
		) {
			const selectedCommand = filteredCommands[commandSelectedIndex];
			if (selectedCommand) {
				// Special handling for todo- command
				if (selectedCommand.name === 'todo-') {
					buffer.setText('');
					setShowCommands(false);
					setCommandSelectedIndex(0);
					setShowTodoPicker(true);
					triggerUpdate();
					return true;
				}
				// Special handling for agent- command
				if (selectedCommand.name === 'agent-') {
					buffer.setText('');
					setShowCommands(false);
					setCommandSelectedIndex(0);
					setShowAgentPicker(true);
					triggerUpdate();
					return true;
				}
				// Special handling for skills- command
				if (selectedCommand.name === 'skills-') {
					buffer.setText('');
					setShowCommands(false);
					setCommandSelectedIndex(0);
					setShowSkillsPicker(true);
					triggerUpdate();
					return true;
				}
				if (selectedCommand.name === 'gitline') {
					buffer.setText('');
					setShowCommands(false);
					setCommandSelectedIndex(0);
					setShowGitLinePicker(true);
					triggerUpdate();
					return true;
				}
				// Block command execution if AI is processing

				if (isProcessing && getAllCommands) {
					const matchedCommand = getAllCommands().find(
						cmd => cmd.name === selectedCommand.name,
					);
					if (matchedCommand && matchedCommand.type !== 'prompt') {
						// Keep non-prompt commands blocked while AI is already processing.
						buffer.setText('');
						setShowCommands(false);
						setCommandSelectedIndex(0);
						triggerUpdate();
						return true;
					}
				}

				// Execute command instead of inserting text
				// If the user has typed args after the command name (e.g. "/role -l"),
				// pass them through so sub-commands work from the command panel.
				const fullText = buffer.getFullText();
				const commandMatch = fullText.match(/^\/([^\s]+)(?:\s+(.+))?$/);
				const commandArgs = commandMatch?.[2];
				executeCommand(selectedCommand.name, commandArgs).then(result => {
					// Record command usage for frequency-based sorting
					commandUsageManager.recordUsage(selectedCommand.name);
					if (onCommand) {
						// Ensure onCommand errors are caught
						Promise.resolve(onCommand(selectedCommand.name, result)).catch(
							error => {
								console.error('Command execution error:', error);
							},
						);
					}
				});
				buffer.setText('');
				setShowCommands(false);
				setCommandSelectedIndex(0);
				triggerUpdate();
				return true;
			}
		}
		// If no commands available, fall through to normal Enter handling
		return false;
	}

	// Other keys (regular characters) must fall through so they're inserted
	// into the buffer and updateCommandPanelState can re-filter the panel.
	return false;
}
