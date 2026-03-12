import {execFileSync} from 'child_process';

function runClipboardCommand(
	command: string,
	args: string[],
	input: string | Buffer,
): void {
	const inputSize = Buffer.isBuffer(input)
		? input.length
		: Buffer.byteLength(input, 'utf8');

	execFileSync(command, args, {
		input,
		stdio: ['pipe', 'ignore', 'pipe'],
		windowsHide: true,
		maxBuffer: Math.max(1024 * 1024, inputSize + 1024),
	});
}

function sleep(milliseconds: number): void {
	const endTime = Date.now() + milliseconds;
	while (Date.now() < endTime) {
		// Busy wait for short clipboard retry backoff.
	}
}

function getClipboardErrorMessage(error: Error): string {
	const stderr = (error as Error & {stderr?: Buffer | string}).stderr;

	if (typeof stderr === 'string' && stderr.trim()) {
		return stderr.trim();
	}

	if (Buffer.isBuffer(stderr) && stderr.length > 0) {
		const stderrText = stderr.toString('utf8').trim();
		if (stderrText) {
			return stderrText;
		}
	}

	return error.message;
}

function isClipboardToolMissing(errorMsg: string): boolean {
	return (
		errorMsg.includes('command not found') ||
		errorMsg.includes('not found') ||
		errorMsg.includes('spawn ENOENT') ||
		/spawn.*not found/.test(errorMsg)
	);
}

function isClipboardPermissionError(errorMsg: string): boolean {
	return (
		errorMsg.includes('EACCES') ||
		errorMsg.includes('EPERM') ||
		errorMsg.includes('Access denied') ||
		errorMsg.includes('permission denied') ||
		errorMsg.includes('Permission denied')
	);
}

function shouldRetryWindowsClipboard(errorMsg: string): boolean {
	const normalizedMessage = errorMsg.toLowerCase();

	return (
		normalizedMessage.includes('clipboard') ||
		normalizedMessage.includes('externalexception') ||
		normalizedMessage.includes('openclipboard') ||
		normalizedMessage.includes('0x800401d0') ||
		normalizedMessage.includes('currently unavailable')
	);
}

function copyToWindowsClipboard(content: string): void {
	const formsClipboardScript = [
		"$ErrorActionPreference = 'Stop'",
		'Add-Type -AssemblyName System.Windows.Forms',
		'[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
		'$text = [Console]::In.ReadToEnd()',
		'if ([string]::IsNullOrEmpty($text)) {',
		'  [System.Windows.Forms.Clipboard]::Clear()',
		'} else {',
		'  [System.Windows.Forms.Clipboard]::SetText($text)',
		'}',
	].join('; ');
	const setClipboardScript = [
		"$ErrorActionPreference = 'Stop'",
		'[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)',
		'$text = [Console]::In.ReadToEnd()',
		'Set-Clipboard -Value $text',
	].join('; ');
	const clipInput = Buffer.concat([
		Buffer.from([0xff, 0xfe]),
		Buffer.from(content, 'utf16le'),
	]);
	const attempts: Array<{
		command: string;
		args: string[];
		input: string | Buffer;
		retries: number;
	}> = [
		{
			command: 'powershell',
			args: ['-NoProfile', '-STA', '-Command', formsClipboardScript],
			input: content,
			retries: 3,
		},
		{
			command: 'powershell',
			args: ['-NoProfile', '-Command', setClipboardScript],
			input: content,
			retries: 2,
		},
		{
			command: 'clip',
			args: [],
			input: clipInput,
			retries: 1,
		},
	];
	let lastError: Error | undefined;

	for (const attempt of attempts) {
		for (let retryIndex = 0; retryIndex < attempt.retries; retryIndex++) {
			try {
				runClipboardCommand(attempt.command, attempt.args, attempt.input);
				return;
			} catch (error) {
				if (!(error instanceof Error)) {
					throw error;
				}

				lastError = error;
				const errorMsg = getClipboardErrorMessage(error);

				if (isClipboardToolMissing(errorMsg)) {
					break;
				}

				if (
					retryIndex < attempt.retries - 1 &&
					shouldRetryWindowsClipboard(errorMsg)
				) {
					sleep(80 * (retryIndex + 1));
					continue;
				}

				break;
			}
		}
	}

	if (lastError) {
		throw lastError;
	}

	throw new Error('Failed to copy to clipboard: Unknown error');
}

/**
 * Copy content to clipboard using platform-specific method.
 * Pipes the original text to native clipboard tools to avoid shell escaping and truncation.
 *
 * @param content The string content to copy.
 * @throws Error if clipboard operation fails.
 */
export async function copyToClipboard(content: string): Promise<void> {
	try {
		if (process.platform === 'win32') {
			copyToWindowsClipboard(content);
			return;
		}

		if (process.platform === 'darwin') {
			runClipboardCommand('pbcopy', [], content);
			return;
		}

		try {
			runClipboardCommand('xclip', ['-selection', 'clipboard'], content);
		} catch {
			runClipboardCommand('xsel', ['--clipboard', '--input'], content);
		}
	} catch (error) {
		if (!(error instanceof Error)) {
			throw new Error('Failed to copy to clipboard: Unknown error');
		}

		const errorMsg = getClipboardErrorMessage(error);

		if (isClipboardToolMissing(errorMsg)) {
			let toolName = 'clipboard tool';
			if (process.platform === 'win32') {
				toolName = 'PowerShell/clip.exe';
			} else if (process.platform === 'darwin') {
				toolName = 'pbcopy';
			} else {
				toolName = 'xclip/xsel';
			}

			throw new Error(
				`Clipboard tool not found: ${toolName} is not available. Please install ${toolName}.`,
			);
		}

		if (isClipboardPermissionError(errorMsg)) {
			throw new Error(
				'Permission denied: Cannot access clipboard. Please check your permissions.',
			);
		}

		throw new Error(`Failed to copy to clipboard: ${errorMsg}`);
	}
}
