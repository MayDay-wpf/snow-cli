import {logger} from '../core/logger.js';

const log = logger.child('ui:terminalTitle');

type TerminalTitleStreamLike =
	| Pick<NodeJS.WriteStream, 'write' | 'isTTY'>
	| {
			write: (data: string) => unknown;
			isTTY?: boolean;
	  };

const titleControlCharacters = /[\u0000-\u001F\u007F]/g; // eslint-disable-line no-control-regex

export function cleanTerminalTitle(title: string): string {
	return title
		.replaceAll(titleControlCharacters, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim();
}

export function setTerminalTitle(
	title: string,
	stream: TerminalTitleStreamLike = process.stdout,
): void {
	if (!stream?.isTTY || typeof stream.write !== 'function') {
		return;
	}

	const safeTitle = cleanTerminalTitle(title);

	if (safeTitle) {
		try {
			process.title = safeTitle;
		} catch (e) {
			log.debug('Failed to set process.title in current environment', {
				title: safeTitle,
				error: e instanceof Error ? e.message : String(e),
			});
		}
	}

	try {
		stream.write(`\x1b]0;${safeTitle}\x07`);
	} catch (e) {
		log.debug('Failed to write OSC 0 title sequence to stream', {
			error: e instanceof Error ? e.message : String(e),
		});
	}
}
