import * as vscode from 'vscode';
import {PtyManager} from './ptyManager';

export class SidebarTerminalProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'snowCliTerminal';

	private view?: vscode.WebviewView;
	private ptyManager: PtyManager;
	private startupCommand: string;

	constructor(
		private readonly extensionUri: vscode.Uri,
		startupCommand?: string,
	) {
		this.ptyManager = new PtyManager();
		this.startupCommand = startupCommand ?? 'snow';
	}

	/**
	 * Update the startup command (e.g. when settings change)
	 */
	public setStartupCommand(command: string): void {
		this.startupCommand = command;
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

		this.ptyManager.start(
			cwd,
			{
				onData: (data: string) => {
					this.view?.webview.postMessage({type: 'output', data});
				},
				onExit: (code: number) => {
					this.view?.webview.postMessage({type: 'exit', code});
				},
			},
			this.startupCommand,
		);
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
      const container = document.getElementById('terminal-container');

      // Show error message if initialization fails
      function showError(msg) {
        container.style.color = '#f14c4c';
        container.style.padding = '20px';
        container.style.fontFamily = 'monospace';
        container.style.fontSize = '12px';
        container.style.whiteSpace = 'pre-wrap';
        container.textContent = 'Terminal Error:\\n' + msg;
      }

      if (typeof Terminal === 'undefined') {
        showError('xterm.js failed to load. Check CSP or resource paths.');
        return;
      }
      if (typeof FitAddon === 'undefined') {
        showError('FitAddon failed to load.');
        return;
      }

      try {
      
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

      // Shift+Drag file path support — drop files to type path into terminal
      function quoteIfSpaces(p) {
        return p.indexOf(' ') >= 0 ? '"' + p + '"' : p;
      }

      container.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        container.style.outline = '2px dashed #007acc';
        container.style.outlineOffset = '-2px';
      });

      container.addEventListener('dragleave', function(e) {
        e.preventDefault();
        container.style.outline = 'none';
      });

      // Parse a single URI string into a local file path
      function uriToPath(uri) {
        try {
          var u = new URL(uri.trim());
          if (u.protocol === 'file:') {
            var p = decodeURIComponent(u.pathname);
            if (/^\\/[a-zA-Z]:/.test(p)) p = p.substring(1);
            return p || null;
          }
        } catch(ex) {}
        return null;
      }

      // Check if a string looks like a local file path
      function looksLikePath(s) {
        return s.startsWith('/') || /^[a-zA-Z]:[/\\\\]/.test(s) || s.startsWith('file://');
      }

      container.addEventListener('drop', function(e) {
        e.preventDefault();
        e.stopPropagation();
        container.style.outline = 'none';

        var paths = [];
        var types = e.dataTransfer.types || [];

        // Pass 1: scan ALL available data transfer types for URIs / paths
        for (var t = 0; t < types.length; t++) {
          if (paths.length > 0) break;
          var mimeType = types[t];
          // Skip non-text types and the Files type marker
          if (mimeType === 'Files') continue;

          var data = '';
          try { data = e.dataTransfer.getData(mimeType); } catch(ex) { continue; }
          if (!data) continue;

          // Types that contain URI lists (text/uri-list, code/uri-list, etc.)
          if (mimeType.indexOf('uri') >= 0 || mimeType.indexOf('url') >= 0) {
            var lines = data.split(/\\r?\\n/);
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line || line.charAt(0) === '#') continue;
              var fp = uriToPath(line);
              if (fp) { paths.push(fp); }
              else if (looksLikePath(line)) { paths.push(line); }
            }
          }
          // Types that contain JSON with URI / path info (VSCode resource types)
          else if (mimeType.indexOf('code') >= 0 || mimeType.indexOf('resource') >= 0) {
            try {
              var json = JSON.parse(data);
              var items = Array.isArray(json) ? json : [json];
              for (var k = 0; k < items.length; k++) {
                var item = items[k];
                var raw = (item && (item.uri || item.fsPath || item.path || item.externalUri)) || '';
                if (typeof raw === 'object') raw = raw.fsPath || raw.path || '';
                if (raw) {
                  var fp = uriToPath(raw);
                  paths.push(fp || raw);
                }
              }
            } catch(ex) {}
          }
          // text/plain — check if it looks like a file path or file:// URI
          else if (mimeType === 'text/plain') {
            var lines = data.split(/\\r?\\n/);
            for (var i = 0; i < lines.length; i++) {
              var line = lines[i].trim();
              if (!line) continue;
              if (line.startsWith('file://')) {
                var fp = uriToPath(line);
                if (fp) paths.push(fp);
              } else if (looksLikePath(line)) {
                paths.push(line);
              }
            }
          }
        }

        // Pass 2: File objects (external drops from OS file manager)
        if (paths.length === 0 && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          for (var j = 0; j < e.dataTransfer.files.length; j++) {
            var f = e.dataTransfer.files[j];
            if (f.path) paths.push(f.path);
            else if (f.name) paths.push(f.name);
          }
        }

        // Pass 3: last resort — take any non-empty text data
        if (paths.length === 0) {
          for (var t = 0; t < types.length; t++) {
            if (types[t] === 'Files') continue;
            var data = '';
            try { data = e.dataTransfer.getData(types[t]); } catch(ex) { continue; }
            if (data && data.trim()) {
              paths.push(data.trim());
              break;
            }
          }
        }

        if (paths.length > 0) {
          var result = paths.map(quoteIfSpaces).join(' ');
          vscode.postMessage({ type: 'input', data: result });
          term.focus();
        }
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
          case 'fileDrop':
            // Handle file paths sent from extension host
            if (message.paths && message.paths.length > 0) {
              var result = message.paths.map(quoteIfSpaces).join(' ');
              vscode.postMessage({ type: 'input', data: result });
            }
            break;
        }
      });

      vscode.postMessage({ type: 'ready' });

      } catch(err) {
        showError(err.stack || err.message || String(err));
      }
    })();
  </script>
</body>
</html>`;
	}

	/**
	 * Send file paths to the terminal (e.g. from explorer drag-and-drop)
	 */
	public sendFilePaths(paths: string[]): void {
		const pathStr = paths
			.map(p => (p.includes(' ') ? `"${p}"` : p))
			.join(' ');
		this.ptyManager.write(pathStr);
	}

	public dispose(): void {
		this.ptyManager.kill();
	}
}
