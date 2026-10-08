/**
 * 在系统默认浏览器中打开授权链接。
 */

import {spawn} from 'child_process';

/**
 * 构造 Windows 下通过 `cmd start` 打开链接的命令行。
 *
 * 关键点：URL 必须用内层双引号包裹。
 * cmd 会把未加引号的 `&` 当作命令分隔符，导致
 * `...?client_id=xxx&response_type=code&...` 这类授权链接在第一个 `&` 处被截断
 * （表现为 OAuth 服务端返回 invalid_request / 缺少 client_id）。
 * 第一个 `""` 是 `start` 的窗口标题占位，缺少它时带引号的 URL 会被当成标题。
 */
export function buildWindowsStartCommand(url: string): {
	command: string;
	args: string[];
} {
	const quotedUrl = `"${url.replace(/"/g, '%22')}"`;
	return {
		command: 'cmd.exe',
		args: ['/d', '/s', '/c', 'start', '""', quotedUrl],
	};
}

/**
 * 打开外部 URL（不阻塞、失败静默）。
 * 面板会同时展示链接文本，浏览器打不开时用户可手动复制。
 */
export function openExternalUrl(url: string): void {
	const trimmed = url.trim();
	if (!trimmed) {
		return;
	}

	try {
		if (process.platform === 'win32') {
			// windowsVerbatimArguments 保证参数按构造原样传给 cmd（引号不被再处理）
			const {command, args} = buildWindowsStartCommand(trimmed);
			spawn(command, args, {
				detached: true,
				stdio: 'ignore',
				windowsVerbatimArguments: true,
			}).unref();
			return;
		}

		const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
		spawn(command, [trimmed], {detached: true, stdio: 'ignore'}).unref();
	} catch {
		// 打不开浏览器不影响流程：用户可以手动复制链接
	}
}
