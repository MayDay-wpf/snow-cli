import {useEffect} from 'react';
import {useStdout} from 'ink';

const titleControlCharacters = /[\u0000-\u001F\u007F]/g; // eslint-disable-line no-control-regex

function cleanOscTitle(title: string): string {
	return title
		.replaceAll(titleControlCharacters, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim();
}

/**
 * 设置终端窗口/标签标题，组件卸载时自动清空。
 *
 * 只写 OSC 0；不要碰 process.title。Windows Terminal 顶层窗口标题可能
 * 由宿主加上 Administrator 等前缀，应用层不能也不应该伪装能删掉它。
 */
export function useTerminalTitle(title: string): void {
	const {stdout} = useStdout();

	useEffect(() => {
		if (!stdout?.isTTY) return;

		const safeTitle = cleanOscTitle(title);

		try {
			stdout.write(`\u001B]0;${safeTitle}\u0007`);
		} catch {
			// Stdout 可能已关闭；标题是 best-effort，不能影响 UI。
		}
	}, [stdout, title]);

	useEffect(() => {
		if (!stdout?.isTTY) return;

		return () => {
			try {
				stdout.write('\u001B]0;\u0007');
			} catch {
				// 卸载阶段 stdout 可能已关闭，忽略。
			}
		};
	}, [stdout]);
}
