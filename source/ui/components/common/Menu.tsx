import React, {useState, useCallback} from 'react';
import {Box, Text, useInput, useStdout} from 'ink';
import {resetTerminal} from '../../../utils/execution/terminal.js';
import {useI18n} from '../../../i18n/index.js';
import {useTheme} from '../../contexts/ThemeContext.js';

type MenuOption = {
	label: string;
	value: string;
	color?: string;
	infoText?: string;
	clearTerminal?: boolean;
};

type Props = {
	options: MenuOption[];
	onSelect: (value: string) => void;
	onSelectionChange?: (infoText: string, value: string) => void;
	maxHeight?: number; // Maximum number of visible items
	defaultIndex?: number; // Initial selected index
};

function Menu({
	options,
	onSelect,
	onSelectionChange,
	maxHeight,
	defaultIndex = 0,
}: Props) {
	const {stdout} = useStdout();
	const {t} = useI18n();
	const {theme} = useTheme();

	// Calculate available height first, before initializing state
	const terminalHeight = stdout?.rows || 24;
	const headerHeight = 8; // Space for header, borders, etc.
	const defaultMaxHeight = Math.max(5, terminalHeight - headerHeight);
	const visibleItemCount = maxHeight || defaultMaxHeight;

	// Initialize selectedIndex and scrollOffset based on defaultIndex
	const getInitialScrollOffset = (index: number, visibleCount: number) => {
		// Center the selected item if possible
		const halfVisible = Math.floor(visibleCount / 2);
		const maxOffset = Math.max(0, options.length - visibleCount);
		return Math.max(0, Math.min(index - halfVisible, maxOffset));
	};

	const [selectedIndex, setSelectedIndex] = useState(() =>
		Math.min(defaultIndex, options.length - 1),
	);
	const [scrollOffset, setScrollOffset] = useState(() =>
		getInitialScrollOffset(defaultIndex, visibleItemCount),
	);

	// Sync selectedIndex and scrollOffset when defaultIndex changes from parent
	React.useEffect(() => {
		const newIndex = Math.min(defaultIndex, options.length - 1);
		setSelectedIndex(newIndex);
		setScrollOffset(getInitialScrollOffset(newIndex, visibleItemCount));
	}, [defaultIndex, options.length, visibleItemCount]);

	React.useEffect(() => {
		const currentOption = options[selectedIndex];
		if (onSelectionChange && currentOption?.infoText) {
			onSelectionChange(currentOption.infoText, currentOption.value);
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

	const clearTerminal = useCallback(() => {
		resetTerminal(stdout);
	}, [stdout]);

	const handleInput = useCallback(
		(_input: string, key: any) => {
			if (key.upArrow) {
				setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
			} else if (key.downArrow) {
				setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
			} else if (key.return) {
				const selectedOption = options[selectedIndex];
				if (selectedOption) {
					if (selectedOption.clearTerminal) {
						clearTerminal();
					}
					onSelect(selectedOption.value);
				}
			}
		},
		[options, selectedIndex, onSelect, clearTerminal],
	);

	useInput(handleInput);

	// Calculate visible options and "more" counts
	const visibleOptions = options.slice(
		scrollOffset,
		scrollOffset + visibleItemCount,
	);
	const hasMoreAbove = scrollOffset > 0;
	const hasMoreBelow = scrollOffset + visibleItemCount < options.length;
	const moreAboveCount = scrollOffset;
	const moreBelowCount = options.length - (scrollOffset + visibleItemCount);

	return (
		<Box flexDirection="column" width={'100%'} padding={1}>
			<Box marginBottom={1}>
				<Text color={theme.colors.menuInfo}>{t.menu.navigate}</Text>
			</Box>

			{hasMoreAbove && (
				<Box>
					<Text color={theme.colors.menuSecondary} dimColor>
						↑ +{moreAboveCount} more above
					</Text>
				</Box>
			)}

			{visibleOptions.map((option, index) => {
				const actualIndex = scrollOffset + index;
				return (
					<Box key={option.value}>
						<Text
							color={
								actualIndex === selectedIndex
									? theme.colors.menuSelected
									: option.color || theme.colors.menuNormal
							}
							bold
						>
							{actualIndex === selectedIndex ? '❯ ' : '  '}
							{option.label}
						</Text>
					</Box>
				);
			})}

			{hasMoreBelow && (
				<Box>
					<Text color={theme.colors.menuSecondary} dimColor>
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
		prevProps.maxHeight === nextProps.maxHeight &&
		prevProps.defaultIndex === nextProps.defaultIndex
	);
});
