import type {HandlerContext} from '../../types.js';

export function agentPickerHandler(ctx: HandlerContext): boolean {
	const {key, options} = ctx;
	const {
		showAgentPicker,
		getFilteredAgents,
		setAgentSelectedIndex,
		agentSelectedIndex,
		handleAgentSelect,
		setShowAgentPicker,
	} = options;

	if (!showAgentPicker) return false;
	const filteredAgents = getFilteredAgents();

	// Up arrow in agent picker - 循环导航:第一项 → 最后一项
	if (key.upArrow) {
		setAgentSelectedIndex(prev =>
			prev > 0 ? prev - 1 : Math.max(0, filteredAgents.length - 1),
		);
		return true;
	}

	// Down arrow in agent picker - 循环导航:最后一项 → 第一项
	if (key.downArrow) {
		const maxIndex = Math.max(0, filteredAgents.length - 1);
		setAgentSelectedIndex(prev => (prev < maxIndex ? prev + 1 : 0));
		return true;
	}

	// Enter - select agent
	if (key.return) {
		if (
			filteredAgents.length > 0 &&
			agentSelectedIndex < filteredAgents.length
		) {
			const selectedAgent = filteredAgents[agentSelectedIndex];
			if (selectedAgent) {
				handleAgentSelect(selectedAgent);
				setShowAgentPicker(false);
				setAgentSelectedIndex(0);
			}
		}
		return true;
	}

	// Allow typing to filter - don't block regular input
	// The input will be processed below and updateAgentPickerState will be called
	// which will update the filter automatically
	return false;
}
