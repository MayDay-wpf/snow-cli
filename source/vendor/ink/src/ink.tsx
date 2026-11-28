import process from 'node:process';
import React, {type ReactNode} from 'react';
import {throttle} from 'es-toolkit/compat';
import ansiEscapes from 'ansi-escapes';
import isInCi from 'is-in-ci';
import autoBind from 'auto-bind';
import {onExit as signalExit} from 'signal-exit';
import patchConsole from 'patch-console';
import {type FiberRoot} from 'react-reconciler';
import Yoga from './yoga-compat.js';
import reconciler from './reconciler.js';
import createRenderer from './renderer.js';
import * as dom from './dom.js';
import logUpdate, {type LogUpdate, writeSafely} from './log-update.js';
import instances from './instances.js';
import App from './components/App.js';
import {type CursorRegistration} from './components/CursorContext.js';
import {type DOMElement} from './dom.js';
import {
	ENTER_FULLSCREEN_SEQUENCE,
	LEAVE_FULLSCREEN_SEQUENCE,
	buildFullScreenFrame,
	createFullScreenFrameState,
	registerFullScreenController,
	type FullScreenFrameState,
} from './fullscreen.js';

const noop = () => {};

/**
 * Switch the Ink instance bound to `stdout` into full-screen mode
 * (alternate screen + mouse tracking + differential repaint).
 */
export function enterFullScreen(
	stdout: NodeJS.WriteStream = process.stdout,
): void {
	instances.get(stdout)?.enterFullScreen();
}

/**
 * Leave full-screen mode and return to the normal inline renderer.
 */
export function leaveFullScreen(
	stdout: NodeJS.WriteStream = process.stdout,
): void {
	instances.get(stdout)?.leaveFullScreen();
}

/**
 * Force a full repaint of the full-screen frame (no-op in inline mode).
 */
export function requestFullScreenRepaint(
	stdout: NodeJS.WriteStream = process.stdout,
): void {
	instances.get(stdout)?.requestFullScreenRepaint();
}

export function isFullScreenActive(
	stdout: NodeJS.WriteStream = process.stdout,
): boolean {
	return instances.get(stdout)?.isFullScreen ?? false;
}

export type Options = {
	stdout: NodeJS.WriteStream;
	stdin: NodeJS.ReadStream;
	stderr: NodeJS.WriteStream;
	debug: boolean;
	exitOnCtrlC: boolean;
	patchConsole: boolean;
	waitUntilExit?: () => Promise<void>;
};

/**
 * Clear accumulated fullStaticOutput for the Ink instance bound to
 * the given stdout stream.  Used by /clear to reclaim memory.
 */
export function clearInkStaticOutput(stdout: NodeJS.WriteStream): void {
	const instance = instances.get(stdout);
	if (instance) {
		instance.fullStaticOutput = '';
		instance.lastOutput = '';
	}
}

export default class Ink {
	private readonly options: Options;
	private readonly log: LogUpdate;
	private readonly throttledLog: LogUpdate;
	// Ignore last render after unmounting a tree to prevent empty output before exit
	private isUnmounted: boolean;
	lastOutput: string;
	private readonly container: FiberRoot;
	private readonly rootNode: dom.DOMElement;
	private readonly renderFrame: () => {
		output: string;
		outputHeight: number;
		staticOutput: string;
	};
	fullStaticOutput: string;
	private exitPromise?: Promise<void>;
	private restoreConsole?: () => void;
	private readonly unsubscribeResize?: () => void;
	private cursorRegistration?: CursorRegistration;
	isFullScreen = false;
	private fullScreenFrame: FullScreenFrameState = createFullScreenFrameState();

