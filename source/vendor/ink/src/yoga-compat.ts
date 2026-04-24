/**
 * Drop-in replacement for `yoga-layout` WASM package.
 * Uses pure TypeScript implementation — no WASM, no linear memory growth,
 * regular JS GC applies.
 */
import YogaEngine, {
	type Node,
	Align,
	Direction,
	Display,
	Edge,
	FlexDirection,
	Gutter,
	Justify,
	MeasureMode,
	Overflow,
	PositionType,
	Wrap,
} from './yoga-ts/index.js';

export type {Node as Node};

const Yoga = {
	Node: YogaEngine.Node,

	DIRECTION_LTR: Direction.LTR,

	EDGE_LEFT: Edge.Left,
	EDGE_TOP: Edge.Top,
	EDGE_RIGHT: Edge.Right,
	EDGE_BOTTOM: Edge.Bottom,
	EDGE_START: Edge.Start,
	EDGE_END: Edge.End,
	EDGE_HORIZONTAL: Edge.Horizontal,
	EDGE_VERTICAL: Edge.Vertical,
	EDGE_ALL: Edge.All,

	DISPLAY_FLEX: Display.Flex,
	DISPLAY_NONE: Display.None,

	POSITION_TYPE_ABSOLUTE: PositionType.Absolute,
	POSITION_TYPE_RELATIVE: PositionType.Relative,

	FLEX_DIRECTION_ROW: FlexDirection.Row,
	FLEX_DIRECTION_ROW_REVERSE: FlexDirection.RowReverse,
	FLEX_DIRECTION_COLUMN: FlexDirection.Column,
	FLEX_DIRECTION_COLUMN_REVERSE: FlexDirection.ColumnReverse,

	ALIGN_AUTO: Align.Auto,
	ALIGN_FLEX_START: Align.FlexStart,
	ALIGN_CENTER: Align.Center,
	ALIGN_FLEX_END: Align.FlexEnd,
	ALIGN_STRETCH: Align.Stretch,

	JUSTIFY_FLEX_START: Justify.FlexStart,
	JUSTIFY_CENTER: Justify.Center,
	JUSTIFY_FLEX_END: Justify.FlexEnd,
	JUSTIFY_SPACE_BETWEEN: Justify.SpaceBetween,
	JUSTIFY_SPACE_AROUND: Justify.SpaceAround,
	JUSTIFY_SPACE_EVENLY: Justify.SpaceEvenly,

	WRAP_NO_WRAP: Wrap.NoWrap,
	WRAP_WRAP: Wrap.Wrap,
	WRAP_WRAP_REVERSE: Wrap.WrapReverse,

	GUTTER_ALL: Gutter.All,
	GUTTER_COLUMN: Gutter.Column,
	GUTTER_ROW: Gutter.Row,

	OVERFLOW_HIDDEN: Overflow.Hidden,
	OVERFLOW_VISIBLE: Overflow.Visible,

	MEASURE_MODE_UNDEFINED: MeasureMode.Undefined,
	MEASURE_MODE_EXACTLY: MeasureMode.Exactly,
	MEASURE_MODE_AT_MOST: MeasureMode.AtMost,
};

export default Yoga;
