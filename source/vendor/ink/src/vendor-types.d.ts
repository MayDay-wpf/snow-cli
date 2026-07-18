// Type shims for Ink's third-party dependencies that don't ship their own
// declarations or were removed when we vendored Ink.

declare module 'react-reconciler' {
	const createReconciler: any;
	export default createReconciler;
	export type Fiber = any;
	export type FiberRoot = any;
}
declare module 'react-reconciler/constants.js' {
	export const DefaultEventPriority: number;
}

declare module 'es-toolkit/compat' {
	export function throttle<T extends (...args: any[]) => any>(
		func: T,
		wait?: number,
		options?: {leading?: boolean; trailing?: boolean},
	): T;
}

declare module 'auto-bind' {
	function autoBind<T extends object>(self: T): T;
	export default autoBind;
}

declare module 'signal-exit' {
	export function onExit(
		callback: (code: number | null, signal: string | null) => void,
		options?: {alwaysLast?: boolean},
	): () => void;
}

declare module 'patch-console' {
	function patchConsole(
		callback: (stream: 'stdout' | 'stderr', data: string) => void,
	): () => void;
	export default patchConsole;
}

declare module 'cli-cursor' {
	export function show(stream?: NodeJS.WriteStream): void;
	export function hide(stream?: NodeJS.WriteStream): void;
}

declare module 'cli-boxes' {
	export interface BoxStyle {
		topLeft: string;
		top: string;
		topRight: string;
		right: string;
		bottomRight: string;
		bottom: string;
		bottomLeft: string;
		left: string;
	}
	export interface Boxes {
		single: BoxStyle;
		double: BoxStyle;
		round: BoxStyle;
		bold: BoxStyle;
		singleDouble: BoxStyle;
		doubleSingle: BoxStyle;
		classic: BoxStyle;
		arrow: BoxStyle;
		[key: string]: BoxStyle;
	}
	const boxes: Boxes;
	export default boxes;
}

declare module 'is-in-ci' {
	const isInCi: boolean;
	export default isInCi;
}

declare module 'wrap-ansi' {
	function wrapAnsi(
		text: string,
		columns: number,
		options?: {hard?: boolean; trim?: boolean; wordWrap?: boolean},
	): string;
	export default wrapAnsi;
}

declare module 'widest-line' {
	function widestLine(text: string): number;
	export default widestLine;
}

declare module 'slice-ansi' {
	function sliceAnsi(
		text: string,
		beginSlice: number,
		endSlice?: number,
	): string;
	export default sliceAnsi;
}

declare module 'stack-utils' {
	class StackUtils {
		constructor(options?: {cwd?: string; internals?: RegExp[]});
		static nodeInternals(): RegExp[];
		clean(stack: string): string;
		parseLine(line: string): any;
	}
	export default StackUtils;
}

declare module '@alcalzone/ansi-tokenize' {
	export interface StyledChar {
		type: 'char';
		value: string;
		fullWidth: boolean;
		styles: any[];
	}
	export function tokenize(text: string): any[];
	export function styledCharsFromTokens(tokens: any[]): StyledChar[];
	export function styledCharsToString(chars: StyledChar[]): string;
}