	constructor(options: Options) {
		autoBind(this);

		this.options = options;
		this.rootNode = dom.createNode('ink-root');
		this.renderFrame = createRenderer(this.rootNode);
		this.rootNode.onComputeLayout = this.calculateLayout;

		this.rootNode.onRender = options.debug
			? this.onRender
			: throttle(this.onRender, 32, {
					leading: true,
					trailing: true,
			  });

		this.rootNode.onImmediateRender = this.onRender;
		this.log = logUpdate.create(options.stdout);
		this.throttledLog = options.debug
			? this.log
			: (throttle(this.log, undefined, {
					leading: true,
					trailing: true,
			  }) as unknown as LogUpdate);

		// Ignore last render after unmounting a tree to prevent empty output before exit
		this.isUnmounted = false;

		// Store last output to only rerender when needed
		this.lastOutput = '';

		// This variable is used only in debug mode to store full static output
		// so that it's rerendered every time, not just new static parts, like in non-debug mode
		this.fullStaticOutput = '';

		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		this.container = reconciler.createContainer(
			this.rootNode,
			// Legacy mode
			0,
			null,
			false,
			null,
			'id',
			() => {},
			null,
		);

		// Unmount when process exits
		this.unsubscribeExit = signalExit(this.unmount, {alwaysLast: false});

		if (process.env['DEV'] === 'true') {
			reconciler.injectIntoDevTools({
				bundleType: 0,
				// Reporting React DOM's version, not Ink's
				// See https://github.com/facebook/react/issues/16666#issuecomment-532639905
				version: '16.13.1',
				rendererPackageName: 'ink',
			});
		}

		if (options.patchConsole) {
			this.patchConsole();
		}

		if (!isInCi) {
			options.stdout.on('resize', this.resized);

			this.unsubscribeResize = () => {
				options.stdout.off('resize', this.resized);
			};
		}
	}

	resized = () => {
		if (this.isFullScreen) {
			this.fullScreenFrame.needsClear = true;
		}

		this.calculateLayout();
		this.onRender();
	};

	enterFullScreen = (): void => {
		if (this.isFullScreen || this.isUnmounted || isInCi || this.options.debug) {
			return;
		}

		if (!this.options.stdout.isTTY) {
			return;
		}

		// Drop any pending trailing inline render so it can't leak into the
		// alternate screen.
		(this.throttledLog as unknown as {cancel?: () => void}).cancel?.();
		// Erase inline dynamic output from the main screen so it is clean when
		// we come back.
		this.log.clear();

		this.isFullScreen = true;
		this.fullScreenFrame = createFullScreenFrameState();
		this.lastOutput = '';
		writeSafely(this.options.stdout, ENTER_FULLSCREEN_SEQUENCE);

		registerFullScreenController({
			isActive: () => this.isFullScreen,
			requestRepaint: this.requestFullScreenRepaint,
			// Used on abrupt process exit: restore the main screen without
			// re-rendering the inline frame on top of the user's shell.
			leave: () => {
				if (!this.isFullScreen) {
					return;
				}

				this.isFullScreen = false;
				registerFullScreenController(undefined);
				writeSafely(this.options.stdout, LEAVE_FULLSCREEN_SEQUENCE);
				this.lastOutput = '';
			},
		});

		this.calculateLayout();
		this.onRender();
	};

	leaveFullScreen = (): void => {
		if (!this.isFullScreen) {
			return;
		}

		this.isFullScreen = false;
		registerFullScreenController(undefined);
		writeSafely(this.options.stdout, LEAVE_FULLSCREEN_SEQUENCE + '\u001B[?25l');
		this.lastOutput = '';
		this.fullScreenFrame = createFullScreenFrameState();

		if (!this.isUnmounted) {
			this.calculateLayout();
			this.onRender();
		}
	};

	requestFullScreenRepaint = (): void => {
		if (!this.isFullScreen) {
			return;
		}

		this.fullScreenFrame.needsClear = true;
		this.onRender();
	};

	private renderFullScreen(
		output: string,
		cursor: {x: number; y: number} | undefined,
	): void {
		const rows = this.options.stdout.rows || 24;
		const {sequence} = buildFullScreenFrame(
			this.fullScreenFrame,
			output,
			rows,
			cursor,
		);
		if (sequence) {
			writeSafely(this.options.stdout, sequence);
		}

		this.lastOutput = output;
	}

