import {useEffect} from 'react';
import {useStdout} from 'ink';

/**
 * 设置终端窗口/标签标题，组件卸载时自动清空。
 *
 * 跨平台兼容策略：
 * 1. process.title：Windows 控制台直接生效，类 Unix 上仅修改进程名
 * 2. OSC 转义序列 ESC]0;<title>BEL：所有支持 ANSI 的现代终端
 *    （macOS Terminal/iTerm2、Windows Terminal、Linux 终端、mintty 等）
 *
 * 注意：
 * - 非 TTY 环境（管道、重定向、CI 日志）会跳过，避免污染输出
 * - 退出页面会写入空标题，多数终端会回退到默认值（如 cwd 或 shell 名）
 * - tmux/screen 用户需启用 set-titles on 才能透传到外层终端
 *
 * @param title 要显示的标题；传入空字符串会清空标题
 * @example
 * ```tsx
 * function MyScreen() {
 *   useTerminalTitle('Snow CLI - 设置');
 *   return <Box>...</Box>;
 * }
 * ```
 */
export function useTerminalTitle(title: string): void {
	const {stdout} = useStdout();

	useEffect(() => {
		if (!stdout?.isTTY) return;

		// 保存原 process.title 以便卸载时恢复
		let previousProcessTitle: string | undefined;
		try {
			previousProcessTitle = process.title;
		} catch {
			// 某些受限环境读取 process.title 可能抛错，忽略即可
		}

		// 1. process.title：Windows 控制台直接生效，类 Unix 仅修改进程名
		if (title) {
			try {
				process.title = title;
			} catch {
				// 某些平台（如部分容器/沙箱）写入 process.title 会失败，忽略
			}
		}

		// 2. OSC 序列：所有支持 ANSI 的终端
		try {
			stdout.write(`\x1b]0;${title}\x07`);
		} catch {
			// stdout 已关闭或不可写时忽略，避免应用崩溃
		}

		return () => {
			if (!stdout?.isTTY) return;
			if (previousProcessTitle !== undefined) {
				try {
					process.title = previousProcessTitle;
				} catch {
					// 同上，忽略恢复失败
				}
			}
			try {
				stdout.write('\x1b]0;\x07');
			} catch {
				// 卸载阶段 stdout 可能已关闭，忽略
			}
		};
	}, [stdout, title]);
}
