import * as vscode from 'vscode';
import {NextEditConfig} from './nextEditConfig';

export type NextEditStatus = 'idle' | 'scanning' | 'active';

export class NextEditStatusBar implements vscode.Disposable {
	private readonly item: vscode.StatusBarItem;
	private config: NextEditConfig | undefined;
	private status: NextEditStatus = 'idle';
	private count = 0;
	private message: string | undefined;
	private messageTimer: NodeJS.Timeout | undefined;

	constructor() {
		this.item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			94,
		);
		this.item.command = 'snow-cli.nextEdit.toggle';
		this.item.show();
	}

	public setConfig(config: NextEditConfig): void {
		this.config = config;
		this.render();
	}

	public setStatus(status: NextEditStatus, count = 0): void {
		this.status = status;
		this.count = count;
		this.render();
	}

	public setMessage(msg: string | undefined): void {
		this.message = msg;
		this.render();
		if (this.messageTimer) {
			clearTimeout(this.messageTimer);
			this.messageTimer = undefined;
		}
		if (msg) {
			this.messageTimer = setTimeout(() => {
				this.message = undefined;
				this.render();
			}, 4000);
		}
	}

	public dispose(): void {
		if (this.messageTimer) clearTimeout(this.messageTimer);
		this.item.dispose();
	}

	private render(): void {
		const enabled = this.config?.enabled ?? false;
		if (this.message) {
			this.item.text = `$(warning) Snow Next: ${this.message}`;
			this.item.tooltip = this.message;
			return;
		}
		if (!enabled) {
			this.item.text = '$(circle-slash) Snow Next';
			this.item.tooltip =
				'Snow CLI Next Edit Prediction is disabled. Click to enable.';
			return;
		}
		if (this.status === 'scanning') {
			this.item.text = '$(sync~spin) Snow Next';
			this.item.tooltip =
				'Snow CLI Next Edit Prediction: scanning for similar locations…';
			return;
		}
		if (this.status === 'active') {
			this.item.text = `$(arrow-right) Snow Next · ${this.count}`;
			this.item.tooltip = `Snow CLI Next Edit Prediction: ${this.count} candidate(s). Tab to apply, Esc to dismiss.`;
			return;
		}
		this.item.text = '$(lightbulb) Snow Next';
		this.item.tooltip =
			'Snow CLI Next Edit Prediction enabled. Edit something and pause briefly to get a Tab-jump suggestion.';
	}
}
