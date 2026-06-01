import {Buffer} from 'node:buffer';
import {spawn} from 'node:child_process';
import process from 'node:process';

const appId = 'Snow CLI';
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
	return {toast: platform !== 'win32'};
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

export function escapeAppleScriptString(value: string): string {
	return cleanNotificationText(value)
		.replaceAll('\\', '\\\\')
		.replaceAll('"', '\\"');
}

export function formatTaskNotification({
	taskTitle,
	status,
	errorMessage,
}: TaskNotification): NotificationPayload {
	const title =
		status === 'completed' ? 'Snow task completed' : 'Snow task failed';
	const body =
		status === 'completed'
			? taskTitle
			: `${taskTitle}: ${errorMessage ?? 'Unknown error'}`;

	return formatNotificationPayload(title, body);
}

export function formatAgentTurnCompletionNotification({
	projectName,
}: SessionNotification): NotificationPayload {
	return formatNotificationPayload('Snow agent waiting for input', projectName);
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
	const safeTitle = escapeXml(title);
	const safeBody = escapeXml(body);
	const safeAppId = appId.replaceAll("'", "''");

	return `
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

  $xml = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>${safeTitle}</text>
      <text>${safeBody}</text>
    </binding>
  </visual>
</toast>
"@
  $document = New-Object Windows.Data.Xml.Dom.XmlDocument
  $document.LoadXml($xml)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($document)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${safeAppId}').Show($toast)
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

function showWindowsToastNotification({title, body}: NotificationPayload): void {
	const script = buildToastScript(title, body);
	const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');

	spawnDetachedBestEffort('powershell.exe', [
		'-NoProfile',
		'-NonInteractive',
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
