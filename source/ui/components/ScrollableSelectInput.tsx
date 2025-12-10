import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

type SelectItem = {
	label: string;
	value: string;
	key?: string;
	[index: string]: unknown;
};

type IndicatorProps = {
	isSelected: boolean;
};

type RenderItemProps<T extends SelectItem> = T & {
	isSelected: boolean;
	isMarked: boolean;
};

type Props<T extends SelectItem> = {
	items: readonly T[];
	limit?: number;
	initialIndex?: number;
	isFocused?: boolean;
	indicator?: (props: IndicatorProps) => React.ReactNode;
	renderItem?: (props: RenderItemProps<T>) => React.ReactNode;
	onSelect?: (item: T) => void;
	onHighlight?: (item: T) => void;
	selectedValues?: ReadonlySet<string> | readonly string[];
	onToggleItem?: (item: T) => void;
	onDeleteSelection?: () => void;
};

function DefaultIndicator({ isSelected }: IndicatorProps) {
	return (
		<Box marginRight={1}>
			<Text color={isSelected ? 'cyan' : 'gray'}>{isSelected ? '>' : ' '}</Text>
		</Box>
	);
}

function DefaultItem<T extends SelectItem>({ label, isSelected }: RenderItemProps<T>) {
	return <Text color={isSelected ? 'cyan' : 'white'}>{label}</Text>;
}

export default function ScrollableSelectInput<T extends SelectItem>({
	items,
	limit,
	initialIndex = 0,
	isFocused = true,
	indicator = DefaultIndicator,
	renderItem,
	onSelect,
	onHighlight,
	selectedValues,
	onToggleItem,
	onDeleteSelection
}: Props<T>) {
	const totalItems = items.length;
	const windowSize = totalItems === 0 ? 0 : Math.min(Math.max(limit ?? totalItems, 1), totalItems);
	const selectedValueSet = useMemo<ReadonlySet<string>>(() => {
		if (!selectedValues) {
			return new Set<string>();
		}

		if (selectedValues instanceof Set) {
			return selectedValues;
		}

		return new Set(selectedValues);
	}, [selectedValues]);

	const clampCursor = useCallback(
		(value: number) => {
			if (totalItems === 0) {
				return 0;
			}

			// 循环导航:小于 0 → 跳到最后一项,大于最后一项 → 跳到第一项
			if (value < 0) {
				return totalItems - 1;
			}

			if (value > totalItems - 1) {
				return 0;
			}

			return value;
		},
		[totalItems]
	);

	const computeOffset = useCallback(
		(currentOffset: number, targetCursor: number) => {
			if (totalItems === 0 || windowSize === 0) {
				return 0;
			}

			const maxOffset = Math.max(0, totalItems - windowSize);
			let nextOffset = Math.min(Math.max(currentOffset, 0), maxOffset);

			if (targetCursor < nextOffset) {
				nextOffset = targetCursor;
			} else if (targetCursor >= nextOffset + windowSize) {
				nextOffset = targetCursor - windowSize + 1;
			}

			return Math.min(Math.max(nextOffset, 0), maxOffset);
		},
		[totalItems, windowSize]
	);

	const [cursor, setCursor] = useState(() => clampCursor(initialIndex));
	const [offset, setOffset] = useState(() => computeOffset(clampCursor(initialIndex), clampCursor(initialIndex)));

	useEffect(() => {
		if (totalItems === 0) {
			if (cursor !== 0) {
				setCursor(0);
			}
			if (offset !== 0) {
				setOffset(0);
			}
			return;
		}

		const clampedCursor = clampCursor(cursor);
		if (clampedCursor !== cursor) {
			setCursor(clampedCursor);
			return;
		}

		const clampedOffset = computeOffset(offset, clampedCursor);
		if (clampedOffset !== offset) {
			setOffset(clampedOffset);
		}
	}, [clampCursor, computeOffset, cursor, offset, totalItems]);

	const visibleItems = useMemo(() => {
		if (windowSize === 0) {
			return [] as T[];
		}

		return items.slice(offset, offset + windowSize);
	}, [items, offset, windowSize]);

	const selectedItem = totalItems === 0 ? undefined : items[cursor];

	useEffect(() => {
		if (selectedItem && onHighlight) {
			onHighlight(selectedItem);
		}
	}, [onHighlight, selectedItem]);

	const moveCursor = useCallback(
		(direction: -1 | 1) => {
			if (totalItems === 0) {
				return;
			}

			setCursor(previousCursor => {
				const rawNext = previousCursor + direction;
				const nextCursor = clampCursor(rawNext);
				if (nextCursor === previousCursor) {
					return previousCursor;
				}

				// 检测是否发生循环跳转
				const isWrapping = (direction === -1 && rawNext < 0) || (direction === 1 && rawNext > totalItems - 1);

				if (isWrapping) {
					// 循环时直接设置偏移到正确位置
					if (nextCursor === 0) {
						// 跳到第一项，偏移设为 0
						setOffset(0);
					} else {
						// 跳到最后一项，偏移设为最大值
						const maxOffset = Math.max(0, totalItems - windowSize);
						setOffset(maxOffset);
					}
				} else {
					setOffset(previousOffset => computeOffset(previousOffset, nextCursor));
				}
				return nextCursor;
			});
		},
		[clampCursor, computeOffset, totalItems, windowSize]
	);

	const selectIndex = useCallback(
		(targetIndex: number) => {
			if (totalItems === 0) {
				return;
			}

			const boundedIndex = clampCursor(targetIndex);
			setCursor(boundedIndex);
			setOffset(previousOffset => computeOffset(previousOffset, boundedIndex));
			const item = items[boundedIndex];
			if (item) {
				onSelect?.(item);
			}
		},
		[clampCursor, computeOffset, items, onSelect, totalItems]
	);

	const handleInput = useCallback(
		(input: string, key: Record<string, boolean>) => {
			if (!isFocused || totalItems === 0) {
				return;
			}

			if (key['upArrow']) {
				moveCursor(-1);
				return;
			}

			if (key['downArrow']) {
				moveCursor(1);
				return;
			}

			if (key['return'] && selectedItem) {
				onSelect?.(selectedItem);
				return;
			}

			if (input === ' ' && selectedItem) {
				onToggleItem?.(selectedItem);
				return;
			}

			if ((input === 'd' || input === 'D') && onDeleteSelection) {
				onDeleteSelection();
				return;
			}

			if (/^[1-9]$/.test(input) && windowSize > 0) {
				const target = Number.parseInt(input, 10) - 1;
				if (target >= 0 && target < visibleItems.length) {
					selectIndex(offset + target);
				}
			}
		},
		[isFocused, moveCursor, offset, onDeleteSelection, onSelect, onToggleItem, selectIndex, selectedItem, totalItems, visibleItems.length, windowSize]
	);

	useInput(handleInput, { isActive: isFocused });

	if (windowSize === 0) {
		return null;
	}

	const renderRow = useCallback(
		(row: RenderItemProps<T>) => {
			if (renderItem) {
				return renderItem(row);
			}

			return DefaultItem(row);
		},
		[renderItem]
	);

	return (
		<Box flexDirection="column">
			{visibleItems.map((item, index) => {
				const absoluteIndex = offset + index;
				const isSelected = absoluteIndex === cursor;
				const isMarked = selectedValueSet.has(item.value);
				const key = (item.key ?? item.value) as string;

				return (
					<Box key={key}>
						{indicator({ isSelected })}
						{renderRow({ ...item, isSelected, isMarked } as RenderItemProps<T>)}
					</Box>
				);
			})}
		</Box>
	);
}
