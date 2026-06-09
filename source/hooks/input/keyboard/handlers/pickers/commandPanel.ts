import {executeCommand} from '../../../../../utils/execution/commandExecutor.js';
import {commandUsageManager} from '../../../../../utils/session/commandUsageManager.js';
import {getCommandArgsOptions} from '../../../../ui/useCommandPanel.js';
import {
	findInlineCommandTrigger,
	isInlineExecutableCommand,
	isInlinePickerCommand,
	isInlineTextInsertionCommand,
} from '../../utils/inlineCommandTrigger.js';
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
		openGitLinePicker,
		isProcessing,
		getAllCommands,
		onCommand,

		triggerUpdate,
	} = options;

	if (!showCommands) return false;
	const filteredCommands = getFilteredCommands();
	const inlineTrigger = findInlineCommandTrigger(
		buffer.text,
		buffer.getCursorPosition(),
	);
	const isInlineTrigger = inlineTrigger !== null && !inlineTrigger.isAtStart;

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
				if (inlineTrigger) {
					const inlineInsertionText =
						!inlineTrigger.isAtStart &&
						isInlineTextInsertionCommand(selectedCommand)
							? selectedCommand.insertionText
							: undefined;
					buffer.replaceRange(
						inlineTrigger.slashIndex,
						inlineTrigger.endIndex,
						inlineInsertionText ?? '/' + selectedCommand.name,
					);
				} else {
					buffer.setText('/' + selectedCommand.name);
					buffer.setCursorPosition(buffer.text.length);
				}
				setShowCommands(false);
				setCommandSelectedIndex(0);
				const cmdArgsOptions = getCommandArgsOptions(
					selectedCommand.name,
					buffer.text,
				);
				const shouldOpenArgsPicker = cmdArgsOptions.length > 0;
				if (shouldOpenArgsPicker) {
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
				if (isInlineTrigger) {
					if (isInlinePickerCommand(selectedCommand) && inlineTrigger) {
						setShowCommands(false);
						setCommandSelectedIndex(0);
						openGitLinePicker({
							start: inlineTrigger.slashIndex,
							end: inlineTrigger.endIndex,
						});
						triggerUpdate();
						return true;
					}

					if (isInlineExecutableCommand(selectedCommand) && inlineTrigger) {
						buffer.replaceRange(
							inlineTrigger.slashIndex,
							inlineTrigger.endIndex,
							'',
						);
						setShowCommands(false);
						setCommandSelectedIndex(0);
						executeCommand(selectedCommand.name).then(result => {
							commandUsageManager.recordUsage(selectedCommand.name);
							if (onCommand) {
								Promise.resolve(onCommand(selectedCommand.name, result)).catch(
									error => {
										console.error('Command execution error:', error);
									},
								);
							}
						});
						triggerUpdate();
						return true;
					}

					if (isInlineTextInsertionCommand(selectedCommand) && inlineTrigger) {
						buffer.replaceRange(
							inlineTrigger.slashIndex,
							inlineTrigger.endIndex,
							selectedCommand.insertionText ?? '',
						);
						setShowCommands(false);
						setCommandSelectedIndex(0);
						commandUsageManager.recordUsage(selectedCommand.name);
						triggerUpdate();
						return true;
					}

					return false;
				}

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
					openGitLinePicker();
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
				// 使用 [\s\S] 而不是 . 让参数可以跨多行（如 /goal 多行需求）。
				const fullText = buffer.getFullText();
				const commandMatch = fullText.match(/^\/(\S+)(?:\s+([\s\S]+))?$/);
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
