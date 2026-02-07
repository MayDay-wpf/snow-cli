import {useCallback} from 'react';
import {execSync} from 'child_process';
import {TextBuffer} from '../../utils/ui/textBuffer.js';
import {logger} from '../../utils/core/logger.js';

export function useClipboard(
	buffer: TextBuffer,
	updateCommandPanelState: (text: string) => void,
	updateFilePickerState: (text: string, cursorPos: number) => void,
	triggerUpdate: () => void,
) {
	const pasteFromClipboard = useCallback(async () => {
		try {
			// Try to read image from clipboard
			if (process.platform === 'win32') {
				// Windows: Use PowerShell to read image from clipboard
				try {
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

					const base64Raw = execSync(
						`powershell -NoProfile -Command "${psScript}"`,
						{
							encoding: 'utf-8',
							timeout: 10000,
							maxBuffer: 50 * 1024 * 1024, // 50MB buffer
						},
					);

					// 高效清理：一次性移除所有空白字符
					const base64 = base64Raw.replace(/\s/g, '');

					if (base64 && base64.length > 100) {
						// 直接传入 base64 数据，不需要 data URL 前缀
						buffer.insertImage(base64, 'image/png');
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

					const hasImage = execSync(checkScript, {
						encoding: 'utf-8',
						timeout: 2000,
					}).trim();

					if (hasImage === 'hasImage') {
						// Save clipboard image to temporary file and read it
						const tmpFile = `/tmp/snow_clipboard_${Date.now()}.png`;
						const saveScript = `osascript -e 'set imgData to the clipboard as «class PNGf»' -e 'set fileRef to open for access POSIX file "${tmpFile}" with write permission' -e 'write imgData to fileRef' -e 'close access fileRef'`;

						execSync(saveScript, {
							encoding: 'utf-8',
							timeout: 3000,
						});

						// Use sips to resize if needed, then convert to base64
						// First check image size
						const sizeCheck = execSync(
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
							execSync(
								`sips -z ${newHeight} ${newWidth} "${tmpFile}" --out "${tmpFile}"`,
								{
									encoding: 'utf-8',
									timeout: 5000,
								},
							);
						}

						// Read the file as base64 with optimized buffer
						const base64Raw = execSync(`base64 -i "${tmpFile}"`, {
							encoding: 'utf-8',
							timeout: 5000,
							maxBuffer: 50 * 1024 * 1024, // 50MB buffer
						});
						// 高效清理：一次性移除所有空白字符
						const base64 = base64Raw.replace(/\s/g, '');

						// Clean up temp file
						try {
							execSync(`rm "${tmpFile}"`, {timeout: 1000});
						} catch (e) {
							// Ignore cleanup errors
						}

						if (base64 && base64.length > 100) {
							// 直接传入 base64 数据，不需要 data URL 前缀
							buffer.insertImage(base64, 'image/png');
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

			// If no image, try to read text from clipboard
			try {
				let clipboardText = '';
				if (process.platform === 'win32') {
					clipboardText = execSync('powershell -Command "Get-Clipboard"', {
						encoding: 'utf-8',
						timeout: 2000,
					}).trim();
				} else if (process.platform === 'darwin') {
					clipboardText = execSync('pbpaste', {
						encoding: 'utf-8',
						timeout: 2000,
					}).trim();
				} else {
					clipboardText = execSync('xclip -selection clipboard -o', {
						encoding: 'utf-8',
						timeout: 2000,
					}).trim();
				}

				if (clipboardText) {
					buffer.insert(clipboardText);
					const fullText = buffer.getFullText();
					const cursorPos = buffer.getCursorPosition();
					updateCommandPanelState(fullText);
					updateFilePickerState(fullText, cursorPos);
					triggerUpdate();
				}
			} catch (textError) {
				logger.error('Failed to read text from clipboard:', textError);
			}
		} catch (error) {
			logger.error('Failed to read from clipboard:', error);
		}
	}, [buffer, updateCommandPanelState, updateFilePickerState, triggerUpdate]);

	return {pasteFromClipboard};
}