	resolveExitPromise: () => void = () => {};
	rejectExitPromise: (reason?: Error) => void = () => {};
	unsubscribeExit: () => void = () => {};

	registerCursor = (registration: CursorRegistration | undefined): void => {
		this.cursorRegistration = registration;
	};

	private getAbsolutePosition(node: DOMElement): {x: number; y: number} {
		let x = 0;
		let y = 0;
		let current: DOMElement | undefined = node;
		while (current?.yogaNode) {
			x += current.yogaNode.getComputedLeft();
			y += current.yogaNode.getComputedTop();
			current = current.parentNode as DOMElement | undefined;
		}
		return {x, y};
	}

	calculateLayout = () => {
		// The 'columns' property can be undefined or 0 when not using a TTY.
		// In that case we fall back to 80.
		const terminalWidth = this.options.stdout.columns || 80;

		this.rootNode.yogaNode!.setWidth(terminalWidth);

		this.rootNode.yogaNode!.calculateLayout(
			undefined,
			undefined,
			Yoga.DIRECTION_LTR,
		);
	};

	onRender: () => void = () => {
		if (this.isUnmounted) {
			return;
		}

		const {output, outputHeight, staticOutput} = this.renderFrame();

		if (this.isFullScreen) {
			// <Static> output has no place in full-screen mode (there is no
			// scrollback to append to); it is intentionally discarded.
			let cursor: {x: number; y: number} | undefined;
			if (this.cursorRegistration) {
				const {nodeRef, offsetX, offsetY} = this.cursorRegistration;
				if (nodeRef.current?.yogaNode) {
					const abs = this.getAbsolutePosition(nodeRef.current);
					cursor = {x: abs.x + offsetX, y: abs.y + offsetY};
				}
			}

			this.renderFullScreen(output, cursor);
			return;
		}

		// Resolve cursor position from registration after layout computation
		if (this.cursorRegistration) {
			const {nodeRef, offsetX, offsetY} = this.cursorRegistration;
			if (nodeRef.current?.yogaNode) {
				const abs = this.getAbsolutePosition(nodeRef.current);
				this.log.setCursorPosition({
					x: abs.x + offsetX,
					y: abs.y + offsetY,
				});
			} else {
				this.log.setCursorPosition(undefined);
			}
		} else {
			this.log.setCursorPosition(undefined);
		}

		// If <Static> output isn't empty, it means new children have been added to it
		const hasStaticOutput = staticOutput && staticOutput !== '\n';

		if (this.options.debug) {
			if (hasStaticOutput) {
				this.fullStaticOutput += staticOutput;
			}

			writeSafely(this.options.stdout, this.fullStaticOutput + output);
			return;
		}

		if (isInCi) {
			if (hasStaticOutput) {
				writeSafely(this.options.stdout, staticOutput);
			}

			this.lastOutput = output;
			return;
		}

		// Static content is written directly to the terminal's scrollback buffer.
		// We intentionally do NOT accumulate it in fullStaticOutput because that
		// string grows without bound and is the #1 source of memory leaks in
		// long-running sessions.  The only code path that previously consumed
		// fullStaticOutput (outputHeight >= rows) now simply clears + re-renders
		// the dynamic portion only — the static text is already in scrollback.

		if (outputHeight >= this.options.stdout.rows) {
			if (hasStaticOutput) {
				writeSafely(this.options.stdout, staticOutput);
			}
			writeSafely(this.options.stdout, ansiEscapes.clearTerminal + output);
			this.lastOutput = output;
			return;
		}

		if (hasStaticOutput) {
			this.log.clear();
			writeSafely(this.options.stdout, staticOutput);
			this.log(output);
		}

		if (!hasStaticOutput) {
			if (output !== this.lastOutput) {
				this.throttledLog(output);
			} else if (this.log.isCursorDirty()) {
				this.log(output);
			}
		}

		this.lastOutput = output;
	};

