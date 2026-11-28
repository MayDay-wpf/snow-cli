import React, {
	useCallback,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
} from 'react';
import {Box, Text, useInput, useMouse} from 'ink';
import type {DOMElement, MouseEvent} from 'ink';

/**
 * Lines scrolled per mouse wheel notch.
 */
const WHEEL_STEP = 3;

/**
 * Upper bound of consecutive self-triggered re-measure passes. Protects
 * against pathological layouts whose height oscillates between renders.
 */
const MAX_REMEASURE_PASSES = 6;

/**
 * Children may change their own height through internal state (spinners,
 * expanding panels...) without re-rendering this component. A cheap
 * periodic check of the Yoga layout keeps cached heights in sync.
 */
const REMEASURE_INTERVAL_MS = 250;

type Props<T extends object> = {
	/**
	 * Items to render. Item object identity is used as height-cache key, so
	 * an updated item MUST be a new object (the usual immutable React style).
	 */
	readonly items: readonly T[];
	readonly renderItem: (item: T, index: number) => React.ReactNode;
	/**
	 * Height guess (in terminal rows) for items that were never rendered.
	 */
	readonly estimateItemHeight: (item: T) => number;
	/**
	 * Total width including the 1-column scrollbar.
	 */
	readonly width: number;
	/**
	 * Any change invalidates every cached height (width, display modes...).
	 */
	readonly layoutKey: string;
	/**
	 * Live content rendered after the last item (interactive prompts,
	 * running command output...). It is always mounted so interactive
	 * components keep their state while the user scrolls through history.
	 */
	readonly footer?: React.ReactNode;
	/**
	 * Whenever this value changes the view jumps back to the bottom.
	 */
	readonly stickToBottomKey?: string | number;
	readonly keyboardActive?: boolean;
	readonly mouseActive?: boolean;
	readonly thumbColor?: string;
	readonly trackColor?: string;
};

type RenderInfo<T> = {
	start: number;
	items: T[];
	usedHeights: number[];
	firstVisible: number;
	sticky: boolean;
	hasFooter: boolean;
};

type ScrollbarGeometry = {
	x: number;
	y: number;
	height: number;
};

const clamp = (value: number, min: number, max: number) =>
	Math.min(max, Math.max(min, value));

/**
 * Index of the first item (offsets has length n + 1, ascending) that ends
 * after `position`.
 */
const findItemAt = (offsets: number[], count: number, position: number) => {
	let low = 0;
	let high = count;
	while (low < high) {
		const mid = (low + high) >>> 1;
		if (offsets[mid + 1]! <= position) {
			low = mid + 1;
		} else {
			high = mid;
		}
	}

	return low;
};

const getAbsolutePosition = (node: DOMElement) => {
	let x = 0;
	let y = 0;
	let current: DOMElement | undefined = node;
	while (current?.yogaNode) {
		x += current.yogaNode.getComputedLeft();
		y += current.yogaNode.getComputedTop();
		current = current.parentNode;
	}

	return {x, y};
};

const measureNode = (node: DOMElement | undefined): number | undefined => {
	if (!node?.yogaNode) {
		return undefined;
	}

	return Math.max(0, Math.round(node.yogaNode.getComputedHeight()));
};

function Scrollbar({
	height,
	contentHeight,
	scrollTop,
	thumbColor,
	trackColor,
}: {
	height: number;
	contentHeight: number;
	scrollTop: number;
	thumbColor?: string;
	trackColor?: string;
}) {
	if (height <= 0 || contentHeight <= height) {
		return <Box width={1} flexShrink={0} />;
	}

	const maxScroll = contentHeight - height;
	const thumbSize = clamp(
		Math.round((height * height) / contentHeight),
		1,
		height,
	);
	const thumbTop = Math.round(
		(clamp(scrollTop, 0, maxScroll) / maxScroll) * (height - thumbSize),
	);

	const rows: React.ReactNode[] = [];
	for (let row = 0; row < height; row++) {
		const isThumb = row >= thumbTop && row < thumbTop + thumbSize;
		rows.push(
			isThumb ? (
				<Text key={row} color={thumbColor}>
					█
				</Text>
			) : (
				<Text key={row} color={trackColor} dimColor>
					│
				</Text>
			),
		);
	}

	return (
		<Box flexDirection="column" width={1} flexShrink={0}>
			{rows}
		</Box>
	);
}

/**
 * Fixed-height, virtualized, bottom-sticky scroll container for the
 * full-screen TUI. Only items intersecting the viewport (plus overscan) are
 * mounted, so render cost and memory stay bounded no matter how long the
 * conversation grows. Item heights are measured from the Yoga layout after
 * each commit and cached per item object.
 *
 * Interaction: mouse wheel, PageUp / PageDown, click or drag on scrollbar.
 */
