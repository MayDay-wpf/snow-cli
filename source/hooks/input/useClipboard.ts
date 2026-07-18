import {useCallback} from 'react';
import {exec} from 'child_process';
import {promisify} from 'util';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {logger} from '../../utils/core/logger.js';
import {
	isWSL,
	findPowerShellInWSL,
} from '../../mcp/utils/websearch/browser.utils.js';

// 使用异步 exec 替代 execSync，避免阻塞 React 渲染线程，
// 这样确认剪贴板包含图片后，[image upload...] loading 占位符可以及时显示。
const execAsync = promisify(exec);

export function useClipboard(
	buffer: TextBuffer,
	updateCommandPanelState: (text: string) => void,
	updateFilePickerState: (text: string, cursorPos: number) => void,
	triggerUpdate: () => void,
) {
	const pasteFromClipboard = useCallback(async () => {
		let imageInserted = false;
		let imageLoadingIndicatorShown = false;

		const showImageLoadingIndicator = async () => {
			if (imageLoadingIndicatorShown) {
				return;
			}

			// 只在确认剪贴板包含图片后插入 "[image upload...]" 临时占位符，
			// 避免普通文本粘贴误显示图片上传提示。
			imageLoadingIndicatorShown = true;
			buffer.insertImageLoadingIndicator(true);
			const text = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateCommandPanelState(text);
			updateFilePickerState(text, cursorPos);
			triggerUpdate();

			// 让出事件循环，确保 React 完成至少一次渲染 commit，
			// 否则后续的 await 仍可能在第一次 paint 之前阻塞 UI。
			await new Promise(resolve => setTimeout(resolve, 0));
		};

		const insertClipboardText = (clipboardText: string): boolean => {
			if (!clipboardText) {
				return false;
			}

			buffer.insert(clipboardText);
			const fullText = buffer.getFullText();
			const cursorPos = buffer.getCursorPosition();
			updateCommandPanelState(fullText);
			updateFilePickerState(fullText, cursorPos);
			triggerUpdate();
			return true;
		};

		try {
			const isWslEnv = process.platform === 'linux' && isWSL();
			// Resolve the PowerShell binary. Under WSL with `appendWindowsPath=false`,
			// the bare `powershell.exe` name is not on PATH (Issue #176), so we probe
			// well-known /mnt/c paths via findPowerShellInWSL(). On native Windows we
			// keep using `powershell` (resolved by the OS). If no PowerShell is found
			// in WSL, psCmd stays empty and the Windows/WSL clipboard branch below is
			// skipped, falling through to the Linux text clipboard path.
			let psCmd: string;
			if (isWslEnv) {
				const psPath = findPowerShellInWSL() ?? '';
				// exec()/execAsync() routes the command through a shell. Under WSL
				// that shell is bash, which splits on unquoted whitespace — so a
				// path like "/mnt/c/Program Files/PowerShell/7/pwsh.exe" would be
				// broken into "/mnt/c/Program" + "Files/...". Wrap the path in
				// single quotes (the strongest form of bash quoting) so it is
				// passed verbatim. findPowerShellInWSL() only returns paths from
				// well-known /mnt/c candidates or `which`, neither of which
				// contain single quotes, so this is safe.
				psCmd = psPath ? `'${psPath}'` : '';
			} else {
				psCmd = 'powershell';
			}

			// Try to read image from clipboard
			if (process.platform === 'win32' || (isWslEnv && psCmd)) {
				// Windows / WSL: Use PowerShell to read image from clipboard
				try {
					const probeScript =
						'Add-Type -AssemblyName System.Windows.Forms; ' +
						'$hasImage = [System.Windows.Forms.Clipboard]::ContainsImage(); ' +
						"$textBase64 = ''; " +
						'if (-not $hasImage) { ' +
						'$text = [System.Windows.Forms.Clipboard]::GetText(); ' +
						"if ($null -eq $text) { $text = '' }; " +
						'$textBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text)); ' +
						'}; ' +
						'Write-Output $hasImage; ' +
						'Write-Output $textBase64';
					const encodedProbe = Buffer.from(probeScript, 'utf16le').toString(
						'base64',
					);
					const {stdout: probeStdout} = await execAsync(
						`${psCmd} -NoProfile -EncodedCommand ${encodedProbe}`,
						{
							encoding: 'utf-8',
							timeout: 2000,
							maxBuffer: 10 * 1024 * 1024,
						},
					);
					const [hasImageLine = '', ...textBase64Lines] =
						probeStdout.split(/\r?\n/);
					if (!/^true$/i.test(hasImageLine.trim())) {
						const textBase64 = textBase64Lines.join('').replace(/\s/g, '');
						const clipboardText = textBase64
							? Buffer.from(textBase64, 'base64').toString('utf8')
							: '';
						insertClipboardText(clipboardText);
						return;
					}

					await showImageLoadingIndicator();

					// Optimized PowerShell script with compression for large images
					const psScript =
						'Add-Type -AssemblyName System.Windows.Forms; ' +
						'Add-Type -AssemblyName System.Drawing; ' +
						'$clipboard = [System.Windows.Forms.Clipboard]::GetImage(); ' +
						'if ($clipboard -ne $null) { ' +
						'$ms = New-Object System.IO.MemoryStream; ' +
						'$width = $clipboard.Width; ' +
						'$height = $clipboard.Height; ' +
						'$maxSize = 2048; ' +
						'if ($width -gt $maxSize -or $height -gt $maxSize) { ' +
						'$ratio = [Math]::Min($maxSize / $width, $maxSize / $height); ' +
						'$newWidth = [int]($width * $ratio); ' +
						'$newHeight = [int]($height * $ratio); ' +
						'$resized = New-Object System.Drawing.Bitmap($newWidth, $newHeight); ' +
						'$graphics = [System.Drawing.Graphics]::FromImage($resized); ' +
						'$graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality; ' +
						'$graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic; ' +
						'$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality; ' +
						'$graphics.DrawImage($clipboard, 0, 0, $newWidth, $newHeight); ' +
						'$resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); ' +
						'$graphics.Dispose(); ' +
						'$resized.Dispose(); ' +
						'} else { ' +
						'$clipboard.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); ' +
						'}; ' +
						'$bytes = $ms.ToArray(); ' +
						'$ms.Close(); ' +
						'[Convert]::ToBase64String($bytes); ' +
						'}';

					let base64Raw: string;
					if (isWslEnv) {
						// WSL: bash expands $var inside double-quotes, mangling the script.
						// Use -EncodedCommand (base64 UTF-16LE) to bypass all shell interpretation.
						const encoded = Buffer.from(psScript, 'utf16le').toString('base64');
						const {stdout} = await execAsync(
							`${psCmd} -NoProfile -EncodedCommand ${encoded}`,
							{
								encoding: 'utf-8',
								timeout: 10000,
								maxBuffer: 50 * 1024 * 1024,
							},
						);
						base64Raw = stdout;
					} else {
						const {stdout} = await execAsync(
							`${psCmd} -NoProfile -Command "${psScript}"`,
							{
								encoding: 'utf-8',
								timeout: 10000,
								maxBuffer: 50 * 1024 * 1024,
							},
						);
						base64Raw = stdout;
					}

					// 高效清理：一次性移除所有空白字符
					const base64 = base64Raw.replace(/\s/g, '');

					if (base64 && base64.length > 100) {
						// insertImage 内部会自动移除 "[image upload...]" 占位符
						buffer.insertImage(base64, 'image/png');
						imageInserted = true;
						const text = buffer.getFullText();
						const cursorPos = buffer.getCursorPosition();
						updateCommandPanelState(text);
						updateFilePickerState(text, cursorPos);
						triggerUpdate();
						return;
					}
				} catch (imgError) {
					// No image in clipboard or error, fall through to text
					logger.error(
						'Failed to read image from Windows clipboard:',
						imgError,
					);
				}
			} else if (process.platform === 'darwin') {
				// macOS: Use osascript to read image from clipboard
				try {
					// First check if there's an image in clipboard
					const checkScript = `osascript -e 'try
	set imgData to the clipboard as «class PNGf»
	return "hasImage"
on error
	return "noImage"
end try'`;

					const {stdout: hasImageStdout} = await execAsync(checkScript, {
						encoding: 'utf-8',
						timeout: 2000,
					});
					const hasImage = hasImageStdout.trim();

					if (hasImage === 'hasImage') {
						await showImageLoadingIndicator();
						// Save clipboard image to temporary file and read it
						const tmpFile = `/tmp/snow_clipboard_${Date.now()}.png`;
						const saveScript = `osascript -e 'set imgData to the clipboard as «class PNGf»' -e 'set fileRef to open for access POSIX file "${tmpFile}" with write permission' -e 'write imgData to fileRef' -e 'close access fileRef'`;

						await execAsync(saveScript, {
							encoding: 'utf-8',
							timeout: 3000,
						});

						// Use sips to resize if needed, then convert to base64
						// First check image size
						const {stdout: sizeCheck} = await execAsync(
							`sips -g pixelWidth -g pixelHeight "${tmpFile}" | grep -E "pixelWidth|pixelHeight" | awk '{print $2}'`,
							{
								encoding: 'utf-8',
								timeout: 2000,
							},
						);
						const [widthStr, heightStr] = sizeCheck.trim().split('\n');
						const width = parseInt(widthStr || '0', 10);
						const height = parseInt(heightStr || '0', 10);
						const maxSize = 2048;

						// Resize if too large
						if (width > maxSize || height > maxSize) {
							const ratio = Math.min(maxSize / width, maxSize / height);
							const newWidth = Math.floor(width * ratio);
							const newHeight = Math.floor(height * ratio);
							await execAsync(
								`sips -z ${newHeight} ${newWidth} "${tmpFile}" --out "${tmpFile}"`,
								{
									encoding: 'utf-8',
									timeout: 5000,
								},
							);
						}

						// Read the file as base64 with optimized buffer
						const {stdout: base64Raw} = await execAsync(
							`base64 -i "${tmpFile}"`,
							{
								encoding: 'utf-8',
								timeout: 5000,
								maxBuffer: 50 * 1024 * 1024, // 50MB buffer
							},
						);
						// 高效清理：一次性移除所有空白字符
						const base64 = base64Raw.replace(/\s/g, '');

						// Clean up temp file
						try {
							await execAsync(`rm "${tmpFile}"`, {timeout: 1000});
						} catch (e) {
							// Ignore cleanup errors
						}

						if (base64 && base64.length > 100) {
							// insertImage 内部会自动移除 "[image upload...]" 占位符
							buffer.insertImage(base64, 'image/png');
							imageInserted = true;
							const text = buffer.getFullText();
							const cursorPos = buffer.getCursorPosition();
							updateCommandPanelState(text);
							updateFilePickerState(text, cursorPos);
							triggerUpdate();
							return;
						}
					}
				} catch (imgError) {
					logger.error('Failed to read image from macOS clipboard:', imgError);
				}
			}

			// 没读到图片，移除 loading 占位符再走文本路径，
			// 避免 [image upload...] 留在输入框里。
			buffer.removeTempPlaceholder();

			// If no image, try to read text from clipboard. Windows/WSL usually
			// returned above from the combined probe, so this branch is mainly a
			// fallback for image-probe errors and non-Windows platforms.
			try {
				let clipboardText = '';
				if (process.platform === 'win32' || (isWslEnv && psCmd)) {
					// PowerShell 5.x may emit Get-Clipboard text using the active console
					// code page, which makes Node's utf-8 decoding corrupt Chinese text.
					// Encode the Unicode clipboard text to UTF-8 base64 inside PowerShell,
					// then decode it in Node so non-ASCII paste content is stable.
					const textScript =
						'Add-Type -AssemblyName System.Windows.Forms; ' +
						'$text = [System.Windows.Forms.Clipboard]::GetText(); ' +
						"if ($null -eq $text) { $text = '' }; " +
						'[Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($text))';
					const encoded = Buffer.from(textScript, 'utf16le').toString('base64');
					const {stdout} = await execAsync(
						`${psCmd} -NoProfile -EncodedCommand ${encoded}`,
						{
							encoding: 'utf-8',
							timeout: 2000,
							maxBuffer: 10 * 1024 * 1024,
						},
					);
					clipboardText = Buffer.from(
						stdout.replace(/\s/g, ''),
						'base64',
					).toString('utf8');
				} else if (process.platform === 'darwin') {
					const {stdout} = await execAsync('pbpaste', {
						encoding: 'utf-8',
						timeout: 2000,
					});
					clipboardText = stdout.trim();
				} else {
					const {stdout} = await execAsync('xclip -selection clipboard -o', {
						encoding: 'utf-8',
						timeout: 2000,
					});
					clipboardText = stdout.trim();
				}

				insertClipboardText(clipboardText);
			} catch (textError) {
				logger.error('Failed to read text from clipboard:', textError);
			}
		} catch (error) {
			logger.error('Failed to read from clipboard:', error);
		} finally {
			// 兜底：确保 loading 占位符在任何异常路径下都不会残留
			if (!imageInserted) {
				buffer.removeTempPlaceholder();
				triggerUpdate();
			}
		}
	}, [buffer, updateCommandPanelState, updateFilePickerState, triggerUpdate]);

	return {pasteFromClipboard};
}
