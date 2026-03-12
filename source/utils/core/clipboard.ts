import {execFileSync} from 'child_process';

function runClipboardCommand(
	command: string,
	args: string[],
	content: string,
): void {
	execFileSync(command, args, {
		input: content,
		encoding: 'utf-8',
		stdio: ['pipe', 'ignore', 'pipe'],
		windowsHide: true,
		maxBuffer: Math.max(1024 * 1024, Buffer.byteLength(content, 'utf8') + 1024),
	});
}

function getClipboardErrorMessage(error: Error): string {
	const stderr = (error as Error & {stderr?: Buffer | string}).stderr;

	if (typeof stderr === 'string' && stderr.trim()) {
		return stderr.trim();
	}

	if (Buffer.isBuffer(stderr) && stderr.length > 0) {
		return stderr.toString('utf8').trim();
	}

	return error.message;
}

/**
 * Copy content to clipboard using platform-specific method.
 * Pipes the original text to native clipboard tools to avoid shell escaping and truncation.
 *
 * @param content The string content to copy.
 * @throws Error if clipboard operation fails.
 */
export async function copyToClipboard(content: string): Promise<void> {
	return new Promise((resolve, reject) => {
		try {
			if (process.platform === 'win32') {
				runClipboardCommand(
					'powershell',
					[
						'-NoProfile',
						'-Command',
						'[Console]::InputEncoding = [Text.UTF8Encoding]::new($false); $text = [Console]::In.ReadToEnd(); Set-Clipboard -Value $text',
					],
					content,
				);
				resolve();
			} else if (process.platform === 'darwin') {
				runClipboardCommand('pbcopy', [], content);
				resolve();
			} else {
				try {
					runClipboardCommand('xclip', ['-selection', 'clipboard'], content);
					resolve();
				} catch {
					try {
						runClipboardCommand('xsel', ['--clipboard', '--input'], content);
						resolve();
					} catch (fallbackError) {
						throw fallbackError;
					}
				}
			}
		} catch (error) {
			if (!(error instanceof Error)) {
				reject(new Error('Failed to copy to clipboard: Unknown error'));
				return;
			}

			const errorMsg = getClipboardErrorMessage(error);

			if (
				errorMsg.includes('command not found') ||
				errorMsg.includes('not found') ||
				errorMsg.includes('spawn ENOENT') ||
				/spawn.*not found/.test(errorMsg)
			) {
				let toolName = 'clipboard tool';
				if (process.platform === 'win32') {
					toolName = 'PowerShell';
				} else if (process.platform === 'darwin') {
					toolName = 'pbcopy';
				} else {
					toolName = 'xclip/xsel';
				}
				reject(
					new Error(
						`Clipboard tool not found: ${toolName} is not available. Please install ${toolName}.`,
					),
				);
				return;
			}

			if (
				errorMsg.includes('EACCES') ||
				errorMsg.includes('EPERM') ||
				errorMsg.includes('Access denied') ||
				errorMsg.includes('permission denied') ||
				errorMsg.includes('Permission denied')
			) {
				reject(
					new Error(
						'Permission denied: Cannot access clipboard. Please check your permissions.',
					),
				);
				return;
			}

			reject(new Error(`Failed to copy to clipboard: ${errorMsg}`));
		}
	});
}
