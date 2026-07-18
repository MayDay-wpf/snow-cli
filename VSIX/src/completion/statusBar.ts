import * as vscode from 'vscode';
import {CompletionConfig} from './completionConfig';

export class CompletionStatusBar {
	private readonly item: vscode.StatusBarItem;
	private loading = false;
	private message: string | undefined;
	private config: CompletionConfig | undefined;
	private messageTimer: NodeJS.Timeout | undefined;

	constructor() {
		this.item = vscode.window.createStatusBarItem(
			vscode.StatusBarAlignment.Right,
			95,
		);
		this.item.command = 'snow-cli.completion.toggle';
		this.item.show();
	}

	public setConfig(config: CompletionConfig): void {
		this.config = config;
		this.render();
	}

	public setLoading(loading: boolean): void {
		this.loading = loading;
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
		const provider = this.config?.provider ?? 'chat';
		const model = this.config?.model || 'no model';

		if (this.message) {
			this.item.text = `$(warning) Snow AI: ${this.message}`;
			this.item.tooltip = this.message;
			return;
		}
		if (!enabled) {
			this.item.text = '$(circle-slash) Snow AI';
			this.item.tooltip = 'Snow CLI inline completion is disabled. Click to enable.';
			return;
		}
		if (this.loading) {
			this.item.text = `$(sync~spin) Snow AI · ${provider}`;
			this.item.tooltip = `Snow CLI: requesting completion (${provider}, ${model})`;
			return;
		}
		this.item.text = `$(sparkle) Snow AI · ${provider}`;
		this.item.tooltip = `Snow CLI inline completion enabled (${provider}, ${model}). Click to toggle.`;
	}
}
