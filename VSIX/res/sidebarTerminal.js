(function () {
	const vscode = acquireVsCodeApi();
	const container = document.getElementById('terminal-container');
	if (!(container instanceof HTMLElement)) {
		return;
	}

	const showError = msg => {
		container.classList.add('terminal-error');
		container.textContent = `Terminal Error:\n${msg}`;
	};

	const requiredAddons = [
		['Terminal', typeof Terminal],
		['FitAddon', typeof FitAddon],
		['WebLinksAddon', typeof WebLinksAddon],
		['SearchAddon', typeof SearchAddon],
	];
	for (const [name, type] of requiredAddons) {
		if (type === 'undefined') {
			showError(
				`${name} failed to load.${
					name === 'Terminal' ? ' Check CSP or resource paths.' : ''
				}`,
			);
			return;
		}
	}

	const createCleanupRegistry = () => {
		const handlers = [];
		let cleaned = false;

		const registerCleanup = cleanup => {
			handlers.push(cleanup);
		};

		const runCleanups = () => {
			if (cleaned) {
				return;
			}
			cleaned = true;
			for (let i = handlers.length - 1; i >= 0; i -= 1) {
				try {
					handlers[i]();
				} catch {
					// Ignore cleanup failures.
				}
			}
			handlers.length = 0;
		};

		const addManagedListener = (target, type, listener, options) => {
			target.addEventListener(type, listener, options);
			registerCleanup(() => {
				target.removeEventListener(type, listener, options);
			});
		};

		const registerDisposable = disposable => {
			if (!disposable || typeof disposable.dispose !== 'function') {
				return;
			}
			registerCleanup(() => {
				try {
					disposable.dispose();
				} catch {
					// Ignore disposal failures.
				}
			});
		};

		return {
			registerCleanup,
			runCleanups,
			addManagedListener,
			registerDisposable,
		};
	};

	const quoteIfSpaces = value => (value.includes(' ') ? `"${value}"` : value);
	const formatPathsForTerminal = paths => paths.map(quoteIfSpaces).join(' ');

	const applyTermOption = (options, key, value) => {
		if (typeof value === 'string' && value) {
			options[key] = value;
		} else if (typeof value === 'number' && Number.isFinite(value)) {
			options[key] = value;
		}
	};

	const uriToPath = uri => {
		try {
			const parsed = new URL(uri.trim());
			if (parsed.protocol !== 'file:') {
				return null;
			}
			let filePath = decodeURIComponent(parsed.pathname);
			if (/^\/[a-zA-Z]:/.test(filePath)) {
				filePath = filePath.slice(1);
			}
			return filePath || null;
		} catch {
			return null;
		}
	};

	const looksLikePath = value =>
		value.startsWith('/') ||
		/^[a-zA-Z]:[/\\]/.test(value) ||
		value.startsWith('file://');

	const normalizeDroppedPath = value => {
		if (typeof value !== 'string') {
			return null;
		}
		const trimmed = value.trim();
		if (!trimmed) {
			return null;
		}
		const filePath = uriToPath(trimmed);
		if (filePath) {
			return filePath;
		}
		return looksLikePath(trimmed) ? trimmed : null;
	};

	const collectPaths = (lines, filterFn) => {
		const paths = [];
		for (const rawLine of lines) {
			const line = rawLine.trim();
			if (!line) {
				continue;
			}
			const result = filterFn(line);
			if (result) {
				paths.push(result);
			}
		}
		return paths;
	};

	const parseUriLines = lines =>
		collectPaths(lines, line => {
			if (line.startsWith('#')) {
				return null;
			}
			return normalizeDroppedPath(line);
		});

	const parsePlainTextLines = lines =>
		collectPaths(lines, line => {
			if (line.startsWith('file://')) {
				return uriToPath(line);
			}
			return looksLikePath(line) ? line : null;
		});

	const parseCodeResourcePayload = rawData => {
		const paths = [];
		try {
			const parsed = JSON.parse(rawData);
			const items = Array.isArray(parsed) ? parsed : [parsed];
			for (const item of items) {
				let raw =
					(item &&
						(item.uri || item.fsPath || item.path || item.externalUri)) ||
					'';
				if (raw && typeof raw === 'object') {
					raw = raw.fsPath || raw.path || '';
				}
				if (!raw) {
					continue;
				}
				const filePath = uriToPath(raw);
				paths.push(filePath || raw);
			}
		} catch {
			// Ignore JSON parsing errors for non-standard payloads.
		}
		return paths;
	};

	const extractPathsFromMimeData = (mimeType, data) => {
		if (mimeType.includes('uri') || mimeType.includes('url')) {
			return parseUriLines(data.split(/\r?\n/));
		}
		if (mimeType.includes('code') || mimeType.includes('resource')) {
			return parseCodeResourcePayload(data);
		}
		if (mimeType === 'text/plain') {
			return parsePlainTextLines(data.split(/\r?\n/));
		}
		return [];
	};

	const extractPathsFromDataTransfer = dataTransfer => {
		const paths = [];
		const types = Array.from(dataTransfer.types || []);

		for (const mimeType of types) {
			if (paths.length > 0) {
				break;
			}
			if (mimeType === 'Files') {
				continue;
			}

			let data = '';
			try {
				data = dataTransfer.getData(mimeType);
			} catch {
				continue;
			}
			if (!data) {
				continue;
			}

			paths.push(...extractPathsFromMimeData(mimeType, data));
		}

		if (
			paths.length === 0 &&
			dataTransfer.files &&
			dataTransfer.files.length > 0
		) {
			for (const file of dataTransfer.files) {
				if (file.path) {
					paths.push(file.path);
				} else if (file.name) {
					paths.push(file.name);
				}
			}
		}

		if (paths.length === 0) {
			for (const mimeType of types) {
				if (mimeType === 'Files') {
					continue;
				}
				let data = '';
				try {
					data = dataTransfer.getData(mimeType);
				} catch {
					continue;
				}
				if (data && data.trim()) {
					paths.push(data.trim());
					break;
				}
			}
		}

		return paths;
	};

	try {
		const {
			registerCleanup,
			runCleanups,
			addManagedListener,
			registerDisposable,
		} = createCleanupRegistry();

		const sendInput = text => {
			if (typeof text !== 'string' || text.length === 0) {
				return;
			}
			vscode.postMessage({type: 'input', data: text});
		};

		const term = new Terminal({
			cursorBlink: true,
			fontFamily: 'monospace',
			fontSize: 14,
			altClickMovesCursor: true,
			drawBoldTextInBrightColors: true,
			minimumContrastRatio: 4.5,
			tabStopWidth: 8,
			macOptionIsMeta: false,
			rightClickSelectsWord: false,
			fastScrollModifier: 'alt',
			fastScrollSensitivity: 5,
			scrollSensitivity: 1,
			scrollback: 1000,
			scrollOnUserInput: true,
			wordSeparator: " ()[]{}',\\\"`─''|",
			allowTransparency: false,
			rescaleOverlappingGlyphs: true,
			allowProposedApi: true,
			cursorStyle: 'block',
			cursorInactiveStyle: 'outline',
			cursorWidth: 1,
			convertEol: false,
			disableStdin: false,
			screenReaderMode: false,
			windowOptions: {
				restoreWin: false,
				minimizeWin: false,
				setWinPosition: false,
				setWinSizePixels: false,
				raiseWin: false,
				lowerWin: false,
				refreshWin: false,
				setWinSizeChars: false,
				maximizeWin: false,
				fullscreenWin: false,
			},
			theme: {
				background: '#181818',
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
				brightWhite: '#e5e5e5',
			},
		});

		const fitAddon = new FitAddon.FitAddon();
		const webLinksAddon = new WebLinksAddon.WebLinksAddon();
		const searchAddon = new SearchAddon.SearchAddon();
		term.loadAddon(fitAddon);
		term.loadAddon(webLinksAddon);
		term.loadAddon(searchAddon);

		if (
			typeof Unicode11Addon !== 'undefined' &&
			Unicode11Addon &&
			typeof Unicode11Addon.Unicode11Addon === 'function'
		) {
			try {
				const unicode11Addon = new Unicode11Addon.Unicode11Addon();
				term.loadAddon(unicode11Addon);
				try {
					term.unicode.activeVersion = '11';
				} catch (error) {
					console.warn('Failed to activate Unicode version 11:', error);
				}
			} catch (error) {
				console.warn('Unicode11Addon failed to load:', error);
			}
		} else {
			console.warn('Unicode11Addon unavailable.');
		}

		term.open(container);

		const RESIZE_FILL_TOLERANCE_PX = 2;
		const FOCUS_RECOVERY_DELAYS_MS = [0, 80, 240];
		const FOCUS_RECOVERY_COOLDOWN_MS = 400;
		const RENDER_STALL_TIMEOUT_MS = 10000;
		const RENDER_STALL_CHECK_INTERVAL_MS = 2000;

		let focusRecoveryTimers = [];
		let focusRecoveryCooldownUntil = 0;
		let resizeDebounceTimer = null;
		let webglAddon = null;
		let rendererDegraded = false;
		let lastOutputAt = 0;
		let lastRenderAt = Date.now();
		let lastWriteParsedAt = 0;
		let bytesPendingRender = 0;
		let rendererStallReportedAt = 0;
		let lastReportedCols = 0;
		let lastReportedRows = 0;

		const reportSize = () => {
			const cols = term.cols;
			const rows = term.rows;
			if (
				cols > 0 &&
				rows > 0 &&
				(cols !== lastReportedCols || rows !== lastReportedRows)
			) {
				lastReportedCols = cols;
				lastReportedRows = rows;
				vscode.postMessage({
					type: 'resize',
					cols,
					rows,
				});
			}
		};

		const clearFocusRecoveryTimers = () => {
			if (focusRecoveryTimers.length === 0) {
				return;
			}
			for (const timer of focusRecoveryTimers) {
				clearTimeout(timer);
			}
			focusRecoveryTimers = [];
		};

		const scheduleFocusRecovery = () => {
			if (document.hidden) {
				return;
			}
			const now = Date.now();
			if (now < focusRecoveryCooldownUntil) {
				return;
			}
			focusRecoveryCooldownUntil = now + FOCUS_RECOVERY_COOLDOWN_MS;
			clearFocusRecoveryTimers();
			for (const delay of FOCUS_RECOVERY_DELAYS_MS) {
				const timer = setTimeout(() => {
					focusRecoveryTimers = focusRecoveryTimers.filter(t => t !== timer);
					term.focus();
				}, delay);
				focusRecoveryTimers.push(timer);
			}
		};

		const clearResizeDebounceTimer = () => {
			if (!resizeDebounceTimer) {
				return;
			}
			clearTimeout(resizeDebounceTimer);
			resizeDebounceTimer = null;
		};

		const isContainerVisible = () => {
			if (document.hidden) {
				return false;
			}
			const rect = container.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		};

		const getMeasuredRowHeight = () => {
			const screenCanvas = container.querySelector('.xterm-screen canvas');
			if (screenCanvas instanceof HTMLCanvasElement && term.rows > 0) {
				const measured =
					screenCanvas.getBoundingClientRect().height / term.rows;
				if (measured > 0) {
					return measured;
				}
			}

			const fontSize =
				typeof term.options.fontSize === 'number' ? term.options.fontSize : 14;
			const lineHeight =
				typeof term.options.lineHeight === 'number'
					? term.options.lineHeight
					: 1;
			const estimated = fontSize * lineHeight;
			return estimated > 0 ? estimated : 0;
		};

		const resizeToContainer = () => {
			const proposed = fitAddon.proposeDimensions();
			if (!proposed) {
				return false;
			}

			let {cols, rows} = proposed;
			if (cols <= 0 || rows <= 0) {
				return false;
			}

			const rowHeight = getMeasuredRowHeight();
			if (rowHeight > 0) {
				const availableHeight = container.getBoundingClientRect().height;
				const remainingHeight = availableHeight - rows * rowHeight;
				if (remainingHeight >= rowHeight - RESIZE_FILL_TOLERANCE_PX) {
					rows += 1;
				}
			}

			if (cols !== term.cols || rows !== term.rows) {
				term.resize(cols, rows);
			}
			return true;
		};

		const fitTerminal = () => {
			try {
				const resized = resizeToContainer();
				if (!resized) {
					fitAddon.fit();
				}
				reportSize();
			} catch {
				// Ignore fit errors caused by transient hidden/invalid layout states.
			}
		};

		const scheduleFit = () => {
			clearResizeDebounceTimer();
			resizeDebounceTimer = setTimeout(() => {
				resizeDebounceTimer = null;
				fitTerminal();
			}, 50);
		};

		const degradeRenderer = reason => {
			if (rendererDegraded) {
				return;
			}
			rendererDegraded = true;
			try {
				if (webglAddon) {
					webglAddon.dispose();
				}
			} catch {
				// Ignore dispose failures for already-lost context.
			}
			webglAddon = null;
			try {
				if (term.rows > 0) {
					term.refresh(0, term.rows - 1);
				}
			} catch {
				// Ignore refresh errors after renderer fallback.
			}
			fitTerminal();
			scheduleFocusRecovery();
			vscode.postMessage({type: 'rendererStall', reason});
		};

		const tryEnableWebgl = () => {
			if (rendererDegraded) {
				return false;
			}
			if (
				typeof WebglAddon === 'undefined' ||
				!WebglAddon ||
				typeof WebglAddon.WebglAddon !== 'function'
			) {
				return false;
			}

			try {
				webglAddon = new WebglAddon.WebglAddon();
				term.loadAddon(webglAddon);
				if (typeof webglAddon.onContextLoss === 'function') {
					webglAddon.onContextLoss(() => {
						degradeRenderer('context-loss');
					});
				}
				return true;
			} catch (error) {
				console.warn('WebGL addon failed to load:', error);
				return false;
			}
		};

		const rendererHealthTimer = setInterval(() => {
			if (rendererDegraded || !webglAddon) {
				return;
			}
			if (!isContainerVisible()) {
				return;
			}
			if (bytesPendingRender <= 0) {
				return;
			}

			const now = Date.now();
			if (now - rendererStallReportedAt < RENDER_STALL_TIMEOUT_MS) {
				return;
			}

			const latestOutputActivity = Math.max(lastOutputAt, lastWriteParsedAt);
			if (latestOutputActivity <= 0) {
				return;
			}
			if (
				now - latestOutputActivity >= RENDER_STALL_TIMEOUT_MS &&
				now - lastRenderAt >= RENDER_STALL_TIMEOUT_MS
			) {
				rendererStallReportedAt = now;
				degradeRenderer('stalled-renderer');
			}
		}, RENDER_STALL_CHECK_INTERVAL_MS);

		const resizeObserver = new ResizeObserver(() => {
			scheduleFit();
		});
		resizeObserver.observe(container);

		const initialFitTimer = setTimeout(fitTerminal, 100);

		if (document.fonts && document.fonts.ready) {
			document.fonts.ready
				.then(() => {
					fitTerminal();
				})
				.catch(() => {
					// Ignore font readiness errors.
				});
		}

		registerDisposable(
			term.onRender(() => {
				lastRenderAt = Date.now();
				bytesPendingRender = 0;
			}),
		);

		registerDisposable(
			term.onWriteParsed(() => {
				lastWriteParsedAt = Date.now();
			}),
		);

		registerDisposable(
			term.onData(data => {
				sendInput(data);
			}),
		);

		// Don't intercept paste shortcuts - let them pass through to CLI
		// CLI handles paste via its own keyboard shortcuts (Ctrl+V on MacOS, Alt+V on Windows)
		term.attachCustomKeyEventHandler(event => {
			// Always return true to let events pass through to CLI
			return true;
		});

		const handleWindowMessage = event => {
			const message = event.data;
			if (!message || typeof message.type !== 'string') {
				return;
			}

			const messageHandlers = {
				output: payload => {
					if (typeof payload.data !== 'string') {
						return;
					}
					lastOutputAt = Date.now();
					bytesPendingRender += payload.data.length;
					term.write(payload.data, () => {
						lastWriteParsedAt = Date.now();
					});
				},
				clear: () => {
					term.clear();
				},
				reset: () => {
					term.reset();
					fitTerminal();
				},
				fit: () => {
					fitTerminal();
				},
				focus: () => {
					scheduleFocusRecovery();
				},
				updateFont: payload => {
					applyTermOption(term.options, 'fontFamily', payload.fontFamily);
					applyTermOption(term.options, 'fontSize', payload.fontSize);
					applyTermOption(term.options, 'fontWeight', payload.fontWeight);
					applyTermOption(term.options, 'lineHeight', payload.lineHeight);
					fitTerminal();
					scheduleFocusRecovery();
				},
				exit: payload => {
					term.write(`\r\n\r\n[Process exited with code ${payload.code}]\r\n`);
				},
				fileDrop: payload => {
					if (!Array.isArray(payload.paths) || payload.paths.length === 0) {
						return;
					}
					sendInput(formatPathsForTerminal(payload.paths));
				},
			};

			const handler = messageHandlers[message.type];
			if (typeof handler === 'function') {
				handler(message);
			}
		};

		const handleDragOver = event => {
			event.preventDefault();
			event.stopPropagation();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
			container.classList.add('drag-over');
		};

		const handleDragLeave = event => {
			event.preventDefault();
			container.classList.remove('drag-over');
		};

		const handleDrop = event => {
			event.preventDefault();
			event.stopPropagation();
			container.classList.remove('drag-over');

			const dataTransfer = event.dataTransfer;
			if (!dataTransfer) {
				return;
			}

			const paths = extractPathsFromDataTransfer(dataTransfer);
			if (paths.length > 0) {
				sendInput(formatPathsForTerminal(paths));
				scheduleFocusRecovery();
			}
		};

		const handleContextMenu = event => {
			event.preventDefault();
			const selection = term.getSelection();
			if (selection) {
				navigator.clipboard.writeText(selection).catch(() => {
					// Ignore clipboard write failures.
				});
				term.clearSelection();
				return;
			}

			navigator.clipboard
				.readText()
				.then(text => {
					sendInput(text);
				})
				.catch(() => {
					// Ignore clipboard read failures.
				});
		};

		addManagedListener(container, 'mousedown', () => {
			scheduleFocusRecovery();
		});
		addManagedListener(document, 'visibilitychange', () => {
			if (!document.hidden) {
				scheduleFocusRecovery();
			}
		});
		addManagedListener(window, 'focus', () => {
			scheduleFocusRecovery();
		});
		addManagedListener(container, 'contextmenu', handleContextMenu);
		addManagedListener(container, 'dragover', handleDragOver);
		addManagedListener(container, 'dragleave', handleDragLeave);
		addManagedListener(container, 'drop', handleDrop);
		addManagedListener(window, 'message', handleWindowMessage);
		addManagedListener(window, 'beforeunload', runCleanups);

		registerCleanup(() => {
			clearFocusRecoveryTimers();
			clearInterval(rendererHealthTimer);
			clearResizeDebounceTimer();
			clearTimeout(initialFitTimer);
			resizeObserver.disconnect();
		});

		tryEnableWebgl();
		scheduleFocusRecovery();
		vscode.postMessage({type: 'ready'});
	} catch (error) {
		if (error instanceof Error) {
			showError(error.stack || error.message);
			return;
		}
		showError(String(error));
	}
})();
