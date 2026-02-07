import * as vscode from 'vscode';
import {PtyManager} from './ptyManager';

export class SidebarTerminalProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'snowCliTerminal';

	private view?: vscode.WebviewView;
	private ptyManager: PtyManager;

	constructor(private readonly extensionUri: vscode.Uri) {
		this.ptyManager = new PtyManager();
	}

	public resolveWebviewView(
		webviewView: vscode.WebviewView,
		_context: vscode.WebviewViewResolveContext,
		_token: vscode.CancellationToken,
	): void {
		this.view = webviewView;

		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [
				vscode.Uri.joinPath(this.extensionUri, 'resources'),
				vscode.Uri.joinPath(
					this.extensionUri,
					'node_modules',
					'@xterm',
					'xterm',
					'lib',
				),
				vscode.Uri.joinPath(
					this.extensionUri,
					'node_modules',
					'@xterm',
					'xterm',
					'css',
				),
				vscode.Uri.joinPath(
					this.extensionUri,
					'node_modules',
					'@xterm',
					'addon-fit',
					'lib',
				),
			],
		};

		webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

		webviewView.webview.onDidReceiveMessage(message => {
			this.handleMessage(message);
		});

		webviewView.onDidDispose(() => {
			this.ptyManager.kill();
		});
	}

	private handleMessage(message: {
		type: string;
		data?: string;
		cols?: number;
		rows?: number;
	}): void {
		switch (message.type) {
			case 'ready':
				this.startTerminal();
				break;
			case 'input':
				if (message.data) {
					this.ptyManager.write(message.data);
				}
				break;
			case 'resize':
				if (message.cols && message.rows) {
					this.ptyManager.resize(message.cols, message.rows);
				}
				break;
		}
	}

	private startTerminal(): void {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const cwd = workspaceFolder || process.cwd();

		this.ptyManager.start(cwd, {
			onData: (data: string) => {
				this.view?.webview.postMessage({type: 'output', data});
			},
			onExit: (code: number) => {
				this.view?.webview.postMessage({type: 'exit', code});
			},
		});
	}

	private getHtmlForWebview(webview: vscode.Webview): string {
		const xtermCssUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.extensionUri,
				'node_modules',
				'@xterm',
				'xterm',
				'css',
				'xterm.css',
			),
		);
		const xtermJsUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.extensionUri,
				'node_modules',
				'@xterm',
				'xterm',
				'lib',
				'xterm.js',
			),
		);
		const xtermFitUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.extensionUri,
				'node_modules',
				'@xterm',
				'addon-fit',
				'lib',
				'addon-fit.js',
			),
		);

		const cspSource = webview.cspSource;

		return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" 
        content="default-src 'none'; 
                 style-src ${cspSource} 'unsafe-inline'; 
                 script-src ${cspSource} 'unsafe-inline';
                 font-src ${cspSource};">
  <link rel="stylesheet" href="${xtermCssUri}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { 
      height: 100%; 
      width: 100%;
      overflow: hidden;
      background-color: #1e1e1e;
    }
    #terminal-container {
      height: 100%;
      width: 100%;
      padding: 4px;
    }
    .xterm {
      height: 100%;
      width: 100%;
    }
  </style>
</head>
<body>
  <div id="terminal-container"></div>
  
  <script src="${xtermJsUri}"></script>
  <script src="${xtermFitUri}"></script>
  <script>
    (function() {
      const vscode = acquireVsCodeApi();
      
      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace',
        scrollback: 10000,
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#aeafad',
          cursorAccent: '#000000',
          selectionBackground: '#264f78',
          black: '#000000',
          red: '#cd3131',
          green: '#0dbc79',
          yellow: '#e5e510',
          blue: '#2472c8',
          magenta: '#bc3fbc',
          cyan: '#11a8cd',
          white: '#e5e5e5',
          brightBlack: '#666666',
          brightRed: '#f14c4c',
          brightGreen: '#23d18b',
          brightYellow: '#f5f543',
          brightBlue: '#3b8eea',
          brightMagenta: '#d670d6',
          brightCyan: '#29b8db',
          brightWhite: '#e5e5e5'
        }
      });

      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);

      const container = document.getElementById('terminal-container');
      term.open(container);
      
      function fitTerminal() {
        try {
          fitAddon.fit();
          vscode.postMessage({
            type: 'resize',
            cols: term.cols,
            rows: term.rows
          });
        } catch (e) {}
      }

      const resizeObserver = new ResizeObserver(() => {
        fitTerminal();
      });
      resizeObserver.observe(container);

      setTimeout(fitTerminal, 100);

      term.onData(data => {
        vscode.postMessage({ type: 'input', data: data });
      });

      // 选中文本时自动复制到剪贴板
      term.onSelectionChange(() => {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard.writeText(selection).catch(() => {});
        }
      });

      // 右键直接粘贴（阻止默认右键菜单）
      container.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        navigator.clipboard.readText().then(text => {
          if (text) {
            vscode.postMessage({ type: 'input', data: text });
          }
        }).catch(() => {});
      });

      window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
          case 'output':
            term.write(message.data);
            break;
          case 'clear':
            term.clear();
            break;
          case 'exit':
            term.write('\\r\\n\\r\\n[Process exited with code ' + message.code + ']\\r\\n');
            break;
        }
      });

      vscode.postMessage({ type: 'ready' });
    })();
  </script>
</body>
</html>`;
	}

	public dispose(): void {
		this.ptyManager.kill();
	}
}
