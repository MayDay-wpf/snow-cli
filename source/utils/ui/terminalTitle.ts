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
		} catch {
			// 某些平台（如部分容器/沙箱）写入 process.title 会失败，忽略
		}
	}

	try {
		stream.write(`\x1b]0;${safeTitle}\x07`);
	} catch {
		// stdout 已关闭或不可写时忽略，避免应用崩溃
	}
}
