import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

/**
 * Cross-platform file save dialog
 * Opens a native file save dialog and returns the selected path
 */
export async function showSaveDialog(
	defaultFilename: string = 'export.txt',
	title: string = 'Save File'
): Promise<string | null> {
	const platform = os.platform();

	try {
		if (platform === 'darwin') {
			// macOS - use osascript (AppleScript)
			const defaultPath = path.join(os.homedir(), 'Downloads', defaultFilename);
			const script = `
				set defaultPath to POSIX file "${defaultPath}"
				set saveFile to choose file name with prompt "${title}" default location (POSIX file "${os.homedir()}/Downloads") default name "${defaultFilename}"
				return POSIX path of saveFile
			`;
			const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
			return stdout.trim();
		} else if (platform === 'win32') {
			// Windows - use PowerShell
			const script = `
				Add-Type -AssemblyName System.Windows.Forms
				$dialog = New-Object System.Windows.Forms.SaveFileDialog
				$dialog.Title = "${title}"
				$dialog.Filter = "Text files (*.txt)|*.txt|Markdown files (*.md)|*.md|All files (*.*)|*.*"
				$dialog.FileName = "${defaultFilename}"
				$dialog.InitialDirectory = "${path.join(os.homedir(), 'Downloads').replace(/\\/g, '\\\\')}"
				$result = $dialog.ShowDialog()
				if ($result -eq 'OK') {
					Write-Output $dialog.FileName
				}
			`;
			const { stdout } = await execAsync(`powershell -NoProfile -Command "${script.replace(/"/g, '\\"')}"`);
			const result = stdout.trim();
			return result || null;
		} else {
			// Linux - use zenity (most common) or kdialog as fallback
			try {
				const defaultPath = path.join(os.homedir(), 'Downloads', defaultFilename);
				const { stdout } = await execAsync(
					`zenity --file-selection --save --title="${title}" --filename="${defaultPath}" --confirm-overwrite`
				);
				return stdout.trim();
			} catch (error) {
				// Try kdialog as fallback for KDE systems
				try {
					const defaultPath = path.join(os.homedir(), 'Downloads', defaultFilename);
					const { stdout } = await execAsync(
						`kdialog --getsavefilename "${defaultPath}" "*.*|All Files" --title "${title}"`
					);
					return stdout.trim();
				} catch {
					// If both fail, return null
					return null;
				}
			}
		}
	} catch (error) {
		// User cancelled or error occurred
		return null;
	}
}

/**
 * Check if native file dialogs are available on this platform
 */
export function isFileDialogSupported(): boolean {
	const platform = os.platform();
	return platform === 'darwin' || platform === 'win32' || platform === 'linux';
}
