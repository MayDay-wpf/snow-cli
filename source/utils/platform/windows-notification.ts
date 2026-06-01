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
};

type NotificationPayload = {
	title: string;
	body: string;
};

type NotificationChannels = {
	terminal?: boolean;
	toast?: boolean;
};

const agentTurnCompletionChannels: NotificationChannels = {toast: false};

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
}: AgentTurnCompletionNotificationState): boolean {
	// Codex only asks the terminal for attention when it is actually unfocused.
	return (
		!terminalFocused &&
		!wasUserInterrupted &&
		!willAutoContinue &&
		pendingMessageCount === 0
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

function showWindowsNotification(
	{title, body}: NotificationPayload,
	channels: NotificationChannels = {},
): void {
	if (process.platform !== 'win32') {
		return;
	}

	const {terminal = true, toast = true} = channels;
	if (terminal) {
		writeTerminalNotification(title, body);
	}

	if (!toast) {
		return;
	}

	const script = buildToastScript(title, body);
	const encodedCommand = Buffer.from(script, 'utf16le').toString('base64');

	try {
		const child = spawn(
			'powershell.exe',
			[
				'-NoProfile',
				'-NonInteractive',
				'-ExecutionPolicy',
				'Bypass',
				'-EncodedCommand',
				encodedCommand,
			],
			{
				detached: true,
				stdio: 'ignore',
				windowsHide: true,
			},
		);

		child.on('error', () => undefined);
		child.unref();
	} catch {
		// Notifications are best-effort and must never affect task execution.
	}
}

export function notifyTaskFinished(
	notification: TaskNotification,
	channels: NotificationChannels = {},
): void {
	showWindowsNotification(formatTaskNotification(notification), channels);
}

export function notifyAgentTurnComplete(
	notification: SessionNotification,
	channels: NotificationChannels = agentTurnCompletionChannels,
): void {
	showWindowsNotification(
		formatAgentTurnCompletionNotification(notification),
		channels,
	);
}
