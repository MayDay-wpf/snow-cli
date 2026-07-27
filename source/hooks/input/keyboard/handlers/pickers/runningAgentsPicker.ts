import type {HandlerContext} from '../../types.js';

export function runningAgentsPickerHandler(ctx: HandlerContext): boolean {
	const {input, key, options, helpers} = ctx;
	const {
		showRunningAgentsPicker,
		runningAgents,
		setRunningAgentsSelectedIndex,
		toggleRunningAgentSelection,
		confirmRunningAgentsSelection,
		openSubAgentDetail,
		openSubAgentDetailByIndex,
	} = options;

	if (!showRunningAgentsPicker) return false;

	// Up arrow - circular navigation
	if (key.upArrow) {
		setRunningAgentsSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, runningAgents.length - 1),
		);
		return true;
	}

	// Down arrow - circular navigation
	if (key.downArrow) {
		const maxIndex = Math.max(0, runningAgents.length - 1);
		setRunningAgentsSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Space - toggle multi-selection
	if (input === ' ') {
		toggleRunningAgentSelection();
		return true;
	}

	// 'm' - confirm selection for message targeting (multi-select tags)
	if (input === 'm' || input === 'M') {
		confirmRunningAgentsSelection();
		helpers.forceStateUpdate();
		return true;
	}

	// 'v' - open detail (view)
	if (input === 'v' || input === 'V') {
		openSubAgentDetail?.();
		helpers.forceStateUpdate();
		return true;
	}

	// 1-9 - jump to / open nth agent in picker list
	if (input && /^[1-9]$/.test(input) && !key.ctrl && !key.meta) {
		const index = Number(input);
		if (openSubAgentDetailByIndex) {
			openSubAgentDetailByIndex(index);
		} else if (openSubAgentDetail && index <= runningAgents.length) {
			const agent = runningAgents[index - 1];
			if (agent) openSubAgentDetail(agent.instanceId);
		}
		helpers.forceStateUpdate();
		return true;
	}

	// Enter - open detail TUI for highlighted agent
	if (key.return) {
		if (openSubAgentDetail) {
			openSubAgentDetail();
		} else {
			confirmRunningAgentsSelection();
		}
		helpers.forceStateUpdate();
		return true;
	}

	// Backspace / Delete — let it through so >> can be deleted
	// and updateRunningAgentsPickerState will auto-close the panel.
	if (key.backspace || key.delete) {
		// Don't return — fall through to normal backspace handling below
		return false;
	}

	// For any other key in running agents picker, block to prevent interference
	return true;
}
