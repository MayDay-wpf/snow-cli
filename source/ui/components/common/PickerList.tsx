import React, {memo, useMemo} from 'react';
import {Box, Text} from 'ink';
import {useTheme} from '../../contexts/ThemeContext.js';

const DEFAULT_MAX_DISPLAY_ITEMS = 5;

interface DisplayWindow<T> {
	items: T[];
	startIndex: number;
	endIndex: number;
}

export function usePickerWindow<T>(
	items: T[],
	selectedIndex: number,
	maxDisplayItems?: number,
): {
	displayedItems: T[];
	displayedSelectedIndex: number;
	hiddenAboveCount: number;
	hiddenBelowCount: number;
	effectiveMaxItems: number;
} {
	const effectiveMaxItems = maxDisplayItems
		? Math.min(maxDisplayItems, DEFAULT_MAX_DISPLAY_ITEMS)
		: DEFAULT_MAX_DISPLAY_ITEMS;

	const displayWindow = useMemo((): DisplayWindow<T> => {
		if (items.length <= effectiveMaxItems) {
			return {items, startIndex: 0, endIndex: items.length};
		}
		const halfWindow = Math.floor(effectiveMaxItems / 2);
		let startIndex = Math.max(0, selectedIndex - halfWindow);
		let endIndex = Math.min(items.length, startIndex + effectiveMaxItems);
		if (endIndex - startIndex < effectiveMaxItems) {
			startIndex = Math.max(0, endIndex - effectiveMaxItems);
		}
		return {
			items: items.slice(startIndex, endIndex),
			startIndex,
			endIndex,
		};
	}, [items, selectedIndex, effectiveMaxItems]);

	const displayedSelectedIndex = useMemo(() => {
		return displayWindow.items.findIndex(item => {
			const originalIndex = items.indexOf(item);
			return originalIndex === selectedIndex;
		});
	}, [displayWindow.items, items, selectedIndex]);

	return {
		displayedItems: displayWindow.items,
		displayedSelectedIndex,
		hiddenAboveCount: displayWindow.startIndex,
		hiddenBelowCount: Math.max(0, items.length - displayWindow.endIndex),
		effectiveMaxItems,
	};
}

interface PickerListProps<T> {
	items: T[];
	selectedIndex: number;
	visible: boolean;
	maxDisplayItems?: number;
	itemHeight?: number;
	getItemKey: (item: T) => string;
	renderItem: (item: T, isSelected: boolean) => React.ReactNode;
	title?: React.ReactNode;
	header?: React.ReactNode;
	footer?: React.ReactNode;
	emptyContent?: React.ReactNode;
	scrollHintFormat?: (above: number, below: number) => React.ReactNode;
}

function PickerListInner<T>({
	items,
	selectedIndex,
	visible,
	maxDisplayItems,
	itemHeight = 2,
	getItemKey,
	renderItem,
	title,
	header,
	footer,
	emptyContent,
	scrollHintFormat,
}: PickerListProps<T>) {
	const {theme} = useTheme();

	const {
		displayedItems,
		displayedSelectedIndex,
		hiddenAboveCount,
		hiddenBelowCount,
		effectiveMaxItems,
	} = usePickerWindow(items, selectedIndex, maxDisplayItems);

	if (!visible) {
		return null;
	}

	if (items.length === 0) {
		return emptyContent ? (
			<Box flexDirection="column">{emptyContent}</Box>
		) : null;
	}

	const showScrollHint = items.length > effectiveMaxItems;

	return (
		<Box flexDirection="column">
			<Box width="100%" flexDirection="column">
				{title && <Box>{title}</Box>}
				{header}
				{displayedItems.map((item, index) => {
					const isSelected = index === displayedSelectedIndex;
					return (
						<Box
							key={getItemKey(item)}
							flexDirection="column"
							width="100%"
							height={itemHeight}
							overflow="hidden"
						>
							{renderItem(item, isSelected)}
						</Box>
					);
				})}
				{showScrollHint && (
					<Box>
						{scrollHintFormat ? (
							scrollHintFormat(hiddenAboveCount, hiddenBelowCount)
						) : (
							<Text color={theme.colors.menuSecondary} dimColor>
								↑↓ to scroll
								{hiddenAboveCount > 0 &&
									` · ${hiddenAboveCount} more above`}
								{hiddenBelowCount > 0 &&
									` · ${hiddenBelowCount} more below`}
							</Text>
						)}
					</Box>
				)}
				{footer}
			</Box>
		</Box>
	);
}

const PickerList = memo(PickerListInner) as typeof PickerListInner;

export default PickerList;
