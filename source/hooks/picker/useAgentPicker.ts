import {useState, useCallback, useEffect} from 'react';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {getSubAgents, type SubAgent} from '../../utils/config/subAgentConfig.js';

export function useAgentPicker(buffer: TextBuffer, triggerUpdate: () => void) {
	const [showAgentPicker, setShowAgentPicker] = useState(false);
	const [agentSelectedIndex, setAgentSelectedIndex] = useState(0);
	const [agents, setAgents] = useState<SubAgent[]>([]);
	const [agentQuery, setAgentQuery] = useState('');
	const [hashSymbolPosition, setHashSymbolPosition] = useState(-1);

	// Load agents when picker is shown
	useEffect(() => {
		if (showAgentPicker) {
			const loadedAgents = getSubAgents();
			setAgents(loadedAgents);
			setAgentSelectedIndex(0);
		}
	}, [showAgentPicker]);

	// Update agent picker state based on # symbol
	const updateAgentPickerState = useCallback(
		(_text: string, cursorPos: number) => {
			// Use display text (with placeholders) instead of full text (expanded)
			const displayText = buffer.text;

			// Find the last '#' symbol before the cursor
			const beforeCursor = displayText.slice(0, cursorPos);

			let position = -1;
			let query = '';

			// Search backwards from cursor to find #
			for (let i = beforeCursor.length - 1; i >= 0; i--) {
				if (beforeCursor[i] === '#') {
					position = i;
					const afterHash = beforeCursor.slice(i + 1);
					// Only activate if no space/newline after #
					if (!afterHash.includes(' ') && !afterHash.includes('\n')) {
						query = afterHash;
						break;
					} else {
						// Has space after #, not valid
						position = -1;
						break;
					}
				}
			}

			if (position !== -1) {
				// Found valid # context
				if (
					!showAgentPicker ||
					agentQuery !== query ||
					hashSymbolPosition !== position
				) {
					setShowAgentPicker(true);
					setAgentQuery(query);
					setHashSymbolPosition(position);
					setAgentSelectedIndex(0);
				}
			} else {
				// Hide agent picker if no valid # context found and it was triggered by #
				if (showAgentPicker && hashSymbolPosition !== -1) {
					setShowAgentPicker(false);
					setHashSymbolPosition(-1);
					setAgentQuery('');
				}
			}
		},
		[buffer, showAgentPicker, agentQuery, hashSymbolPosition],
	);

	// Get filtered agents based on query
	const getFilteredAgents = useCallback(() => {
		if (!agentQuery) {
			return agents;
		}
		const query = agentQuery.toLowerCase();
		return agents.filter(
			agent =>
				agent.id.toLowerCase().includes(query) ||
				agent.name.toLowerCase().includes(query) ||
				agent.description.toLowerCase().includes(query),
		);
	}, [agents, agentQuery]);

	// Handle agent selection
	const handleAgentSelect = useCallback(
		(agent: SubAgent) => {
			if (hashSymbolPosition !== -1) {
				// Triggered by # symbol - replace inline
				const displayText = buffer.text;
				const cursorPos = buffer.getCursorPosition();

				// Replace query with selected agent ID
				const beforeHash = displayText.slice(0, hashSymbolPosition);
				const afterCursor = displayText.slice(cursorPos);

				// Construct the replacement: #agent_id
				const newText = beforeHash + '#' + agent.id + ' ' + afterCursor;

				// Set the new text and position cursor after the inserted agent ID + space
				buffer.setText(newText);

				// Calculate cursor position after the inserted text
				// # length (1) + agent ID length + space (1)
				const insertedLength = 1 + agent.id.length + 1;
				const targetPos = hashSymbolPosition + insertedLength;

				// Reset cursor to beginning, then move to correct position
				for (let i = 0; i < targetPos; i++) {
					if (i < buffer.text.length) {
						buffer.moveRight();
					}
				}

				setHashSymbolPosition(-1);
				setAgentQuery('');
			} else {
				// Triggered by command - clear buffer and insert
				buffer.setText('');
				buffer.insert(`#${agent.id} `);
			}

			setShowAgentPicker(false);
			setAgentSelectedIndex(0);
			triggerUpdate();
		},
		[hashSymbolPosition, buffer, triggerUpdate],
	);

	return {
		showAgentPicker,
		setShowAgentPicker,
		agentSelectedIndex,
		setAgentSelectedIndex,
		agents,
		agentQuery,
		hashSymbolPosition,
		updateAgentPickerState,
		getFilteredAgents,
		handleAgentSelect,
	};
}
