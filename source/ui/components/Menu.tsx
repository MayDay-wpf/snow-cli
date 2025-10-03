import React, {useState, useCallback} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';

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
	maxHeight?: number; // Maximum number of visible items
};

function Menu({options, onSelect, onSelectionChange, maxHeight}: Props) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [scrollOffset, setScrollOffset] = useState(0);
	const {stdout} = useStdout();
	
	// Calculate available height
	const terminalHeight = stdout?.rows || 24;
	const headerHeight = 8; // Space for header, borders, etc.
	const defaultMaxHeight = Math.max(5, terminalHeight - headerHeight);
	const visibleItemCount = maxHeight || defaultMaxHeight;

	React.useEffect(() => {
		const currentOption = options[selectedIndex];
		if (onSelectionChange && currentOption?.infoText) {
			onSelectionChange(currentOption.infoText);
		}
	}, [selectedIndex, options, onSelectionChange]);

	// Auto-scroll to keep selected item visible
	React.useEffect(() => {
		if (selectedIndex < scrollOffset) {
			setScrollOffset(selectedIndex);
		} else if (selectedIndex >= scrollOffset + visibleItemCount) {
			setScrollOffset(selectedIndex - visibleItemCount + 1);
		}
	}, [selectedIndex, scrollOffset, visibleItemCount]);

	const handleInput = useCallback((_input: string, key: any) => {
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
	}, [options.length, selectedIndex, onSelect]);

	useInput(handleInput);

	// Calculate visible options and "more" counts
	const visibleOptions = options.slice(scrollOffset, scrollOffset + visibleItemCount);
	const hasMoreAbove = scrollOffset > 0;
	const hasMoreBelow = scrollOffset + visibleItemCount < options.length;
	const moreAboveCount = scrollOffset;
	const moreBelowCount = options.length - (scrollOffset + visibleItemCount);

	return (
		<Box flexDirection="column" width={'100%'} borderStyle={'round'} borderColor="#A9C13E" padding={1}>
			<Box marginBottom={1}>
				<Text color="cyan">
					Use ↑↓ keys to navigate, press Enter to select:
				</Text>
			</Box>
			
			{hasMoreAbove && (
				<Box>
					<Text color="gray" dimColor>
						  ↑ +{moreAboveCount} more above
					</Text>
				</Box>
			)}
			
			{visibleOptions.map((option, index) => {
				const actualIndex = scrollOffset + index;
				return (
					<Box key={option.value}>
						<Text
							color={actualIndex === selectedIndex ? 'green' : option.color || 'white'}
							bold
						>
							{actualIndex === selectedIndex ? '➣ ' : '  '}
							{option.label}
						</Text>
					</Box>
				);
			})}
			
			{hasMoreBelow && (
				<Box>
					<Text color="gray" dimColor>
						  ↓ +{moreBelowCount} more below
					</Text>
				</Box>
			)}
		</Box>
	);
}

// Memoize to prevent unnecessary re-renders
export default React.memo(Menu, (prevProps, nextProps) => {
	return (
		prevProps.options === nextProps.options &&
		prevProps.onSelect === nextProps.onSelect &&
		prevProps.onSelectionChange === nextProps.onSelectionChange &&
		prevProps.maxHeight === nextProps.maxHeight
	);
});
