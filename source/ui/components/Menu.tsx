import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';

type MenuOption = {
	label: string;
	value: string;
	color?: string;
	infoText?: string;
};

type Props = {
	options: MenuOption[];
	onSelect: (value: string) => void;
	onSelectionChange?: (infoText: string) => void;
};

export default function Menu({options, onSelect, onSelectionChange}: Props) {
	const [selectedIndex, setSelectedIndex] = useState(0);

	React.useEffect(() => {
		const currentOption = options[selectedIndex];
		if (onSelectionChange && currentOption?.infoText) {
			onSelectionChange(currentOption.infoText);
		}
	}, [selectedIndex, options, onSelectionChange]);

	useInput((_, key) => {
		if (key.upArrow) {
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
		} else if (key.downArrow) {
			setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
		} else if (key.return) {
			const selectedOption = options[selectedIndex];
			if (selectedOption) {
				onSelect(selectedOption.value);
			}
		}
	});

	return (
		<Box flexDirection="column" width={'100%'} borderStyle={'round'} borderColor="#A9C13E" padding={1}>
			<Box marginBottom={1}>
				<Text color="cyan">
					Use ↑↓ keys to navigate, press Enter to select:
				</Text>
			</Box>
			{options.map((option, index) => (
				<Box key={option.value}>
					<Text
						color={index === selectedIndex ? 'green' : option.color || 'white'}
						bold
					>
						{index === selectedIndex ? '➣ ' : '  '}
						{option.label}
					</Text>
				</Box>
			))}
		</Box>
	);
}
