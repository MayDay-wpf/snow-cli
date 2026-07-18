import {useRef, useEffect} from 'react';
import {useInput, useStdin} from 'ink';
import type {HandlerContext, HandlerRefs, KeyboardInputOptions} from './keyboard/types.js';
import {createHelpers} from './keyboard/context.js';
import {focusFilterHandler} from './keyboard/handlers/focusFilter.js';
import {modeToggleHandler} from './keyboard/handlers/modeToggle.js';
import {profileShortcutHandler} from './keyboard/handlers/profileShortcut.js';
import {newlineHandler} from './keyboard/handlers/newline.js';
import {escapeHandler} from './keyboard/handlers/escape.js';
import {argsPickerHandler} from './keyboard/handlers/pickers/argsPicker.js';
import {skillsPickerHandler} from './keyboard/handlers/pickers/skillsPicker.js';
import {gitLinePickerHandler} from './keyboard/handlers/pickers/gitLinePicker.js';
import {profilePickerHandler} from './keyboard/handlers/pickers/profilePicker.js';
import {runningAgentsPickerHandler} from './keyboard/handlers/pickers/runningAgentsPicker.js';
import {todoPickerHandler} from './keyboard/handlers/pickers/todoPicker.js';
import {agentPickerHandler} from './keyboard/handlers/pickers/agentPicker.js';
import {historyMenuHandler} from './keyboard/handlers/pickers/historyMenu.js';
import {editingHandler} from './keyboard/handlers/editing.js';
import {clipboardHandler} from './keyboard/handlers/clipboard.js';
import {deleteAndBackspaceHandler} from './keyboard/handlers/deleteAndBackspace.js';
import {filePickerHandler} from './keyboard/handlers/pickers/filePicker.js';
import {commandPanelHandler} from './keyboard/handlers/pickers/commandPanel.js';
import {tabArgsPickerHandler} from './keyboard/handlers/tabArgsPicker.js';
import {submitHandler} from './keyboard/handlers/submit.js';
import {arrowKeysHandler} from './keyboard/handlers/arrowKeys.js';
import {regularInputHandler} from './keyboard/handlers/regularInput.js';

export type {KeyboardInputOptions} from './keyboard/types.js';

export function useKeyboardInput(options: KeyboardInputOptions) {
	const {disabled} = options;

	// Track paste detection
	const inputBuffer = useRef<string>('');
	const inputTimer = useRef<NodeJS.Timeout | null>(null);
	const isPasting = useRef<boolean>(false); // Track if we're in pasting mode
	const inputStartCursorPos = useRef<number>(0); // Track cursor position when input starts accumulating
	const isProcessingInput = useRef<boolean>(false); // Track if multi-char input is being processed
	const inputSessionId = useRef<number>(0); // Invalidates stale buffered input timers
	const lastPasteShortcutAt = useRef<number>(0); // Track recent paste shortcut usage
	const componentMountTime = useRef<number>(Date.now()); // Track when component mounted

	// Cleanup timer on unmount
	useEffect(() => {
		return () => {
			if (inputTimer.current) {
				clearTimeout(inputTimer.current);
			}
		};
	}, []);

	// Track if Delete key was pressed (detected via Ink's internal event emitter)
	const deleteKeyPressed = useRef<boolean>(false);

	// Access Ink's internal event emitter to detect Delete key (escape sequence \x1b[3~)
	// ink's useInput doesn't distinguish between Backspace and Delete.
	// We must NOT use process.stdin.on('data', ...) directly, as adding a 'data' listener
	// switches stdin to flowing mode, conflicting with Ink's readable-event-based handling.
	const stdinContext = useStdin() as {
		internal_eventEmitter?: import('events').EventEmitter;
	};
	const {internal_eventEmitter: inkEventEmitter} = stdinContext;

	useEffect(() => {
		if (!inkEventEmitter) return;

		const handleRawInput = (data: string) => {
			if (data === '\x1b[3~') {
				deleteKeyPressed.current = true;
			}
		};

		inkEventEmitter.on('input', handleRawInput);
		return () => {
			inkEventEmitter.removeListener('input', handleRawInput);
		};
	}, [inkEventEmitter]);

	const refs: HandlerRefs = {
		inputBuffer,
		inputTimer,
		isPasting,
		inputStartCursorPos,
		isProcessingInput,
		inputSessionId,
		lastPasteShortcutAt,
		componentMountTime,
		deleteKeyPressed,
	};

	// Handle input using useInput hook
	useInput((input, key) => {
		if (disabled) return;

		const helpers = createHelpers(options.buffer, options, refs);
		const ctx: HandlerContext = {
			input,
			key,
			buffer: options.buffer,
			options,
			refs,
			helpers,
		};

		// Order matches the original file 100% — do not reorder.
		if (focusFilterHandler(ctx)) return;
		if (modeToggleHandler(ctx)) return;
		if (profileShortcutHandler(ctx)) return;
		if (newlineHandler(ctx)) return;
		if (escapeHandler(ctx)) return;
		if (argsPickerHandler(ctx)) return;
		if (skillsPickerHandler(ctx)) return;
		if (gitLinePickerHandler(ctx)) return;
		if (profilePickerHandler(ctx)) return;
		if (runningAgentsPickerHandler(ctx)) return;
		if (todoPickerHandler(ctx)) return;
		if (agentPickerHandler(ctx)) return;
		if (historyMenuHandler(ctx)) return;
		if (editingHandler(ctx)) return;
		if (clipboardHandler(ctx)) return;
		if (deleteAndBackspaceHandler(ctx)) return;
		if (filePickerHandler(ctx)) return;
		if (commandPanelHandler(ctx)) return;
		if (tabArgsPickerHandler(ctx)) return;
		if (submitHandler(ctx)) return;
		if (arrowKeysHandler(ctx)) return;
		if (regularInputHandler(ctx)) return;
	});
}
