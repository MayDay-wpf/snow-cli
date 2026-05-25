import {exec, execFile} from 'child_process';
import {promisify} from 'util';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const windowsSaveDialogFilter =
	'YAML files (*.yaml;*.yml)|*.yaml;*.yml|Text files (*.txt)|*.txt|Markdown files (*.md)|*.md|All files (*.*)|*.*';
const windowsOpenDialogFilter =
	'YAML files (*.yaml;*.yml)|*.yaml;*.yml|All files (*.*)|*.*';

function escapePowerShellString(value: string): string {
	return value.replace(/'/g, "''");
}

function escapeAppleScriptString(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

async function showWindowsSaveDialog(
	defaultFilename: string,
	title: string,
): Promise<string | null> {
	const downloadsPath = path.join(os.homedir(), 'Downloads');
	const psScript = [
		// Force UTF-8 output so non-ASCII paths (e.g. Chinese directory names) are
		// not corrupted by the default OEM/ANSI code page when Node decodes stdout.
		'[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
		'$OutputEncoding = [System.Text.Encoding]::UTF8;',
		'Add-Type -AssemblyName System.Windows.Forms;',
		'$dialog = New-Object System.Windows.Forms.SaveFileDialog;',
		`$dialog.Title = '${escapePowerShellString(title)}';`,
		`$dialog.Filter = '${escapePowerShellString(windowsSaveDialogFilter)}';`,
		`$dialog.FileName = '${escapePowerShellString(defaultFilename)}';`,
		`$dialog.InitialDirectory = '${escapePowerShellString(downloadsPath)}';`,
		'$dialog.RestoreDirectory = $true;',
		'$result = $dialog.ShowDialog();',
		'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($dialog.FileName); }',
	].join(' ');
	const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
	const {stdout} = await execFileAsync('powershell.exe', [
		'-NoProfile',
		'-STA',
		'-ExecutionPolicy',
		'Bypass',
		'-EncodedCommand',
		encodedCommand,
	]);
	const result = stdout.trim();
	return result || null;
}

async function showWindowsOpenDialog(title: string): Promise<string | null> {
	const downloadsPath = path.join(os.homedir(), 'Downloads');
	const psScript = [
		'[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
		'$OutputEncoding = [System.Text.Encoding]::UTF8;',
		'Add-Type -AssemblyName System.Windows.Forms;',
		'$dialog = New-Object System.Windows.Forms.OpenFileDialog;',
		`$dialog.Title = '${escapePowerShellString(title)}';`,
		`$dialog.Filter = '${escapePowerShellString(windowsOpenDialogFilter)}';`,
		`$dialog.InitialDirectory = '${escapePowerShellString(downloadsPath)}';`,
		'$dialog.RestoreDirectory = $true;',
		'$result = $dialog.ShowDialog();',
		'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine($dialog.FileName); }',
	].join(' ');
	const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
	const {stdout} = await execFileAsync('powershell.exe', [
		'-NoProfile',
		'-STA',
		'-ExecutionPolicy',
		'Bypass',
		'-EncodedCommand',
		encodedCommand,
	]);
	const result = stdout.trim();
	return result || null;
}

/**
 * Cross-platform file save dialog
 * Opens a native file save dialog and returns the selected path
 */
export async function showSaveDialog(
	defaultFilename: string = 'export.txt',
	title: string = 'Save File',
): Promise<string | null> {
	const platform = os.platform();

	try {
		if (platform === 'darwin') {
			// macOS - use osascript (AppleScript)
			const defaultPath = path.join(os.homedir(), 'Downloads', defaultFilename);
			const script = `
				set defaultPath to POSIX file "${escapeAppleScriptString(defaultPath)}"
				set saveFile to choose file name with prompt "${escapeAppleScriptString(title)}" default location (POSIX file "${escapeAppleScriptString(os.homedir())}/Downloads") default name "${escapeAppleScriptString(defaultFilename)}"
				return POSIX path of saveFile
			`;
			const {stdout} = await execAsync(`osascript -e ${shellQuote(script)}`);
			return stdout.trim();
		} else if (platform === 'win32') {
			// Windows dialogs are more reliable in an STA PowerShell process with encoded script arguments.
			return showWindowsSaveDialog(defaultFilename, title);
		} else {
			// Linux - use zenity (most common) or kdialog as fallback
			try {
				const defaultPath = path.join(
					os.homedir(),
					'Downloads',
					defaultFilename,
				);
				const {stdout} = await execAsync(
					`zenity --file-selection --save --title=${shellQuote(title)} --filename=${shellQuote(defaultPath)} --confirm-overwrite`,
				);
				return stdout.trim();
			} catch {
				// Try kdialog as fallback for KDE systems
				try {
					const defaultPath = path.join(
						os.homedir(),
						'Downloads',
						defaultFilename,
					);
					const {stdout} = await execAsync(
						`kdialog --getsavefilename ${shellQuote(defaultPath)} ${shellQuote('*.*|All Files')} --title ${shellQuote(title)}`,
					);
					return stdout.trim();
				} catch {
					// If both fail, return null
					return null;
				}
			}
		}
	} catch {
		// User cancelled or error occurred
		return null;
	}
}

/**
 * Cross-platform file open dialog for YAML configuration files.
 */
export async function showOpenDialog(
	title: string = 'Open File',
): Promise<string | null> {
	const platform = os.platform();

	try {
		if (platform === 'darwin') {
			const script = `
				set selectedFile to choose file with prompt "${escapeAppleScriptString(title)}" of type {"yaml", "yml"}
				return POSIX path of selectedFile
			`;
			const {stdout} = await execAsync(`osascript -e ${shellQuote(script)}`);
			return stdout.trim();
		} else if (platform === 'win32') {
			return showWindowsOpenDialog(title);
		} else {
			try {
				const {stdout} = await execAsync(
					`zenity --file-selection --title=${shellQuote(title)} --file-filter=${shellQuote('YAML files | *.yaml *.yml')} --file-filter=${shellQuote('All files | *')}`,
				);
				return stdout.trim();
			} catch {
				try {
					const downloadsPath = path.join(os.homedir(), 'Downloads');
					const {stdout} = await execAsync(
						`kdialog --getopenfilename ${shellQuote(downloadsPath)} ${shellQuote('*.yaml *.yml|YAML Files')} --title ${shellQuote(title)}`,
					);
					return stdout.trim();
				} catch {
					return null;
				}
			}
		}
	} catch {
		return null;
	}
}

/**
 * Cross-platform confirmation dialog.
 */
export async function showConfirmDialog(
	message: string,
	title: string = 'Confirm',
): Promise<boolean> {
	const platform = os.platform();

	try {
		if (platform === 'darwin') {
			const script = `display dialog "${escapeAppleScriptString(message)}" with title "${escapeAppleScriptString(title)}" buttons {"Cancel", "Continue"} default button "Continue" cancel button "Cancel" with icon caution`;
			await execAsync(`osascript -e ${shellQuote(script)}`);
			return true;
		} else if (platform === 'win32') {
			const psScript = [
				'[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
				'$OutputEncoding = [System.Text.Encoding]::UTF8;',
				'Add-Type -AssemblyName System.Windows.Forms;',
				`$result = [System.Windows.Forms.MessageBox]::Show('${escapePowerShellString(message)}', '${escapePowerShellString(title)}', [System.Windows.Forms.MessageBoxButtons]::OKCancel, [System.Windows.Forms.MessageBoxIcon]::Warning);`,
				'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.WriteLine("OK"); }',
			].join(' ');
			const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
			const {stdout} = await execFileAsync('powershell.exe', [
				'-NoProfile',
				'-STA',
				'-ExecutionPolicy',
				'Bypass',
				'-EncodedCommand',
				encodedCommand,
			]);
			return stdout.trim() === 'OK';
		}

		try {
			await execAsync(
				`zenity --question --title=${shellQuote(title)} --text=${shellQuote(message)} --ok-label=${shellQuote('Continue')} --cancel-label=${shellQuote('Cancel')}`,
			);
			return true;
		} catch {
			try {
				await execAsync(
					`kdialog --yesno ${shellQuote(message)} --title ${shellQuote(title)}`,
				);
				return true;
			} catch {
				return false;
			}
		}
	} catch {
		return false;
	}
}

/**
 * Check if native file dialogs are available on this platform
 */
export function isFileDialogSupported(): boolean {
	const platform = os.platform();
	return platform === 'darwin' || platform === 'win32' || platform === 'linux';
}
