import React, {useState} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import {useTheme} from '../contexts/ThemeContext.js';

export interface AskUserQuestionResult {
	selected: string;
	customInput?: string;
}

interface Props {
	question: string;
	options: string[];
	onAnswer: (result: AskUserQuestionResult) => void;
}

export default function AskUserQuestion({question, options, onAnswer}: Props) {
	const {theme} = useTheme();
	const [hasAnswered, setHasAnswered] = useState(false);
	const [showCustomInput, setShowCustomInput] = useState(false);
	const [customInput, setCustomInput] = useState('');

	// Add "Custom input" option at the end
	const items = [
		...options.map((option, index) => ({
			label: option,
			value: `option-${index}`,
		})),
		{
			label: 'Custom input...',
			value: 'custom',
		},
	];

	const handleSelect = (item: {label: string; value: string}) => {
		if (!hasAnswered) {
			if (item.value === 'custom') {
				setShowCustomInput(true);
			} else {
				setHasAnswered(true);
				onAnswer({
					selected: item.label,
				});
			}
		}
	};

	const handleCustomInputSubmit = () => {
		if (!hasAnswered && customInput.trim()) {
			setHasAnswered(true);
			onAnswer({
				selected: 'Custom input',
				customInput: customInput.trim(),
			});
		}
	};

	return (
		<Box
			flexDirection="column"
			marginX={1}
			marginY={1}
			borderStyle={'round'}
			borderColor={theme.colors.menuInfo}
			paddingX={1}
		>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuInfo}>
					[User Input Required]
				</Text>
			</Box>

			<Box marginBottom={1}>
				<Text>{question}</Text>
			</Box>

			{!showCustomInput ? (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text dimColor>Select an option:</Text>
					</Box>
					<SelectInput items={items} onSelect={handleSelect} />
				</Box>
			) : (
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text dimColor>Enter your response:</Text>
					</Box>
					<Box>
						<Text color={theme.colors.success}>&gt; </Text>
						<TextInput
							value={customInput}
							onChange={setCustomInput}
							onSubmit={handleCustomInputSubmit}
						/>
					</Box>
				</Box>
			)}
		</Box>
	);
}