	render(node: ReactNode): void {
		const tree = (
			<App
				stdin={this.options.stdin}
				stdout={this.options.stdout}
				stderr={this.options.stderr}
				writeToStdout={this.writeToStdout}
				writeToStderr={this.writeToStderr}
				exitOnCtrlC={this.options.exitOnCtrlC}
				onExit={this.unmount}
				registerCursor={this.registerCursor}
			>
				{node}
			</App>
		);

		reconciler.updateContainer(tree, this.container, null, noop);
	}

	writeToStdout(data: string): void {
		if (this.isUnmounted) {
			return;
		}

		if (this.options.debug) {
			writeSafely(
				this.options.stdout,
				data + this.fullStaticOutput + this.lastOutput,
			);
			return;
		}

		if (isInCi) {
			writeSafely(this.options.stdout, data);
			return;
		}

		if (this.isFullScreen) {
			// Raw console output would corrupt the alternate screen and there
			// is no scrollback to keep it in. Drop it.
			return;
		}

		this.log.clear();
		writeSafely(this.options.stdout, data);
		this.log(this.lastOutput);
	}

	writeToStderr(data: string): void {
		if (this.isUnmounted) {
			return;
		}

		if (this.options.debug) {
			writeSafely(this.options.stderr, data);
			writeSafely(this.options.stdout, this.fullStaticOutput + this.lastOutput);
			return;
		}

		if (isInCi) {
			writeSafely(this.options.stderr, data);
			return;
		}

		if (this.isFullScreen) {
			// stderr shares the same terminal; writing would corrupt the frame.
			return;
		}

		this.log.clear();
		writeSafely(this.options.stderr, data);
		this.log(this.lastOutput);
	}

	// eslint-disable-next-line @typescript-eslint/ban-types
	unmount(error?: Error | number | null): void {
		if (this.isUnmounted) {
			return;
		}

		this.calculateLayout();
		this.onRender();
		this.unsubscribeExit();

		if (typeof this.restoreConsole === 'function') {
			this.restoreConsole();
		}

		if (typeof this.unsubscribeResize === 'function') {
			this.unsubscribeResize();
		}

		if (this.isFullScreen) {
			// Restore the main screen (and its scrollback) before exiting.
			this.isFullScreen = false;
			registerFullScreenController(undefined);
			writeSafely(this.options.stdout, LEAVE_FULLSCREEN_SEQUENCE);
			this.lastOutput = '';
		}

		// CIs don't handle erasing ansi escapes well, so it's better to
		// only render last frame of non-static output
		if (isInCi) {
			writeSafely(this.options.stdout, this.lastOutput + '\n');
		} else if (!this.options.debug) {
			this.log.done();
		}

		this.isUnmounted = true;
		this.fullStaticOutput = '';
		this.lastOutput = '';

		reconciler.updateContainer(null, this.container, null, noop);
		instances.delete(this.options.stdout);

		if (error instanceof Error) {
			this.rejectExitPromise(error);
		} else {
			this.resolveExitPromise();
		}
	}

	async waitUntilExit(): Promise<void> {
		this.exitPromise ||= new Promise((resolve, reject) => {
			this.resolveExitPromise = resolve;
			this.rejectExitPromise = reject;
		});

		return this.exitPromise;
	}

	clear(): void {
		if (!isInCi && !this.options.debug) {
			this.log.clear();
		}
	}

	patchConsole(): void {
		if (this.options.debug) {
			return;
		}

		this.restoreConsole = patchConsole((stream, data) => {
			if (stream === 'stdout') {
				this.writeToStdout(data);
			}

			if (stream === 'stderr') {
				const isReactMessage = data.startsWith('The above error occurred');

				if (!isReactMessage) {
					this.writeToStderr(data);
				}
			}
		});
	}
}
