import {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import process from 'node:process';

import {translations} from '../../i18n/translations.js';
import {getCurrentLanguage} from '../config/languageConfig.js';

const appId = 'Snow CLI';
/** Windows toast identity shown as the notification app name. */
const windowsAppUserModelId = 'Snow.CLI';
const maxTitleLength = 80;
const maxBodyLength = 240;
const notificationControlCharacters = /[\u0000-\u001F\u007F]/g; // eslint-disable-line no-control-regex

export type TaskNotificationStatus = 'completed' | 'failed';

export type TaskNotification = {
	taskTitle: string;
	status: TaskNotificationStatus;
	errorMessage?: string;
};

export type SessionNotification = {
	projectName: string;
};

export type AgentTurnCompletionNotificationState = {
	terminalFocused?: boolean;
	wasUserInterrupted?: boolean;
	willAutoContinue?: boolean;
	pendingMessageCount?: number;
	hasOnStopHook?: boolean;
};

type NotificationPayload = {
	title: string;
	body: string;
};

export type NotificationChannels = {
	terminal?: boolean;
	toast?: boolean;
};

export function getAgentTurnCompletionChannels(
	platform: NodeJS.Platform = process.platform,
): NotificationChannels {
	return {toast: ['win32', 'darwin', 'linux'].includes(platform)};
}

const agentTurnCompletionChannels = getAgentTurnCompletionChannels();

export function truncate(value: string, maxLength: number): string {
	if (maxLength <= 0) {
		return '';
	}

	if (value.length <= maxLength) {
		return value;
	}

	if (maxLength <= 3) {
		return '.'.repeat(maxLength);
	}

	return `${value.slice(0, maxLength - 3)}...`;
}

export function cleanNotificationText(value: string): string {
	return value
		.replaceAll(notificationControlCharacters, ' ')
		.replaceAll(/\s+/g, ' ')
		.trim();
}

export function escapeXml(value: string): string {
	return cleanNotificationText(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}
export function escapePowerShellSingleQuotedString(value: string): string {
	return cleanNotificationText(value).replaceAll("'", "''");
}

export function escapePowerShellDoubleQuotedString(value: string): string {
	return cleanNotificationText(value)
		.replaceAll('`', '``')
		.replaceAll('$', '`$')
		.replaceAll('"', '`"');
}

export function escapeAppleScriptString(value: string): string {
	return cleanNotificationText(value)
		.replaceAll('\\', '\\\\')
		.replaceAll('"', '\\"');
}

function getNotificationTranslations() {
	return translations[getCurrentLanguage()].notification;
}

export function formatTaskNotification({
	taskTitle,
	status,
	errorMessage,
}: TaskNotification): NotificationPayload {
	const {taskCompletedTitle, taskFailedTitle, unknownError} =
		getNotificationTranslations();
	const title = status === 'completed' ? taskCompletedTitle : taskFailedTitle;
	const body =
		status === 'completed'
			? taskTitle
			: `${taskTitle}: ${errorMessage ?? unknownError}`;

	return formatNotificationPayload(title, body);
}

export function formatAgentTurnCompletionNotification({
	projectName,
}: SessionNotification): NotificationPayload {
	const {agentWaitingForInputTitle} = getNotificationTranslations();

	return formatNotificationPayload(agentWaitingForInputTitle, projectName);
}

export function shouldNotifyAgentTurnCompletion({
	terminalFocused = true,
	wasUserInterrupted = false,
	willAutoContinue = false,
	pendingMessageCount = 0,
	hasOnStopHook = false,
}: AgentTurnCompletionNotificationState): boolean {
	// Snow only asks the terminal for attention when it is actually unfocused.
	return (
		!terminalFocused &&
		!wasUserInterrupted &&
		!willAutoContinue &&
		pendingMessageCount === 0 &&
		!hasOnStopHook
	);
}

function formatNotificationPayload(
	title: string,
	body: string,
): NotificationPayload {
	return {
		title: truncate(cleanNotificationText(title), maxTitleLength),
		body: truncate(cleanNotificationText(body), maxBodyLength),
	};
}

export function buildTerminalNotificationSequences(
	title: string,
	body: string,
): string[] {
	const message = [cleanNotificationText(title), cleanNotificationText(body)]
		.filter(Boolean)
		.join(': ');

	return message ? [`\u001B]9;${message}\u0007`, '\u0007'] : ['\u0007'];
}

export function buildToastScript(title: string, body: string): string {
	const resolvedTitle = title || appId;
	const resolvedBody = body || title || appId;
	const safeTitle = escapePowerShellSingleQuotedString(resolvedTitle);
	const safeBody = escapePowerShellSingleQuotedString(resolvedBody);
	const safeXmlTitle = escapeXml(resolvedTitle);
	const safeXmlBody = escapeXml(resolvedBody);
	const safeAppName = escapePowerShellSingleQuotedString(appId);
	const safeAumid = escapePowerShellSingleQuotedString(windowsAppUserModelId);

	// Prefer WinRT toast + registered AppUserModelID so Windows shows "Snow CLI"
	// instead of "Windows PowerShell 5.1" (legacy NotifyIcon balloon tip).
	return `
$ErrorActionPreference = 'Stop'
$appUserModelId = '${safeAumid}'
$displayName = '${safeAppName}'

function Register-SnowCliToastIdentity {
  $regPath = "HKCU:\\Software\\Classes\\AppUserModelId\\$appUserModelId"
  if (-not (Test-Path -LiteralPath $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
  }
  New-ItemProperty -Path $regPath -Name 'DisplayName' -Value $displayName -PropertyType String -Force | Out-Null

  $settingsPath = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings\\$appUserModelId"
  if (-not (Test-Path -LiteralPath $settingsPath)) {
    New-Item -Path $settingsPath -Force | Out-Null
  }
  New-ItemProperty -Path $settingsPath -Name 'Enabled' -Value 1 -PropertyType DWord -Force | Out-Null
  New-ItemProperty -Path $settingsPath -Name 'ShowInActionCenter' -Value 1 -PropertyType DWord -Force | Out-Null
}

function Show-SnowCliWinRtToast {
  Register-SnowCliToastIdentity

  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]

  # Avoid PowerShell here-strings (terminator must start at column 0 and is easy to break).
  $xml = '<toast><visual><binding template="ToastGeneric"><text>${safeXmlTitle}</text><text>${safeXmlBody}</text></binding></visual></toast>'

  $document = New-Object Windows.Data.Xml.Dom.XmlDocument
  $document.LoadXml($xml)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($document)
  $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appUserModelId)
  $notifier.Show($toast)
}

function Show-SnowCliBalloonFallback {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing

  $notification = New-Object System.Windows.Forms.NotifyIcon
  $notification.Icon = [System.Drawing.SystemIcons]::Information
  $notification.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
  $notification.Text = $displayName
  $notification.BalloonTipTitle = '${safeTitle}'
  $notification.BalloonTipText = '${safeBody}'
  $notification.Visible = $true
  $notification.ShowBalloonTip(5000)
  Start-Sleep -Seconds 6
  $notification.Dispose()
}

try {
  Show-SnowCliWinRtToast
  exit 0
} catch {
  try {
    Show-SnowCliBalloonFallback
  } catch {
    exit 0
  }
}
`;
}

export function buildWindowsNotificationLauncherScript(
	title: string,
	body: string,
): string {
	// Nested here-strings break when toast script already contains @' ... '@.
	// Encode the inner script as Base64 so the launcher stays single-quoted safe.
	const encodedToastScript = Buffer.from(
		buildToastScript(title, body),
		'utf16le',
	).toString('base64');

	return `
try {
  $encoded = '${encodedToastScript}'
  Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-EncodedCommand',$encoded -WindowStyle Hidden | Out-Null
} catch {
  exit 0
}
`;
}

export function buildMacOsNotificationArguments(
	title: string,
	body: string,
): string[] {
	const safeTitle = escapeAppleScriptString(title);
	const safeBody = escapeAppleScriptString(body);

	return ['-e', `display notification "${safeBody}" with title "${safeTitle}"`];
}

export function buildLinuxNotificationArguments(
	title: string,
	body: string,
): string[] {
	const safeTitle = cleanNotificationText(title) || appId;
	const safeBody = cleanNotificationText(body);
	const baseArguments = [`--app-name=${appId}`, safeTitle];

	return safeBody ? [...baseArguments, safeBody] : baseArguments;
}

function writeTerminalNotification(title: string, body: string): void {
	if (!process.stdout?.isTTY) {
		return;
	}

	for (const sequence of buildTerminalNotificationSequences(title, body)) {
		try {
			process.stdout.write(sequence);
		} catch {
			// Terminal notifications are best-effort.
		}
	}
}

function spawnDetachedBestEffort(command: string, args: string[]): void {
	try {
		const child = spawn(command, args, {
			detached: true,
			stdio: 'ignore',
			windowsHide: true,
		});

		child.on('error', () => undefined);
		child.unref();
	} catch {
		// Desktop notifications are best-effort.
	}
}

function showWindowsToastNotification({
	title,
	body,
}: NotificationPayload): void {
	const encodedCommand = Buffer.from(
		buildToastScript(title, body),
		'utf16le',
	).toString('base64');

	spawnDetachedBestEffort('cmd.exe', [
		'/d',
		'/s',
		'/c',
		'start',
		'""',
		'/min',
		'powershell',
		'-NoProfile',
		'-WindowStyle',
		'Hidden',
		'-ExecutionPolicy',
		'Bypass',
		'-EncodedCommand',
		encodedCommand,
	]);
}

function showMacOsNotification({title, body}: NotificationPayload): void {
	spawnDetachedBestEffort(
		'osascript',
		buildMacOsNotificationArguments(title, body),
	);
}

function showLinuxNotification({title, body}: NotificationPayload): void {
	spawnDetachedBestEffort(
		'notify-send',
		buildLinuxNotificationArguments(title, body),
	);
}

function showDesktopNotification(payload: NotificationPayload): void {
	switch (process.platform) {
		case 'win32': {
			showWindowsToastNotification(payload);
			break;
		}

		case 'darwin': {
			showMacOsNotification(payload);
			break;
		}

		case 'linux': {
			showLinuxNotification(payload);
			break;
		}

		default: {
			break;
		}
	}
}

function showPlatformNotification(
	{title, body}: NotificationPayload,
	channels: NotificationChannels = {},
): void {
	const {terminal = true, toast = true} = channels;

	if (terminal) {
		writeTerminalNotification(title, body);
	}

	if (toast) {
		showDesktopNotification({title, body});
	}
}

export function notifyTaskFinished(
	notification: TaskNotification,
	channels: NotificationChannels = {},
): void {
	showPlatformNotification(formatTaskNotification(notification), channels);
}

export function notifyAgentTurnComplete(
	notification: SessionNotification,
	channels: NotificationChannels = agentTurnCompletionChannels,
): void {
	showPlatformNotification(
		formatAgentTurnCompletionNotification(notification),
		channels,
	);
}