export default function VirtualScrollView<T extends object>({
	items,
	renderItem,
	estimateItemHeight,
	width,
	layoutKey,
	footer,
	stickToBottomKey,
	keyboardActive = true,
	mouseActive = true,
	thumbColor,
	trackColor,
}: Props<T>) {
	const [, forceUpdate] = useReducer((value: number) => value + 1, 0);

	const viewportRef = useRef<DOMElement | null>(null);
	const innerRef = useRef<DOMElement | null>(null);
	const rowRef = useRef<DOMElement | null>(null);

	const heightCacheRef = useRef(new WeakMap<T, number>());
	const estimateCacheRef = useRef(new WeakMap<T, number>());
	const layoutKeyRef = useRef(layoutKey);

	const viewportHeightRef = useRef(
		Math.max(1, (process.stdout.rows || 24) - 8),
	);
	const footerHeightRef = useRef(0);
	const scrollTopRef = useRef(0);
	const stickyRef = useRef(true);
	const maxScrollRef = useRef(0);
	const draggingRef = useRef(false);
	const geometryRef = useRef<ScrollbarGeometry>({x: -1, y: -1, height: 0});
	const remeasurePassesRef = useRef(0);
	const renderInfoRef = useRef<RenderInfo<T>>({
		start: 0,
		items: [],
		usedHeights: [],
		firstVisible: 0,
		sticky: true,
		hasFooter: false,
	});

	// Width / display mode changes invalidate every measured height.
	if (layoutKeyRef.current !== layoutKey) {
		layoutKeyRef.current = layoutKey;
		heightCacheRef.current = new WeakMap();
		estimateCacheRef.current = new WeakMap();
	}

	const stickKeyRef = useRef(stickToBottomKey);
	if (stickKeyRef.current !== stickToBottomKey) {
		stickKeyRef.current = stickToBottomKey;
		stickyRef.current = true;
	}

	// ---- Layout computation ------------------------------------------------
	const viewportHeight = viewportHeightRef.current;
	const count = items.length;
	const heights: number[] = new Array(count);
	const offsets: number[] = new Array(count + 1);
	const heightCache = heightCacheRef.current;
	const estimateCache = estimateCacheRef.current;

	let total = 0;
	for (let index = 0; index < count; index++) {
		const item = items[index]!;
		let height = heightCache.get(item);
		if (height === undefined) {
			height = estimateCache.get(item);
			if (height === undefined) {
				height = Math.max(0, Math.round(estimateItemHeight(item)));
				estimateCache.set(item, height);
			}
		}

		heights[index] = height;
		offsets[index] = total;
		total += height;
	}

	offsets[count] = total;

	const hasFooter = footer !== undefined && footer !== null;
	const contentHeight = total + (hasFooter ? footerHeightRef.current : 0);
	const maxScroll = Math.max(0, contentHeight - viewportHeight);
	if (!stickyRef.current && scrollTopRef.current >= maxScroll) {
		stickyRef.current = true;
	}

	const sticky = stickyRef.current;
	const scrollTop = sticky
		? maxScroll
		: clamp(scrollTopRef.current, 0, maxScroll);
	scrollTopRef.current = scrollTop;
	maxScrollRef.current = maxScroll;

	const overscan = Math.max(8, viewportHeight);
	const windowStart = Math.max(0, scrollTop - overscan);
	const windowEnd = scrollTop + viewportHeight + overscan;

	const start = findItemAt(offsets, count, windowStart);
	let end = start;
	if (sticky) {
		end = count;
	} else {
		while (end < count && offsets[end]! < windowEnd) {
			end++;
		}
	}

	const firstVisible = findItemAt(offsets, count, scrollTop);
	// Sticky + overflowing: anchor the content to the viewport bottom with
	// flex-end. Bottom alignment then stays exact even while live content
	// (footer) changes height between measurements.
	const anchorBottom = sticky && contentHeight > viewportHeight;
	const marginTop = anchorBottom
		? 0
		: (start < count ? offsets[start]! : total) - scrollTop;

	const visibleItems = items.slice(start, end);
	renderInfoRef.current = {
		start,
		items: visibleItems,
		usedHeights: heights.slice(start, end),
		firstVisible,
		sticky,
		hasFooter,
	};

	// ---- Measurement -------------------------------------------------------
	const measure = useCallback((): boolean => {
		let changed = false;
		let anchorDelta = 0;

		const viewportMeasured = measureNode(viewportRef.current ?? undefined);
		if (
			viewportMeasured !== undefined &&
			viewportMeasured !== viewportHeightRef.current
		) {
			viewportHeightRef.current = viewportMeasured;
			changed = true;
		}

		const info = renderInfoRef.current;
		const children = innerRef.current?.childNodes ?? [];
		const cache = heightCacheRef.current;

		for (let k = 0; k < info.items.length; k++) {
			const measured = measureNode(children[k] as DOMElement | undefined);
			if (measured === undefined) {
				continue;
			}

			const item = info.items[k]!;
			const previous = cache.get(item) ?? info.usedHeights[k]!;
			if (measured !== previous) {
				changed = true;
				// Keep the first visible line anchored when items above it
				// turn out taller/shorter than assumed.
				if (!info.sticky && info.start + k < info.firstVisible) {
					anchorDelta += measured - previous;
				}
			}

			cache.set(item, measured);
		}

		if (info.hasFooter) {
			const measured = measureNode(
				children[info.items.length] as DOMElement | undefined,
			);
			if (measured !== undefined && measured !== footerHeightRef.current) {
				footerHeightRef.current = measured;
				changed = true;
			}
		}

		if (anchorDelta !== 0 && !stickyRef.current) {
			scrollTopRef.current += anchorDelta;
		}

		const row = rowRef.current;
		if (row?.yogaNode) {
			const position = getAbsolutePosition(row);
			geometryRef.current = {
				x: Math.round(position.x + row.yogaNode.getComputedWidth() - 1),
				y: Math.round(position.y),
				height: viewportHeightRef.current,
			};
		}

		return changed;
	}, []);

	// Runs after every commit; Ink has already computed the Yoga layout in
	// resetAfterCommit, which precedes layout effects.
	useLayoutEffect(() => {
		if (measure()) {
			if (remeasurePassesRef.current < MAX_REMEASURE_PASSES) {
				remeasurePassesRef.current++;
				forceUpdate();
			}
		} else {
			remeasurePassesRef.current = 0;
		}
	});

	useEffect(() => {
		const timer = setInterval(() => {
			if (measure()) {
				remeasurePassesRef.current = 0;
				forceUpdate();
			}
		}, REMEASURE_INTERVAL_MS);
		return () => {
			clearInterval(timer);
		};
	}, [measure]);

	// ---- Scrolling ---------------------------------------------------------
	const scrollTo = useCallback((target: number) => {
		const max = maxScrollRef.current;
		const next = clamp(Math.round(target), 0, max);
		const nextSticky = next >= max;
		if (next === scrollTopRef.current && nextSticky === stickyRef.current) {
			return;
		}

		stickyRef.current = nextSticky;
		scrollTopRef.current = next;
		forceUpdate();
	}, []);

	const scrollBy = useCallback(
		(delta: number) => {
			const current = stickyRef.current
				? maxScrollRef.current
				: scrollTopRef.current;
			scrollTo(current + delta);
		},
		[scrollTo],
	);

	const scrollToRow = useCallback(
		(screenRow: number) => {
			const geometry = geometryRef.current;
			if (geometry.height <= 0) {
				return;
			}

			const ratio = clamp(
				(screenRow - geometry.y) / Math.max(1, geometry.height - 1),
				0,
				1,
			);
			scrollTo(ratio * maxScrollRef.current);
		},
		[scrollTo],
	);

	useInput(
		(_input, key) => {
			const page = Math.max(1, viewportHeightRef.current - 1);
			if (key.pageUp) {
				scrollBy(-page);
			} else if (key.pageDown) {
				scrollBy(page);
			}
		},
		{isActive: keyboardActive},
	);

	useMouse(
		(event: MouseEvent) => {
			switch (event.action) {
				case 'wheelUp': {
					scrollBy(-WHEEL_STEP);
					break;
				}

				case 'wheelDown': {
					scrollBy(WHEEL_STEP);
					break;
				}

				case 'press': {
					const geometry = geometryRef.current;
					const column = event.x - 1;
					const row = event.y - 1;
					if (
						event.button === 'left' &&
						column >= geometry.x - 1 &&
						column <= geometry.x &&
						row >= geometry.y &&
						row < geometry.y + geometry.height
					) {
						draggingRef.current = true;
						scrollToRow(row);
					}

					break;
				}

				case 'drag': {
					if (draggingRef.current) {
						scrollToRow(event.y - 1);
					}

					break;
				}

				case 'release': {
					draggingRef.current = false;
					break;
				}

				default: {
					break;
				}
			}
		},
		{isActive: mouseActive},
	);

	useEffect(() => {
		if (!mouseActive) {
			draggingRef.current = false;
		}
	}, [mouseActive]);

	const contentWidth = Math.max(1, width - 1);

	return (
		<Box
			ref={rowRef}
			flexDirection="row"
			flexGrow={1}
			flexShrink={1}
			flexBasis={0}
			width={width}
			overflow="hidden"
		>
			<Box
				ref={viewportRef}
				flexDirection="column"
				justifyContent={anchorBottom ? 'flex-end' : 'flex-start'}
				flexGrow={1}
				flexShrink={1}
				width={contentWidth}
				overflow="hidden"
			>
				<Box
					ref={innerRef}
					flexDirection="column"
					flexShrink={0}
					marginTop={marginTop}
					width={contentWidth}
				>
					{visibleItems.map((item, k) => (
						<Box
							key={start + k}
							flexDirection="column"
							flexShrink={0}
							width={contentWidth}
						>
							{renderItem(item, start + k)}
						</Box>
					))}
					{hasFooter && (
						<Box
							key="__footer__"
							flexDirection="column"
							flexShrink={0}
							width={contentWidth}
						>
							{footer}
						</Box>
					)}
				</Box>
			</Box>
			<Scrollbar
				height={viewportHeight}
				contentHeight={contentHeight}
				scrollTop={scrollTop}
				thumbColor={thumbColor}
				trackColor={trackColor}
			/>
		</Box>
	);
}
