import {executeCommand} from '../../../../utils/execution/commandExecutor.js';
import {commandUsageManager} from '../../../../utils/session/commandUsageManager.js';
import type {HandlerContext} from '../types.js';

export function submitHandler(ctx: HandlerContext): boolean {
	const {key, buffer, options, refs, helpers} = ctx;
	const {
		updateCommandPanelState,
		updateFilePickerState,
		updateAgentPickerState,
		updateRunningAgentsPickerState,
		currentHistoryIndex,
		resetHistoryNavigation,
		isProcessing,
		getAllCommands,
		setShowCommands,
		setCommandSelectedIndex,
		setShowTodoPicker,
		setShowAgentPicker,
		setShowSkillsPicker,
		setShowGitLinePicker,
		onCommand,
		saveToHistory,
		onSubmit,
		triggerUpdate,
		forceUpdate,
	} = options;

	if (!key.return) return false;
	helpers.flushPendingInput();
	// Prevent submission if multi-char input (paste/IME) is still being processed
	if (refs.isProcessingInput.current) {
		return true; // Ignore Enter key while processing
	}

	// Check if we should insert newline instead of submitting
	// Condition: If text ends with '/' and there's non-whitespace content before it
	const fullText = buffer.getFullText();
	const cursorPos = buffer.getCursorPosition();

	// Check if cursor is right after a '/' character
	if (cursorPos > 0 && fullText[cursorPos - 1] === '/') {
		// Find the text before '/' (ignoring the '/' itself)
		const textBeforeSlash = fullText.slice(0, cursorPos - 1);

		// If there's any non-whitespace content before '/', insert newline
		// This prevents conflict with command panel trigger at line start
		if (textBeforeSlash.trim().length > 0) {
			buffer.insert('\n');
			const text = buffer.getFullText();
			const newCursorPos = buffer.getCursorPosition();
			updateCommandPanelState(text);
			updateFilePickerState(text, newCursorPos);
			updateAgentPickerState(text, newCursorPos);
			updateRunningAgentsPickerState(text, newCursorPos);
			return true;
		}
	}

	// Reset history navigation on submit
	if (currentHistoryIndex !== -1) {
		resetHistoryNavigation();
	}

	const message = buffer.getFullText().trim();
	const markedMessage = buffer.hasTextPlaceholders()
		? buffer.getFullTextWithPasteMarkers().trim()
		: message;
	if (message) {
		// Check if message is a command with arguments (e.g., /review [note])
		if (message.startsWith('/')) {
			// Support namespaced slash commands like /folder:command
			const commandMatch = message.match(/^\/([^\s]+)(?:\s+(.+))?$/);
			if (commandMatch && commandMatch[1]) {
				const commandName = commandMatch[1];
				const commandArgs = commandMatch[2];

				// Special handling for picker-style commands.
				// These commands are UI interactions and should open the picker panel
				// instead of going through the generic command execution flow.
				if (commandName === 'todo-' && !commandArgs) {
					buffer.setText('');
					setShowCommands(false);
					setCommandSelectedIndex(0);
					setShowTodoPicker(true);
					triggerUpdate();
					return true;
				}
				if (commandName === 'agent-' && !commandArgs) {
					buffer.setText('');
					setShowCommands(false);
					setCommandSelectedIndex(0);
					setShowAgentPicker(true);
					triggerUpdate();
					return true;
				}
				if (commandName === 'skills-' && !commandArgs) {
					buffer.setText('');
					setShowCommands(false);
					setCommandSelectedIndex(0);
					setShowSkillsPicker(true);
					triggerUpdate();
					return true;
				}
				if (commandName === 'gitline' && !commandArgs) {
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
						cmd => cmd.name === commandName,
					);
					if (matchedCommand && matchedCommand.type !== 'prompt') {
						// Keep non-prompt commands blocked while AI is already processing.
						buffer.setText('');
						triggerUpdate();
						return true;
					}
				}

				// Execute command with arguments
				executeCommand(commandName, commandArgs).then(result => {
					// If command is unknown, send the original message as a normal message
					if (result.action === 'sendAsMessage') {
						// Get images data for the message
						const currentText = buffer.text;
						const allImages = buffer.getImages();
						const validImages = allImages
							.filter(img => currentText.includes(img.placeholder))
							.map(img => ({
								data: img.data,
								mimeType: img.mimeType,
							}));

						// Save to persistent history
						saveToHistory(message);

						// Send as normal message (use marked version to preserve paste boundaries)
						onSubmit(
							markedMessage,
							validImages.length > 0 ? validImages : undefined,
						);
						return;
					}

					// Record command usage for frequency-based sorting
					commandUsageManager.recordUsage(commandName);
					if (onCommand) {
						// Ensure onCommand errors are caught
						Promise.resolve(onCommand(commandName, result)).catch(error => {
							console.error('Command execution error:', error);
						});
					}
				});

				buffer.setText('');
				setShowCommands(false);
				setCommandSelectedIndex(0);
				triggerUpdate();
				return true;
			}
		}

		// Get images data, but only include images whose placeholders still exist
		const currentText = buffer.text; // Use internal text (includes placeholders)
		const allImages = buffer.getImages();
		const validImages = allImages
			.filter(img => currentText.includes(img.placeholder))
			.map(img => ({
				data: img.data,
				mimeType: img.mimeType,
			}));

		buffer.setText('');
		forceUpdate({});

		// Save to persistent history
		saveToHistory(message);

		onSubmit(
			markedMessage,
			validImages.length > 0 ? validImages : undefined,
		);
	}
	return true;
}
