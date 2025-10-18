import { useCallback } from 'react';
import { execSync } from 'child_process';
import { TextBuffer } from '../utils/textBuffer.js';
import { logger } from '../utils/logger.js';

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
					const psScript = `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; $clipboard = [System.Windows.Forms.Clipboard]::GetImage(); if ($clipboard -ne $null) { $ms = New-Object System.IO.MemoryStream; $clipboard.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bytes = $ms.ToArray(); $ms.Close(); [Convert]::ToBase64String($bytes) }`;

					const base64 = execSync(`powershell -Command "${psScript}"`, {
						encoding: 'utf-8',
						timeout: 5000,
					}).trim();

					if (base64 && base64.length > 100) {
						const dataUrl = `data:image/png;base64,${base64}`;
						buffer.insertImage(dataUrl, 'image/png');
						const text = buffer.getFullText();
						const cursorPos = buffer.getCursorPosition();
						updateCommandPanelState(text);
						updateFilePickerState(text, cursorPos);
						triggerUpdate();
						return;
					}
				} catch (imgError) {
					// No image in clipboard or error, fall through to text
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

						// Read the file as base64
						const base64 = execSync(`base64 -i "${tmpFile}"`, {
							encoding: 'utf-8',
							timeout: 2000,
						}).trim();

						// Clean up temp file
						try {
							execSync(`rm "${tmpFile}"`, { timeout: 1000 });
						} catch (e) {
							// Ignore cleanup errors
						}

						if (base64 && base64.length > 100) {
							const dataUrl = `data:image/png;base64,${base64}`;
							buffer.insertImage(dataUrl, 'image/png');
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

	return { pasteFromClipboard };
}
