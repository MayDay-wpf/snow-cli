import type {HandlerContext} from '../../types.js';

/**
 * Keyboard handler for Sub-Agent Detail TUI.
 * Priority: before runningAgentsPicker and normal input.
 *
 * Keys:
 *  Esc       - exit detail view
 *  Tab       - toggle focus (timeline ↔ input)
 *  ↑/↓       - scroll timeline when focused; otherwise ignored in input
 *  Enter     - send message when input focused / non-empty
 *  x / Ctrl+X - abort/stop running agent (history view ignored)
 *  1-9       - switch among running agents
 *  Backspace - edit detail input
 *  printable - append to detail input when input focused
 */
export function subAgentDetailHandler(ctx: HandlerContext): boolean {
	const {input, key, options, helpers} = ctx;
	const {
		showSubAgentDetail,
		detailFocus,
		closeSubAgentDetail,
		toggleDetailFocus,
		scrollDetailTimeline,
		appendDetailInput,
		backspaceDetailInput,
		sendDetailMessage,
		setDetailFocus,
		switchDetailAgentByIndex,
		abortDetailAgent,
	} = options;

	if (!showSubAgentDetail) return false;

	// Esc - leave detail
	if (key.escape) {
		closeSubAgentDetail();
		helpers.forceStateUpdate();
		return true;
	}

	// Tab - switch focus between timeline and input
	if (key.tab) {
		toggleDetailFocus();
		helpers.forceStateUpdate();
		return true;
	}

	// Arrow up/down - scroll timeline (always useful; also works while typing)
	if (key.upArrow) {
		scrollDetailTimeline(-1);
		helpers.forceStateUpdate();
		return true;
	}
	if (key.downArrow) {
		scrollDetailTimeline(1);
		helpers.forceStateUpdate();
		return true;
	}

	// Abort/stop running agent: x when not typing, or Ctrl+X anytime in detail
	if (
		(key.ctrl && (input === 'x' || input === 'X')) ||
		((input === 'x' || input === 'X') &&
			detailFocus === 'timeline' &&
			!key.ctrl &&
			!key.meta)
	) {
		abortDetailAgent?.();
		helpers.forceStateUpdate();
		return true;
	}

	// 1-9 switch among running agents when timeline focused
	// (avoid stealing digits while composing a message)
	if (
		input &&
		/^[1-9]$/.test(input) &&
		detailFocus === 'timeline' &&
		!key.ctrl &&
		!key.meta
	) {
		switchDetailAgentByIndex?.(Number(input));
		helpers.forceStateUpdate();
		return true;
	}

	// Enter - send message when input has content, else switch to input
	if (key.return) {
		if (detailFocus === 'input') {
			sendDetailMessage();
		} else {
			setDetailFocus('input');
		}
		helpers.forceStateUpdate();
		return true;
	}

	// Backspace / Delete - edit input (auto-focus input)
	if (key.backspace || key.delete) {
		if (detailFocus !== 'input') {
			setDetailFocus('input');
		}
		backspaceDetailInput();
		helpers.forceStateUpdate();
		return true;
	}

	// Printable characters go to detail input
	if (input && input.length > 0 && !key.ctrl && !key.meta) {
		// Skip pure control sequences
		if (input === '\t') {
			return true;
		}
		if (detailFocus !== 'input') {
			setDetailFocus('input');
		}
		appendDetailInput(input);
		helpers.forceStateUpdate();
		return true;
	}

	// Block other keys while in detail view
	return true;
}
