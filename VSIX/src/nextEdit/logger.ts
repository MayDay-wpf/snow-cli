import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
	if (!channel) {
		channel = vscode.window.createOutputChannel('Snow Next Edit');
	}
	return channel;
}

function ts(): string {
	const d = new Date();
	const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function log(message: string, ...args: unknown[]): void {
	const out = getLogger();
	let line = `[${ts()}] ${message}`;
	for (const a of args) {
		try {
			if (typeof a === 'string') {
				line += ` ${a}`;
			} else if (a instanceof Error) {
				line += ` ${a.name}: ${a.message}`;
			} else {
				line += ` ${JSON.stringify(a)}`;
			}
		} catch {
			line += ` [unserializable]`;
		}
	}
	out.appendLine(line);
}

export function disposeLogger(): void {
	channel?.dispose();
	channel = undefined;
}
