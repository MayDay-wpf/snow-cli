/* eslint-disable @typescript-eslint/triple-slash-reference */
/// <reference path="../vendor/ink/src/vendor-types.d.ts" />
/// <reference path="../vendor/ink/src/global.d.ts" />
/* eslint-enable @typescript-eslint/triple-slash-reference */

import {PassThrough} from 'node:stream';
import ansiEscapes from 'ansi-escapes';
import anyTest, {type TestFn} from 'ava';
import Ink, {getRenderAction, type Options} from '../vendor/ink/src/ink.js';

const test = anyTest as unknown as TestFn;

type Frame = {
	output: string;
	outputHeight: number;
	staticOutput: string;
};

type TestInk = {
	renderFrame: () => Frame;
	onRender: () => void;
	unsubscribeExit: () => void;
	cursorRegistration?: {
		nodeRef: {
			current: {
				yogaNode: {
					getComputedLeft: () => number;
					getComputedTop: () => number;
				};
				parentNode?: undefined;
			};
		};
		offsetX: number;
		offsetY: number;
	};
};

class FakeTty extends PassThrough {
	rows = 3;
	columns = 40;
	readonly writes: string[] = [];

	override write(chunk: any, ...args: any[]): boolean {
		this.writes.push(String(chunk));
		return super.write(chunk, ...args);
	}
}

const createInk = () => {
	const stdout = new FakeTty();
	const stdin = new PassThrough();
	const stderr = new FakeTty();
	const ink = new Ink({
		stdout: stdout as unknown as NodeJS.WriteStream,
		stdin: stdin as unknown as NodeJS.ReadStream,
		stderr: stderr as unknown as NodeJS.WriteStream,
		debug: false,
		exitOnCtrlC: false,
		patchConsole: false,
	} satisfies Options) as unknown as TestInk;

	const render = (frame: Frame) => {
		ink.renderFrame = () => frame;
		ink.onRender();
	};

	const close = () => {
		ink.unsubscribeExit();
		stdout.destroy();
		stdin.destroy();
		stderr.destroy();
	};

	return {ink, stdout, render, close};
};

test('fullscreen render decision skips identical frames but preserves cursor updates', t => {
	t.is(
		getRenderAction({
			isFullscreen: true,
			wasFullscreen: true,
			hasStaticOutput: false,
			outputChanged: false,
			cursorDirty: false,
		}),
		'skip',
	);
	t.is(
		getRenderAction({
			isFullscreen: true,
			wasFullscreen: true,
			hasStaticOutput: false,
			outputChanged: false,
			cursorDirty: true,
		}),
		'log',
	);
});

test('identical fullscreen frames do not repeatedly erase the screen', t => {
	const {stdout, render, close} = createInk();
	try {
		render({output: 'a\nb\nc', outputHeight: 3, staticOutput: ''});
		render({output: 'a\nb\nc', outputHeight: 3, staticOutput: ''});

		t.is(
			stdout.writes.filter(write => write.includes(ansiEscapes.eraseScreen))
				.length,
			1,
		);
		t.false(stdout.writes.join('').includes(ansiEscapes.clearTerminal));
	} finally {
		close();
	}
});

test('changed fullscreen frames preserve Static scrollback and render incrementally', t => {
	const {stdout, render, close} = createInk();
	try {
		render({output: 'a\nb\nc', outputHeight: 3, staticOutput: 'static\n'});
		const beforeChangedFrame = stdout.writes.length;
		render({output: 'a\nb\nd', outputHeight: 3, staticOutput: ''});

		const joined = stdout.writes.join('');
		const changedFrameWrites = stdout.writes.slice(beforeChangedFrame).join('');
		t.true(joined.indexOf('static\n') < joined.indexOf('a\nb\nc'));
		t.false(joined.includes(ansiEscapes.clearTerminal));
		t.true(changedFrameWrites.includes(ansiEscapes.eraseLines(4)));
		t.true(changedFrameWrites.includes('a\nb\nd'));
	} finally {
		close();
	}
});

test('fullscreen and regular transitions force safe redraws, including resize', t => {
	const {stdout, render, close} = createInk();
	try {
		render({output: 'full', outputHeight: 3, staticOutput: ''});
		render({output: 'regular', outputHeight: 1, staticOutput: ''});
		render({output: 'full-again', outputHeight: 3, staticOutput: ''});

		stdout.rows = 1;
		render({output: 'full-again', outputHeight: 1, staticOutput: ''});

		t.is(
			stdout.writes.filter(write => write.includes(ansiEscapes.eraseScreen))
				.length,
			4,
		);
		t.false(stdout.writes.join('').includes(ansiEscapes.clearTerminal));
	} finally {
		close();
	}
});

