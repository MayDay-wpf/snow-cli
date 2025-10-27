import {useState, useCallback, useEffect} from 'react';
import {TextBuffer} from '../utils/textBuffer.js';
import {getSubAgents, type SubAgent} from '../utils/subAgentConfig.js';

export function useAgentPicker(buffer: TextBuffer, triggerUpdate: () => void) {
	const [showAgentPicker, setShowAgentPicker] = useState(false);
	const [agentSelectedIndex, setAgentSelectedIndex] = useState(0);
	const [agents, setAgents] = useState<SubAgent[]>([]);

	// Load agents when picker is shown
	useEffect(() => {
		if (showAgentPicker) {
			const loadedAgents = getSubAgents();
			setAgents(loadedAgents);
			setAgentSelectedIndex(0);
		}
	}, [showAgentPicker]);

	// Handle agent selection
	const handleAgentSelect = useCallback(
		(agent: SubAgent) => {
			// Clear buffer and insert agent reference
			buffer.setText('');
			buffer.insert(`#${agent.id} `);
			setShowAgentPicker(false);
			setAgentSelectedIndex(0);
			triggerUpdate();
		},
		[buffer, triggerUpdate],
	);

	return {
		showAgentPicker,
		setShowAgentPicker,
		agentSelectedIndex,
		setAgentSelectedIndex,
		agents,
		handleAgentSelect,
	};
}
