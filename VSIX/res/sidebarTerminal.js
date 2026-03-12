(function () {
	const vscode = acquireVsCodeApi();

	const normalizeLogMessage = value => {
		if (typeof value === 'string') {
			const trimmed = value.trim();
			if (trimmed) {
				return trimmed;
			}
		}
		try {
			return String(value);
		} catch {
			return 'Unknown frontend log message';
		}
	};

	const stringifyLogDetails = value => {
		if (typeof value === 'undefined' || value === null) {
			return undefined;
		}
		if (typeof value === 'string') {
			const trimmed = value.trim();
			return trimmed || undefined;
		}
		if (value instanceof Error) {
			return value.stack || value.message;
		}
		try {
			return JSON.stringify(
				value,
				(_key, entry) => {
					if (entry instanceof Error) {
						return {
							name: entry.name,
							message: entry.message,
							stack: entry.stack,
						};
					}
					return typeof entry === 'bigint' ? entry.toString() : entry;
				},
				2,
			);
		} catch {
			try {
				return String(value);
			} catch {
				return 'Unserializable log details';
			}
		}
	};

	const bridgeFrontendLog = (level, message, details) => {
		const normalizedMessage = normalizeLogMessage(message);
		const normalizedDetails = stringifyLogDetails(details);
		const consoleMethod =
			level === 'error'
				? 'error'
				: level === 'warn'
					? 'warn'
					: level === 'debug'
						? 'debug'
						: 'info';
		const logToConsole =
			typeof console[consoleMethod] === 'function'
				? console[consoleMethod].bind(console)
				: console.log.bind(console);
		const consolePrefix =
			`[Snow CLI][SidebarTerminal][${level.toUpperCase()}] ${normalizedMessage}`;

		if (typeof normalizedDetails === 'string') {
			logToConsole(consolePrefix, normalizedDetails);
		} else {
			logToConsole(consolePrefix);
		}

		try {
			vscode.postMessage({
				type: 'frontendLog',
				level,
				message: normalizedMessage,
				details: normalizedDetails,
			});
		} catch {
			// Ignore logging bridge failures.
		}
	};

	const logInfo = (message, details) => {
		bridgeFrontendLog('info', message, details);
	};

	const logWarn = (message, details) => {
		bridgeFrontendLog('warn', message, details);
	};

	const logError = (message, details) => {
		bridgeFrontendLog('error', message, details);
	};

	const tabStrip = document.getElementById('terminal-tab-strip');
	if (!(tabStrip instanceof HTMLElement)) {
		logError('Terminal tab strip element was not found.');
		return;
	}

	const container = document.getElementById('terminal-container');
	if (!(container instanceof HTMLElement)) {
		logError('Terminal container element was not found.');
		return;
	}

	const showError = msg => {
		for (const overlay of container.querySelectorAll('.terminal-freeze-overlay')) {
			overlay.remove();
		}
		container.classList.add('terminal-error');
		container.textContent = `Terminal Error:\n${msg}`;
		logError('Terminal UI error displayed.', msg);
	};

	const getOptionalButton = buttonId => {
		const button = document.getElementById(buttonId);
		if (button instanceof HTMLButtonElement) {
			return button;
		}
		if (button !== null) {
			logWarn(
				'Renderer test control element is not a button.',
				`id=${buttonId}`,
			);
		}
		return undefined;
	};

	const renderStallTestButton = getOptionalButton('terminal-test-render-stall');
	const contextLossTestButton = getOptionalButton('terminal-test-context-loss');

	const getGlobalConstructor = (globalName, memberName) => {
		const globalValue = globalThis[globalName];
		if (typeof memberName !== 'string') {
			return typeof globalValue === 'function' ? globalValue : undefined;
		}
		const constructorValue = globalValue && globalValue[memberName];
		return typeof constructorValue === 'function' ? constructorValue : undefined;
	};

	const TerminalCtor = getGlobalConstructor('Terminal');
	const FitAddonCtor = getGlobalConstructor('FitAddon', 'FitAddon');
	const WebLinksAddonCtor = getGlobalConstructor(
		'WebLinksAddon',
		'WebLinksAddon',
	);
	const Unicode11AddonCtor = getGlobalConstructor(
		'Unicode11Addon',
		'Unicode11Addon',
	);
	const WebglAddonCtor = getGlobalConstructor('WebglAddon', 'WebglAddon');

	const requiredAddons = [
		['Terminal', typeof TerminalCtor],
		['FitAddon', typeof FitAddonCtor],
		['WebLinksAddon', typeof WebLinksAddonCtor],
	];
	for (const [name, type] of requiredAddons) {
		if (type === 'undefined') {
			const errorMessage = `${name} failed to load.${
				name === 'Terminal' ? ' Check CSP or resource paths.' : ''
			}`;
			showError(errorMessage);
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

	const applyTermOption = (options, key, value) => {
		if (typeof value === 'string' && value) {
			options[key] = value;
		} else if (typeof value === 'number' && Number.isFinite(value)) {
			options[key] = value;
		}
	};

	const createTimerRegistry = () => {
		const timers = new Map();

		const clearTimer = key => {
			const timer = timers.get(key);
			if (typeof timer === 'undefined' || timer === null) {
				return;
			}
			clearTimeout(timer);
			timers.set(key, null);
		};

		const scheduleTimer = (key, callback, delayMs) => {
			clearTimer(key);
			const timer = setTimeout(() => {
				timers.set(key, null);
				callback();
			}, delayMs);
			timers.set(key, timer);
			return timer;
		};

		const clearAllTimers = () => {
			for (const key of Array.from(timers.keys())) {
				clearTimer(key);
			}
		};

		return {
			clearTimer,
			scheduleTimer,
			clearAllTimers,
		};
	};

	const createFocusRecoveryController = ({term, cooldownMs, delaysMs}) => {
		let focusRecoveryTimers = [];
		let focusRecoveryCooldownUntil = 0;

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
			focusRecoveryCooldownUntil = now + cooldownMs;
			clearFocusRecoveryTimers();
			for (const delay of delaysMs) {
				const timer = setTimeout(() => {
					focusRecoveryTimers = focusRecoveryTimers.filter(
						entry => entry !== timer,
					);
					term.focus();
				}, delay);
				focusRecoveryTimers.push(timer);
			}
		};

		return {
			clearFocusRecoveryTimers,
			scheduleFocusRecovery,
		};
	};

	const createLayoutController = ({
		term,
		container,
		fitAddon,
		setRendererHealthSuspended,
		suspendAfterLayoutMs,
		scheduleTimer,
		resizeDebounceTimerKey,
	}) => {
		const RESIZE_FILL_TOLERANCE_PX = 2;
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
			setRendererHealthSuspended(suspendAfterLayoutMs);
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
			scheduleTimer(resizeDebounceTimerKey, () => {
				fitTerminal();
			}, 50);
		};

		return {
			fitTerminal,
			scheduleFit,
		};
	};

	const createWindowMessageRouter = ({messageHandlers}) => {
		return event => {
			const message = event.data;
			if (!message || typeof message.type !== 'string') {
				return;
			}

			const handler = messageHandlers[message.type];
			if (typeof handler !== 'function') {
				logWarn('Unhandled extension message type.', `type=${message.type}`);
				return;
			}

			try {
				handler(message);
			} catch (error) {
				logError(`Failed to handle extension message: ${message.type}`, error);
			}
		};
	};

	const createClipboardAndContextController = ({term, sendInput}) => {
		const isMacPlatform = /mac/i.test(navigator.userAgent);

		const allowTerminalKeyEvent = event => {
			if (
				!isMacPlatform &&
				event.type === 'keydown' &&
				event.ctrlKey &&
				!event.shiftKey &&
				!event.altKey &&
				!event.metaKey &&
				event.key.toLowerCase() === 'v'
			) {
				return false;
			}
			return true;
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

		return {
			allowTerminalKeyEvent,
			handleContextMenu,
		};
	};

	const createWindowLifecycleController = ({
		scheduleFocusRecovery,
		setRendererHealthSuspended,
		suspendAfterLayoutMs,
		getActiveRendererMode,
		getLastWebglFailureReason,
		scheduleWebglRecoveryAttempt,
		webglRecoveryRecheckMs,
	}) => {
		const handleContainerMouseDown = () => {
			scheduleFocusRecovery();
		};

		const handleVisibilityChange = () => {
			if (document.hidden) {
				return;
			}
			setRendererHealthSuspended(suspendAfterLayoutMs);
			scheduleFocusRecovery();
			const lastFailureReason = getLastWebglFailureReason();
			if (getActiveRendererMode() !== 'webgl' && lastFailureReason) {
				scheduleWebglRecoveryAttempt(
					lastFailureReason,
					webglRecoveryRecheckMs,
				);
			}
		};

		const handleWindowFocus = () => {
			setRendererHealthSuspended(suspendAfterLayoutMs);
			scheduleFocusRecovery();
		};

		return {
			handleContainerMouseDown,
			handleVisibilityChange,
			handleWindowFocus,
		};
	};

	try {
		const {
			registerCleanup,
			runCleanups,
			addManagedListener,
			registerDisposable,
		} = createCleanupRegistry();
logInfo('Initializing sidebar terminal frontend.');

		let currentTabId;
		let tabStates = [];

		const normalizeTabState = value => {
			if (!value || typeof value !== 'object') {
				return undefined;
			}
			const id = typeof value.id === 'string' ? value.id : '';
			const title = typeof value.title === 'string' ? value.title : '';
			if (!id || !title) {
				return undefined;
			}
			return {
				id,
				title,
				isActive: Boolean(value.isActive),
				isRunning: Boolean(value.isRunning),
				isRestarting: Boolean(value.isRestarting),
				exitCode:
					typeof value.exitCode === 'number' && Number.isFinite(value.exitCode)
						? value.exitCode
						: undefined,
			};
		};

		const revealTabItem = item => {
			if (!(item instanceof HTMLElement)) {
				return;
			}
			window.requestAnimationFrame(() => {
				const visibleLeft = tabStrip.scrollLeft;
				const visibleRight = visibleLeft + tabStrip.clientWidth;
				const itemLeft = item.offsetLeft;
				const itemRight = itemLeft + item.offsetWidth;
				if (itemLeft < visibleLeft) {
					tabStrip.scrollLeft = itemLeft;
					return;
				}
				if (itemRight > visibleRight) {
					tabStrip.scrollLeft = Math.max(0, itemRight - tabStrip.clientWidth);
				}
			});
		};

		const renderTabs = () => {
			tabStrip.replaceChildren();
			if (tabStates.length === 0) {
				return;
			}
			let activeItem;
			for (const tab of tabStates) {
				const item = document.createElement('div');
				item.className = 'terminal-tab-item';
				item.dataset.tabId = tab.id;
				if (tab.isActive) {
					item.classList.add('is-active');
					activeItem = item;
				}
				if (tab.isRestarting) {
					item.classList.add('is-restarting');
				}

				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'terminal-tab';
				button.setAttribute('role', 'tab');
				button.setAttribute('aria-selected', tab.isActive ? 'true' : 'false');
				button.setAttribute('aria-controls', 'terminal-container');
				button.title = tab.title;

				const label = document.createElement('span');
				label.className = 'terminal-tab-label';
				label.textContent = tab.title;
				button.appendChild(label);

				button.addEventListener('click', () => {
					if (tab.id === currentTabId) {
						return;
					}
					vscode.postMessage({type: 'switchTab', tabId: tab.id});
				});

				const closeButton = document.createElement('button');
				closeButton.type = 'button';
				closeButton.className = 'terminal-tab-close';
				if (tab.isRestarting) {
					const spinner = document.createElement('span');
					spinner.className = 'terminal-tab-spinner';
					closeButton.setAttribute('aria-label', `${tab.title} is restarting`);
					closeButton.title = `${tab.title} is restarting`;
					closeButton.disabled = true;
					closeButton.appendChild(spinner);
				} else {
					closeButton.setAttribute('aria-label', `Close ${tab.title}`);
					closeButton.title = `Close ${tab.title}`;
					closeButton.textContent = '×';
					closeButton.addEventListener('click', event => {
						event.preventDefault();
						event.stopPropagation();
						vscode.postMessage({type: 'closeTab', tabId: tab.id});
					});
				}

				item.appendChild(button);
				item.appendChild(closeButton);
				tabStrip.appendChild(item);
			}
			if (activeItem) {
				revealTabItem(activeItem);
			}
		};

		const applyTabs = nextTabs => {
			const normalizedTabs = Array.isArray(nextTabs)
				? nextTabs.map(normalizeTabState).filter(Boolean)
				: [];
			if (normalizedTabs.length === 0) {
				tabStates = [];
				currentTabId = undefined;
				renderTabs();
				return;
			}
			const activeTab =
				normalizedTabs.find(tab => tab.isActive) || normalizedTabs[0];
			currentTabId = activeTab.id;
			tabStates = normalizedTabs.map(tab => ({
				...tab,
				isActive: tab.id === activeTab.id,
			}));
			renderTabs();
		};

		const sendInput = text => {


			if (typeof text !== 'string' || text.length === 0) {
				return;
			}
			vscode.postMessage({type: 'input', data: text});
		};

		const term = new TerminalCtor({
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

		const fitAddon = new FitAddonCtor();
		const webLinksAddon = new WebLinksAddonCtor();
		term.loadAddon(fitAddon);
		term.loadAddon(webLinksAddon);

		if (typeof Unicode11AddonCtor === 'function') {
			try {
				const unicode11Addon = new Unicode11AddonCtor();
				term.loadAddon(unicode11Addon);
				try {
					term.unicode.activeVersion = '11';
					logInfo('Unicode version 11 activated.');
				} catch (error) {
					logWarn('Failed to activate Unicode version 11.', error);
				}
			} catch (error) {
				logWarn('Unicode11Addon failed to load.', error);
			}
		}

		term.open(container);
		const TIMER_KEYS = {
			resizeDebounce: 'resizeDebounce',
			webglRecovery: 'webglRecovery',
			silentWebglRecovery: 'silentWebglRecovery',
			rendererFreezeRelease: 'rendererFreezeRelease',
			webglStability: 'webglStability',
		};
		const FOCUS_RECOVERY_DELAYS_MS = [0, 80, 240];
		const FOCUS_RECOVERY_COOLDOWN_MS = 400;

		const RENDER_STALL_TIMEOUT_MS = 10000;
		const RENDER_STALL_CHECK_INTERVAL_MS = 2000;
		const RENDER_STALL_WRITE_ACTIVITY_GRACE_MS = 1000;
		const RENDERER_HEALTH_SUSPEND_AFTER_LAYOUT_MS = 2500;
		const RENDERER_HEALTH_SUSPEND_AFTER_WEBGL_ENABLE_MS = 4000;
		const WEBGL_RECOVERY_RECHECK_MS = 2000;
		const WEBGL_RECOVERY_SUSPEND_DEFER_MIN_MS = 250;
		const WEBGL_RECOVERY_DELAY_STEPS_MS = [1000, 5000, 15000];
		const WEBGL_STABILITY_RESET_MS = 30000;
		const SILENT_WEBGL_RECOVERY_DELAY_MS = 180;
		const RENDERER_FREEZE_RELEASE_FALLBACK_MS = 120;

		const {clearTimer, scheduleTimer, clearAllTimers} = createTimerRegistry();
		const {clearFocusRecoveryTimers, scheduleFocusRecovery} =
			createFocusRecoveryController({
				term,
				cooldownMs: FOCUS_RECOVERY_COOLDOWN_MS,
				delaysMs: FOCUS_RECOVERY_DELAYS_MS,
			});

		let webglAddon = null;
		let activeRendererMode = 'fallback';
		let lastOutputAt = 0;
		let lastRenderAt = Date.now();
		let lastWriteParsedAt = 0;
		let lastWriteCallbackAt = 0;
		let bytesPendingRender = 0;
		let pendingVisualUpdate = false;
		let pendingRenderSince = 0;
		let rendererStallReportedAt = 0;
		let rendererHealthSuspendedUntil =
			Date.now() + RENDERER_HEALTH_SUSPEND_AFTER_LAYOUT_MS;
		let webglFailureCount = 0;
		let lastWebglFailureReason = undefined;
		let lastWebglEscalationRequestedAt = 0;
		let rendererRecoveryCycleId = 0;
		let currentRecoveryCycleId = 0;
		let currentRecoveryAttemptId = 0;
		let rendererStallWriteGracePendingSince = 0;
		let rendererStallWriteGraceUntil = 0;
		let rendererFreezeOverlay = null;
		let rendererFreezeReleasePending = false;
		let rendererFallbackPending = false;

		const clearWebglRecoveryTimer = () => {
			clearTimer(TIMER_KEYS.webglRecovery);
		};

		const clearWebglStabilityTimer = () => {
			clearTimer(TIMER_KEYS.webglStability);
		};

		const isContainerVisible = () => {
			if (document.hidden) {
				return false;
			}
			const rect = container.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		};

		const setRendererHealthSuspended = durationMs => {
			if (typeof durationMs !== 'number' || durationMs <= 0) {
				return;
			}
			const suspendedUntil = Date.now() + durationMs;
			if (suspendedUntil > rendererHealthSuspendedUntil) {
				rendererHealthSuspendedUntil = suspendedUntil;
			}
		};

		const getRendererHealthSuspendedRemainingMs = now =>
			Math.max(0, rendererHealthSuspendedUntil - now);

		const clearRendererStallWriteGrace = () => {
			rendererStallWriteGracePendingSince = 0;
			rendererStallWriteGraceUntil = 0;
		};

		const getWebglRecoveryDelayMs = delayMs => {
			const nextDelayMs = Math.max(0, Math.floor(delayMs));
			const suspendedRemainingMs =
				getRendererHealthSuspendedRemainingMs(Date.now());
			if (suspendedRemainingMs <= 0) {
				return nextDelayMs;
			}
			return Math.max(
				nextDelayMs,
				WEBGL_RECOVERY_SUSPEND_DEFER_MIN_MS,
				suspendedRemainingMs,
			);
		};

		const postRendererHealth = (stage, reason, extraStats) => {
			const now = Date.now();
			try {
				vscode.postMessage({
					type: 'rendererHealth',
					stage,
					reason,
					stats: {
						activeRendererMode,
						pendingVisualUpdate,
						pendingDurationMs:
							pendingVisualUpdate && pendingRenderSince > 0
								? now - pendingRenderSince
								: 0,
						sinceLastRenderMs:
							lastRenderAt > 0 ? now - lastRenderAt : undefined,
						sinceLastOutputMs:
							lastOutputAt > 0 ? now - lastOutputAt : undefined,
						sinceLastWriteParsedMs:
							lastWriteParsedAt > 0 ? now - lastWriteParsedAt : undefined,
						sinceLastWriteCallbackMs:
							lastWriteCallbackAt > 0 ? now - lastWriteCallbackAt : undefined,
						bytesPendingRender,
						webglFailureCount,
						rendererRecoveryCycleId: currentRecoveryCycleId || undefined,
						rendererRecoveryAttemptId: currentRecoveryAttemptId || undefined,
						rendererHealthSuspendedForMs:
							getRendererHealthSuspendedRemainingMs(now),
						lastWebglFailureReason,
						...(extraStats || {}),
					},
				});
			} catch {
				// Ignore renderer health bridge failures.
			}
		};

		const {fitTerminal, scheduleFit} = createLayoutController({
			term,
			container,
			fitAddon,
			setRendererHealthSuspended,
			suspendAfterLayoutMs: RENDERER_HEALTH_SUSPEND_AFTER_LAYOUT_MS,
			scheduleTimer,
			resizeDebounceTimerKey: TIMER_KEYS.resizeDebounce,
		});

		const copyFreezeCanvasBitmap = (sourceCanvas, targetCanvas) => {
			try {
				targetCanvas.width = sourceCanvas.width;
				targetCanvas.height = sourceCanvas.height;
				targetCanvas.style.width = sourceCanvas.style.width;
				targetCanvas.style.height = sourceCanvas.style.height;
				const context = targetCanvas.getContext('2d');
				if (!context) {
					return;
				}
				context.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
				context.drawImage(sourceCanvas, 0, 0);
			} catch {
				// Ignore canvas snapshot failures.
			}
		};

		const createRendererFreezeOverlay = () => {
			if (rendererFreezeOverlay) {
				return true;
			}
			const terminalElement = container.querySelector('.xterm');
			if (!(terminalElement instanceof HTMLElement)) {
				return false;
			}
			const terminalClone = terminalElement.cloneNode(true);
			if (!(terminalClone instanceof HTMLElement)) {
				return false;
			}
			const sourceCanvases = terminalElement.querySelectorAll('canvas');
			const targetCanvases = terminalClone.querySelectorAll('canvas');
			for (let index = 0; index < targetCanvases.length; index += 1) {
				const sourceCanvas = sourceCanvases[index];
				const targetCanvas = targetCanvases[index];
				if (
					sourceCanvas instanceof HTMLCanvasElement &&
					targetCanvas instanceof HTMLCanvasElement
				) {
					copyFreezeCanvasBitmap(sourceCanvas, targetCanvas);
				}
			}
			const sourceScrollable = terminalElement.querySelector(
				'.xterm-scrollable-element',
			);
			const targetScrollable = terminalClone.querySelector(
				'.xterm-scrollable-element',
			);
			if (
				sourceScrollable instanceof HTMLElement &&
				targetScrollable instanceof HTMLElement
			) {
				targetScrollable.scrollTop = sourceScrollable.scrollTop;
				targetScrollable.scrollLeft = sourceScrollable.scrollLeft;
			}
			const overlay = document.createElement('div');
			overlay.className = 'terminal-freeze-overlay';
			overlay.appendChild(terminalClone);
			container.appendChild(overlay);
			rendererFreezeOverlay = overlay;
			return true;
		};

		const removeRendererFreezeOverlay = () => {
			if (!rendererFreezeOverlay) {
				return;
			}
			rendererFreezeOverlay.remove();
			rendererFreezeOverlay = null;
		};

		const releaseRendererFreezeOverlay = () => {
			clearTimer(TIMER_KEYS.rendererFreezeRelease);
			rendererFreezeReleasePending = false;
			removeRendererFreezeOverlay();
		};

		const scheduleRendererFreezeRelease = () => {
			if (!rendererFreezeOverlay) {
				return;
			}
			rendererFreezeReleasePending = true;
			scheduleTimer(
				TIMER_KEYS.rendererFreezeRelease,
				() => {
					releaseRendererFreezeOverlay();
				},
				RENDERER_FREEZE_RELEASE_FALLBACK_MS,
			);
		};

		const clearSilentWebglRecoveryTimer = () => {
			clearTimer(TIMER_KEYS.silentWebglRecovery);
		};

		const scheduleWebglStabilityReset = () => {
			scheduleTimer(TIMER_KEYS.webglStability, () => {
				if (activeRendererMode !== 'webgl' || !webglAddon) {
					return;
				}
				if (webglFailureCount > 0 || lastWebglFailureReason) {
					logInfo('WebGL renderer marked stable after recovery window.');
				}
				webglFailureCount = 0;
				lastWebglFailureReason = undefined;
				lastWebglEscalationRequestedAt = 0;
			}, WEBGL_STABILITY_RESET_MS);
		};

		const disposeWebglAddon = () => {
			try {
				if (webglAddon) {
					webglAddon.dispose();
				}
			} catch {
				// Ignore dispose failures for already-lost context.
			}
			webglAddon = null;
		};

		const requestWebglRecoveryEscalation = reason => {
			const now = Date.now();
			if (now - lastWebglEscalationRequestedAt < RENDER_STALL_TIMEOUT_MS) {
				return;
			}
			lastWebglEscalationRequestedAt = now;
			logWarn(
				'Local WebGL recovery exhausted; requesting provider escalation.',
				reason ? `reason=${reason}` : undefined,
			);
			postRendererHealth('escalation-requested', reason);
		};

		const runRendererHealthTest = reason => {
			logWarn(
				'Manual renderer health test requested.',
				`reason=${reason}, activeRendererMode=${activeRendererMode}, webglActive=${Boolean(webglAddon)}`,
			);
			if (activeRendererMode !== 'webgl' || !webglAddon) {
				scheduleWebglRecoveryAttempt(reason, WEBGL_RECOVERY_RECHECK_MS);
				return;
			}
			degradeRenderer(reason);
		};

		const commitVisibleFallbackRenderer = reason => {
			rendererFallbackPending = false;
			clearSilentWebglRecoveryTimer();
			activeRendererMode = 'fallback';
			try {
				if (term.rows > 0) {
					term.refresh(0, term.rows - 1);
				}
			} catch {
				// Ignore refresh errors after renderer fallback.
			}
			fitTerminal();
			scheduleFocusRecovery();
			scheduleRendererFreezeRelease();
			postRendererHealth('degraded', reason, {
				rendererRecoveryCycleId: currentRecoveryCycleId,
				rendererRecoveryAttemptId: currentRecoveryAttemptId,
			});
			const delayMs = WEBGL_RECOVERY_DELAY_STEPS_MS[webglFailureCount - 1];
			if (typeof delayMs === 'number') {
				scheduleWebglRecoveryAttempt(reason, delayMs);
				return;
			}
			requestWebglRecoveryEscalation(reason);
		};

		const attemptSilentWebglRecovery = reason => {
			if (!rendererFallbackPending) {
				return;
			}
			if (!isContainerVisible()) {
				commitVisibleFallbackRenderer(reason);
				return;
			}
			logInfo(
				'Attempting silent WebGL recovery before visible fallback.',
				`cycle=${currentRecoveryCycleId || 'n/a'}, reason=${reason || 'unknown'}, failureCount=${webglFailureCount}`,
			);
			if (
				tryEnableWebgl(reason || 'silent-recovery', {
					fitAfterEnable: false,
					focusAfterEnable: false,
					emitRestoredHealth: false,
					releaseFreezeOnFailure: false,
				})
			) {
				logInfo(
					'Silent WebGL recovery succeeded without visible fallback.',
					`cycle=${currentRecoveryCycleId || 'n/a'}, reason=${reason || 'unknown'}, failureCount=${webglFailureCount}`,
				);
				return;
			}
			commitVisibleFallbackRenderer(lastWebglFailureReason || reason);
		};

		const scheduleSilentWebglRecovery = reason => {
			if (!rendererFallbackPending) {
				return;
			}
			scheduleTimer(
				TIMER_KEYS.silentWebglRecovery,
				() => {
					attemptSilentWebglRecovery(reason);
				},
				SILENT_WEBGL_RECOVERY_DELAY_MS,
			);
		};

		const scheduleWebglRecoveryAttempt = (reason, delayMs) => {
			if (activeRendererMode === 'webgl' || webglAddon) {
				return;
			}
			if (webglFailureCount > WEBGL_RECOVERY_DELAY_STEPS_MS.length) {
				requestWebglRecoveryEscalation(reason);
				return;
			}
			const nextDelay = getWebglRecoveryDelayMs(delayMs);
			const nextAttemptId = currentRecoveryAttemptId + 1;
			scheduleTimer(TIMER_KEYS.webglRecovery, () => {
				attemptWebglRecovery(reason, nextAttemptId);
			}, nextDelay);
			logInfo(
				'Scheduled WebGL recovery attempt.',
				`cycle=${currentRecoveryCycleId || 'n/a'}, attempt=${nextAttemptId}, reason=${reason || 'unknown'}, delayMs=${nextDelay}, failureCount=${webglFailureCount}`,
			);
			postRendererHealth('webgl-retry-scheduled', reason, {
				scheduledRecoveryDelayMs: nextDelay,
				rendererRecoveryAttemptId: nextAttemptId,
			});
		};

		const isWebglAddonAvailable = () => typeof WebglAddonCtor === 'function';

		const tryEnableWebgl = (reason, options = {}) => {
			const fitAfterEnable = options.fitAfterEnable !== false;
			const focusAfterEnable = options.focusAfterEnable !== false;
			const emitRestoredHealth = options.emitRestoredHealth !== false;
			const releaseFreezeOnFailure = options.releaseFreezeOnFailure !== false;
			if (webglAddon) {
				return true;
			}
			if (!isWebglAddonAvailable()) {
				logWarn(
					'WebGL addon unavailable; staying on fallback renderer.',
					reason ? `reason=${reason}` : undefined,
				);
				return false;
			}

			try {
				webglAddon = new WebglAddonCtor();
				term.loadAddon(webglAddon);
				activeRendererMode = 'webgl';
				rendererStallReportedAt = 0;
				lastRenderAt = Date.now();
				setRendererHealthSuspended(
					RENDERER_HEALTH_SUSPEND_AFTER_WEBGL_ENABLE_MS,
				);
				clearWebglRecoveryTimer();
				scheduleWebglStabilityReset();
				logInfo(
					'WebGL renderer enabled.',
					reason
						? `reason=${reason}, failureCount=${webglFailureCount}`
						: `failureCount=${webglFailureCount}`,
				);
				if (typeof webglAddon.onContextLoss === 'function') {
					webglAddon.onContextLoss(() => {
						degradeRenderer('context-loss');
					});
				}
				try {
					if (term.rows > 0) {
						term.refresh(0, term.rows - 1);
					}
				} catch {
					// Ignore refresh errors during WebGL enable.
				}
				if (fitAfterEnable) {
					fitTerminal();
				}
				if (focusAfterEnable) {
					scheduleFocusRecovery();
				}
				scheduleRendererFreezeRelease();
				if (emitRestoredHealth) {
					postRendererHealth('webgl-restored', reason);
				}
				clearSilentWebglRecoveryTimer();
				rendererFallbackPending = false;
				return true;
			} catch (error) {
				activeRendererMode = 'fallback';
				webglAddon = null;
				lastWebglFailureReason = 'webgl-load-failed';
				logWarn(
					'WebGL addon failed to load.',
					reason
						? {reason, error: stringifyLogDetails(error)}
						: error,
				);
				if (releaseFreezeOnFailure) {
					releaseRendererFreezeOverlay();
				}
				return false;
			}
		};

		const attemptWebglRecovery = (reason, attemptId) => {
			if (activeRendererMode === 'webgl' || webglAddon) {
				return;
			}
			if (!isContainerVisible()) {
				logInfo(
					'Deferred WebGL recovery attempt because container is not visible.',
					`cycle=${currentRecoveryCycleId || 'n/a'}, attempt=${attemptId || 'n/a'}, reason=${reason || 'unknown'}`,
				);
				scheduleWebglRecoveryAttempt(reason, WEBGL_RECOVERY_RECHECK_MS);
				return;
			}
			const now = Date.now();
			const suspendedRemainingMs =
				getRendererHealthSuspendedRemainingMs(now);
			if (suspendedRemainingMs > 0) {
				logInfo(
					'Deferred WebGL recovery attempt because renderer health is suspended.',
					`cycle=${currentRecoveryCycleId || 'n/a'}, attempt=${attemptId || 'n/a'}, suspendedMs=${suspendedRemainingMs}`,
				);
				scheduleWebglRecoveryAttempt(
					reason,
					Math.max(
						WEBGL_RECOVERY_SUSPEND_DEFER_MIN_MS,
						suspendedRemainingMs,
					),
				);
				return;
			}
			currentRecoveryAttemptId = attemptId || currentRecoveryAttemptId + 1;
			const attemptNumber = Math.max(1, webglFailureCount);
			clearTimer(TIMER_KEYS.rendererFreezeRelease);
			rendererFreezeReleasePending = false;
			removeRendererFreezeOverlay();
			createRendererFreezeOverlay();
			logInfo(
				'Attempting to restore WebGL renderer.',
				`cycle=${currentRecoveryCycleId || 'n/a'}, attempt=${currentRecoveryAttemptId}, reason=${reason || 'unknown'}, failureCount=${webglFailureCount}, heuristicAttempt=${attemptNumber}`,
			);
			if (
				tryEnableWebgl(reason || 'recovery', {
					fitAfterEnable: false,
					focusAfterEnable: false,
				})
			) {
				return;
			}
			webglFailureCount += 1;
			lastWebglFailureReason = 'webgl-load-failed';
			const delayMs = WEBGL_RECOVERY_DELAY_STEPS_MS[webglFailureCount - 1];
			if (typeof delayMs === 'number') {
				scheduleWebglRecoveryAttempt(lastWebglFailureReason, delayMs);
				return;
			}
			requestWebglRecoveryEscalation(lastWebglFailureReason);
		};

		const degradeRenderer = reason => {
			if (activeRendererMode !== 'webgl' && !webglAddon) {
				return;
			}
			rendererRecoveryCycleId += 1;
			currentRecoveryCycleId = rendererRecoveryCycleId;
			currentRecoveryAttemptId = 0;
			activeRendererMode = 'recovering';
			lastWebglFailureReason = reason;
			webglFailureCount += 1;
			rendererFallbackPending = true;
			clearRendererStallWriteGrace();
			clearWebglStabilityTimer();
			clearWebglRecoveryTimer();
			clearSilentWebglRecoveryTimer();
			clearTimer(TIMER_KEYS.rendererFreezeRelease);
			rendererFreezeReleasePending = false;
			removeRendererFreezeOverlay();
			logWarn(
				'Renderer degraded; freezing current frame before recovery.',
				reason
					? `cycle=${currentRecoveryCycleId}, reason=${reason}, failureCount=${webglFailureCount}`
					: `cycle=${currentRecoveryCycleId}, failureCount=${webglFailureCount}`,
			);
			const hasFreezeOverlay =
				isContainerVisible() && createRendererFreezeOverlay();
			disposeWebglAddon();
			if (!hasFreezeOverlay) {
				commitVisibleFallbackRenderer(reason);
				return;
			}
			scheduleSilentWebglRecovery(reason);
		};

		const rendererHealthTimer = setInterval(() => {
			if (activeRendererMode !== 'webgl' || !webglAddon) {
				return;
			}
			if (!isContainerVisible()) {
				return;
			}
			if (!pendingVisualUpdate || pendingRenderSince <= 0) {
				return;
			}

			const now = Date.now();
			if (now < rendererHealthSuspendedUntil) {
				return;
			}
			if (now - rendererStallReportedAt < RENDER_STALL_TIMEOUT_MS) {
				return;
			}
			const hasCoreRenderStall =
				now - pendingRenderSince >= RENDER_STALL_TIMEOUT_MS &&
				now - lastRenderAt >= RENDER_STALL_TIMEOUT_MS;
			if (!hasCoreRenderStall) {
				clearRendererStallWriteGrace();
				return;
			}

			const lastWriteActivityAt = Math.max(
				lastWriteParsedAt || 0,
				lastWriteCallbackAt || 0,
			);
			if (
				lastWriteActivityAt > 0 &&
				now - lastWriteActivityAt <= RENDER_STALL_WRITE_ACTIVITY_GRACE_MS
			) {
				const nextGraceUntil =
					lastWriteActivityAt + RENDER_STALL_WRITE_ACTIVITY_GRACE_MS;
				if (
					rendererStallWriteGracePendingSince !== pendingRenderSince ||
					nextGraceUntil > rendererStallWriteGraceUntil
				) {
					rendererStallWriteGracePendingSince = pendingRenderSince;
					rendererStallWriteGraceUntil = nextGraceUntil;
					return;
				}
				if (now < rendererStallWriteGraceUntil) {
					return;
				}
			}

			clearRendererStallWriteGrace();
			rendererStallReportedAt = now;
			degradeRenderer('render-stall');
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
				pendingVisualUpdate = false;
				pendingRenderSince = 0;
				clearRendererStallWriteGrace();
				if (rendererFreezeReleasePending) {
					releaseRendererFreezeOverlay();
				}
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

		const {allowTerminalKeyEvent, handleContextMenu} =
			createClipboardAndContextController({term, sendInput});

		// On macOS, Ctrl+V passes through to CLI which handles paste (including images).
		// On Windows/Linux, Ctrl+V must be intercepted to suppress the raw \x16 that
		// xterm would otherwise emit.  We return false so xterm ignores the keydown,
		// but do NOT call preventDefault — the browser / VS Code webview will still
		// fire a paste event which xterm's built-in paste handler processes via onData.
		term.attachCustomKeyEventHandler(allowTerminalKeyEvent);

		const {
			handleContainerMouseDown,
			handleVisibilityChange,
			handleWindowFocus,
		} = createWindowLifecycleController({
			scheduleFocusRecovery,
			setRendererHealthSuspended,
			suspendAfterLayoutMs: RENDERER_HEALTH_SUSPEND_AFTER_LAYOUT_MS,
			getActiveRendererMode: () => activeRendererMode,
			getLastWebglFailureReason: () => lastWebglFailureReason,
			scheduleWebglRecoveryAttempt,
			webglRecoveryRecheckMs: WEBGL_RECOVERY_RECHECK_MS,
		});

		const resetTerminalViewport = () => {
			try {
				term.reset();
			} catch {
				term.clear();
			}
			bytesPendingRender = 0;
			pendingVisualUpdate = false;
			pendingRenderSince = 0;
			clearRendererStallWriteGrace();
		};

		const messageHandlers = {
			syncTabs: payload => {
				applyTabs(payload.tabs);
			},
			replaceTerminalContent: payload => {
				if (typeof payload.data !== 'string') {
					return;
				}
				if (
					typeof payload.tabId === 'string' &&
					currentTabId &&
					payload.tabId !== currentTabId
				) {
					return;
				}
				if (typeof payload.tabId === 'string') {
					currentTabId = payload.tabId;
				}
				resetTerminalViewport();
				if (payload.data.length === 0) {
					return;
				}
				const now = Date.now();
				lastOutputAt = now;
				bytesPendingRender = payload.data.length;
				pendingVisualUpdate = true;
				pendingRenderSince = now;
				term.write(payload.data, () => {
					lastWriteCallbackAt = Date.now();
				});
			},
			output: payload => {
				if (typeof payload.data !== 'string') {
					return;
				}
				if (
					typeof payload.tabId === 'string' &&
					currentTabId &&
					payload.tabId !== currentTabId
				) {
					return;
				}
				const now = Date.now();
				lastOutputAt = now;
				bytesPendingRender += payload.data.length;
				if (!pendingVisualUpdate) {
					pendingVisualUpdate = true;
					pendingRenderSince = now;
				}
				term.write(payload.data, () => {
					lastWriteCallbackAt = Date.now();
				});
			},
			clear: payload => {
				if (
					typeof payload.tabId === 'string' &&
					currentTabId &&
					payload.tabId !== currentTabId
				) {
					return;
				}
				resetTerminalViewport();
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
				if (
					typeof payload.tabId === 'string' &&
					currentTabId &&
					payload.tabId !== currentTabId
				) {
					return;
				}
				term.write(`\r\n\r\n[Process exited with code ${payload.code}]\r\n`);
			},
		};

		const handleWindowMessage = createWindowMessageRouter({
			messageHandlers,
		});

		if (renderStallTestButton) {
			addManagedListener(renderStallTestButton, 'click', () => {
				runRendererHealthTest('render-stall');
			});
		}
		if (contextLossTestButton) {
			addManagedListener(contextLossTestButton, 'click', () => {
				runRendererHealthTest('context-loss');
			});
		}

		addManagedListener(container, 'mousedown', handleContainerMouseDown);
		addManagedListener(document, 'visibilitychange', handleVisibilityChange);
		addManagedListener(window, 'focus', handleWindowFocus);
		addManagedListener(container, 'contextmenu', handleContextMenu);
		addManagedListener(window, 'message', handleWindowMessage);
		addManagedListener(window, 'beforeunload', runCleanups);

		let dragEnterCount = 0;

		addManagedListener(container, 'dragenter', event => {
			event.preventDefault();
			dragEnterCount++;
			container.classList.add('drag-over');
		});

		addManagedListener(container, 'dragover', event => {
			event.preventDefault();
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = 'copy';
			}
		});

		addManagedListener(container, 'dragleave', () => {
			dragEnterCount--;
			if (dragEnterCount <= 0) {
				dragEnterCount = 0;
				container.classList.remove('drag-over');
			}
		});

		addManagedListener(container, 'drop', event => {
			event.preventDefault();
			event.stopPropagation();
			dragEnterCount = 0;
			container.classList.remove('drag-over');

			const uriList =
				event.dataTransfer && event.dataTransfer.getData('text/uri-list');
			if (uriList) {
				const uris = uriList
					.split(/\r?\n/)
					.filter(line => line && !line.startsWith('#'));
				if (uris.length > 0) {
					vscode.postMessage({type: 'dropPaths', uris});
					return;
				}
			}

			const plain =
				event.dataTransfer && event.dataTransfer.getData('text/plain');
			if (plain) {
				const lines = plain.split(/\r?\n/).filter(Boolean);
				if (lines.length > 0) {
					vscode.postMessage({type: 'dropPaths', uris: lines});
				}
			}
		});

		registerCleanup(() => {
			clearFocusRecoveryTimers();
			clearInterval(rendererHealthTimer);
			clearAllTimers();
			clearTimeout(initialFitTimer);
			releaseRendererFreezeOverlay();
			resizeObserver.disconnect();
		});

		if (!tryEnableWebgl('initial-load')) {
			if (!isWebglAddonAvailable()) {
				logWarn(
					'Initial WebGL enable skipped because addon is unavailable; remaining on fallback renderer.',
				);
			} else {
				webglFailureCount = Math.max(1, webglFailureCount);
				lastWebglFailureReason =
					lastWebglFailureReason || 'initial-load-failed';
				logWarn(
					'Initial WebGL enable failed; scheduling recovery attempt.',
					`reason=${lastWebglFailureReason}, delayMs=${WEBGL_RECOVERY_DELAY_STEPS_MS[0]}`,
				);
				scheduleWebglRecoveryAttempt(
					lastWebglFailureReason,
					WEBGL_RECOVERY_DELAY_STEPS_MS[0],
				);
			}
		}
		scheduleFocusRecovery();
		logInfo('Sidebar terminal frontend ready.');
		vscode.postMessage({type: 'ready'});

	} catch (error) {
		if (error instanceof Error) {
			showError(error.stack || error.message);
			return;
		}
		showError(String(error));
	}
})();