test('static output is emitted before a regular dynamic frame', t => {
	const {stdout, render, close} = createInk();
	try {
		render({output: 'dynamic', outputHeight: 1, staticOutput: 'first\n'});

		const staticIndex = stdout.writes.findIndex(write =>
			write.includes('first'),
		);
		const dynamicIndex = stdout.writes.findIndex(write =>
			write.includes('dynamic'),
		);
		t.true(staticIndex >= 0);
		t.true(dynamicIndex > staticIndex);
	} finally {
		close();
	}
});

test('fifty changed fullscreen frames use one screen erase and finish latest', t => {
	const {stdout, render, close} = createInk();
	try {
		for (let index = 0; index < 50; index++) {
			render({
				output: `top\nmiddle\nframe-${index}`,
				outputHeight: 3,
				staticOutput: '',
			});
		}

		t.is(
			stdout.writes.filter(write => write.includes(ansiEscapes.eraseScreen))
				.length,
			1,
		);
		t.false(stdout.writes.join('').includes(ansiEscapes.clearTerminal));
		t.true(stdout.writes.at(-1)?.includes('frame-49'));
	} finally {
		close();
	}
});

test('identical fullscreen output with Static rebuilds the dynamic region', t => {
	const {stdout, render, close} = createInk();
	try {
		render({output: 'a\nb\nc', outputHeight: 3, staticOutput: ''});
		const writesBeforeStatic = stdout.writes.length;
		render({output: 'a\nb\nc', outputHeight: 3, staticOutput: 'committed\n'});

		const writes = stdout.writes.slice(writesBeforeStatic).join('');
		t.true(writes.includes('committed'));
		t.false(writes.includes(ansiEscapes.clearTerminal));
		t.true(writes.includes('a\nb\nc'));
	} finally {
		close();
	}
});

for (const [label, y] of [
	['top', 0],
	['middle', 1],
	['bottom', 2],
] as const) {
	test(`cursor-only update after direct fullscreen redraw targets ${label}`, t => {
		const {ink, stdout, render, close} = createInk();
		try {
			render({output: 'a\nb\nc', outputHeight: 3, staticOutput: ''});
			const beforeCursor = stdout.writes.length;
			ink.cursorRegistration = {
				nodeRef: {
					current: {
						yogaNode: {
							getComputedLeft: () => 2,
							getComputedTop: () => y,
						},
					},
				},
				offsetX: 0,
				offsetY: 0,
			};
			render({output: 'a\nb\nc', outputHeight: 3, staticOutput: ''});

			const cursorWrite = stdout.writes.slice(beforeCursor).join('');
			t.true(cursorWrite.includes(ansiEscapes.cursorUp(3 - y)));
			t.true(cursorWrite.includes(ansiEscapes.cursorTo(2)));
		} finally {
			close();
		}
	});
}

test('queued regular trailing frame cannot overwrite a direct fullscreen frame', async t => {
	const {stdout, render, close} = createInk();
	try {
		render({output: 'regular-0', outputHeight: 1, staticOutput: ''});
		render({output: 'stale-regular', outputHeight: 1, staticOutput: ''});
		render({output: 'new\nfull\nscreen', outputHeight: 3, staticOutput: ''});
		const fullscreenIndex = stdout.writes.findIndex(write =>
			write.includes(ansiEscapes.eraseScreen + ansiEscapes.cursorTo(0, 0)),
		);

		await new Promise(resolve => setTimeout(resolve, 20));
		t.true(fullscreenIndex >= 0);
		t.false(
			stdout.writes
				.slice(fullscreenIndex + 1)
				.join('')
				.includes('stale-regular'),
		);
	} finally {
		close();
	}
});

test('resize forces redraw when fullscreen output is unchanged', t => {
	const {stdout, render, close} = createInk();
	try {
		render({output: 'a\nb\nc', outputHeight: 3, staticOutput: ''});
		stdout.columns = 39;
		render({output: 'a\nb\nc', outputHeight: 3, staticOutput: ''});

		t.is(
			stdout.writes.filter(write => write.includes(ansiEscapes.eraseScreen))
				.length,
			2,
		);
		t.false(stdout.writes.join('').includes(ansiEscapes.clearTerminal));
	} finally {
		close();
	}
});
