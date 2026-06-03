(function () {
	const vscode = acquireVsCodeApi();
	const isRemoteSsh = document.body?.dataset?.remoteSsh === 'true';

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
		const consolePrefix = `[Snow CLI][SidebarTerminal][${level.toUpperCase()}] ${normalizedMessage}`;

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
		for (const overlay of container.querySelectorAll(
			'.terminal-freeze-overlay',
		)) {
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
		return typeof constructorValue === 'function'
			? constructorValue
			: undefined;
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

	const applyTerminalBackground = (term, color) => {
		if (typeof color !== 'string' || !color.trim()) {
			return;
		}
		const normalized = color.trim();
		document.documentElement.style.setProperty('--terminal-bg', normalized);
		term.options.theme = {
			...(term.options.theme || {}),
			background: normalized,
		};
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
			scheduleTimer(
				resizeDebounceTimerKey,
				() => {
					fitTerminal();
				},
				50,
			);
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
		const SUPPORTED_IMAGE_MIME_PATTERN = /^image\/(?:png|jpe?g|gif|webp)$/i;
		const IMAGE_PASTE_DEDUPE_MS = 1000;
		let lastImagePasteSignature = '';
		let lastImagePasteAt = 0;
		let pendingSystemPasteShortcut = false;
		let suppressPasteUntilSystemPasteKeyup = false;

		const normalizeImageMimeType = mimeType => {
			const normalized = String(mimeType || 'image/png').toLowerCase();
			return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
		};

		const getImageBlobSignature = (blob, mimeType) => {
			if (!blob) {
				return '';
			}
			const normalizedMimeType = normalizeImageMimeType(mimeType || blob.type);
			const size = typeof blob.size === 'number' ? blob.size : 0;
			const lastModified =
				typeof blob.lastModified === 'number' ? blob.lastModified : 0;
			return `${normalizedMimeType}:${size}:${lastModified}`;
		};

		const shouldSkipDuplicateImagePaste = (signature, source) => {
			if (!signature) {
				return false;
			}

			const now = Date.now();
			if (
				signature === lastImagePasteSignature &&
				now - lastImagePasteAt <= IMAGE_PASTE_DEDUPE_MS
			) {
				logInfo('Skipped duplicate clipboard image paste.', {
					source,
					signature,
				});
				return true;
			}

			lastImagePasteSignature = signature;
			lastImagePasteAt = now;
			return false;
		};

		const writeClipboardText = (text, source) => {
			if (typeof text !== 'string' || text.length === 0) {
				return;
			}
			if (
				!navigator.clipboard ||
				typeof navigator.clipboard.writeText !== 'function'
			) {
				logWarn('Clipboard write API is unavailable.', `source=${source}`);
				return;
			}

			navigator.clipboard.writeText(text).catch(error => {
				logWarn('Failed to write text to clipboard.', {
					source,
					error: stringifyLogDetails(error),
				});
			});
		};

		const forwardImagePasteShortcutToTerminal = source => {
			// In local Windows/Linux extension hosts, the Snow CLI image paste shortcut
			// is Alt+V, which arrives at the Ink input layer as ESC followed by "v".
			// Delegating lets the CLI read/compress the clipboard image itself instead
			// of pushing a multi-megabyte data URL through the webview and PTY input
			// stream. Remote SSH keeps the original PTY data URL path because the CLI
			// runs remotely and cannot read the user's local clipboard image.
			sendInput('\x1bv');
			logInfo('Forwarded clipboard image paste to terminal shortcut.', {
				source,
			});
			return true;
		};

		const blobToDataUrl = blob =>
			new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => {
					if (typeof reader.result === 'string') {
						resolve(reader.result);
						return;
					}
					reject(new Error('Clipboard image did not produce a data URL.'));
				};
				reader.onerror = () => {
					reject(reader.error || new Error('Failed to read clipboard image.'));
				};
				reader.readAsDataURL(blob);
			});

		const getImageFileFromDataTransfer = dataTransfer => {
			const items = Array.from(dataTransfer?.items || []);
			for (const item of items) {
				if (
					item.kind === 'file' &&
					SUPPORTED_IMAGE_MIME_PATTERN.test(normalizeImageMimeType(item.type))
				) {
					const file = item.getAsFile();
					if (file) {
						return file;
					}
				}
			}
			return undefined;
		};

		const readImageBlobFromClipboardItems = async clipboardItems => {
			for (const item of clipboardItems || []) {
				const imageType = (item.types || []).find(type =>
					SUPPORTED_IMAGE_MIME_PATTERN.test(normalizeImageMimeType(type)),
				);
				if (!imageType) {
					continue;
				}
				const blob = await item.getType(imageType);
				return {blob, mimeType: imageType};
			}
			return undefined;
		};

		const readImageBlobFromNavigatorClipboard = async () => {
			if (
				!navigator.clipboard ||
				typeof navigator.clipboard.read !== 'function'
			) {
				return undefined;
			}
			return readImageBlobFromClipboardItems(await navigator.clipboard.read());
		};

		const getDataUrlSignature = dataUrl => {
			const prefix = dataUrl.slice(0, 96);
			const suffix = dataUrl.slice(Math.max(0, dataUrl.length - 96));
			return `data-url:${dataUrl.length}:${prefix}:${suffix}`;
		};

		const sendClipboardImageDataUrl = (
			dataUrl,
			source,
			signature,
			{dedupeChecked = false} = {},
		) => {
			if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
				return false;
			}

			const imageSignature = signature || getDataUrlSignature(dataUrl);
			if (
				!dedupeChecked &&
				shouldSkipDuplicateImagePaste(imageSignature, source)
			) {
				return true;
			}

			sendInput(dataUrl);
			logInfo('Clipboard image converted to data URL for terminal input.', {
				source,
				length: dataUrl.length,
				signature: imageSignature,
			});
			return true;
		};

		const readAndSendClipboardImageBlob = async (blob, source, mimeType) => {
			const signature = getImageBlobSignature(blob, mimeType);
			if (shouldSkipDuplicateImagePaste(signature, source)) {
				return true;
			}

			const dataUrl = await blobToDataUrl(blob);
			return sendClipboardImageDataUrl(dataUrl, source, signature, {
				dedupeChecked: true,
			});
		};

		const readAndSendClipboardText = async source => {
			if (
				!navigator.clipboard ||
				typeof navigator.clipboard.readText !== 'function'
			) {
				logWarn('Clipboard readText API is unavailable.', `source=${source}`);
				return false;
			}
			const text = await navigator.clipboard.readText();
			if (text) {
				sendInput(text);
				return true;
			}
			return false;
		};

		const handleClipboardPaste = async ({
			event,
			source,
			allowNavigatorImage = !event,
			fallbackToText = !event,
		}) => {
			try {
				const pastedFile = getImageFileFromDataTransfer(event?.clipboardData);
				if (pastedFile) {
					event.preventDefault();
					return readAndSendClipboardImageBlob(
						pastedFile,
						source,
						pastedFile.type,
					);
				}

				if (allowNavigatorImage) {
					const image = await readImageBlobFromNavigatorClipboard();
					if (
						image &&
						(await readAndSendClipboardImageBlob(
							image.blob,
							source,
							image.mimeType,
						))
					) {
						event?.preventDefault?.();
						return true;
					}
				}

				if (!event && fallbackToText) {
					return readAndSendClipboardText(source);
				}
			} catch (error) {
				logWarn('Failed to read clipboard image for terminal paste.', {
					source,
					error: stringifyLogDetails(error),
				});
				if (!event && fallbackToText) {
					try {
						return await readAndSendClipboardText(source);
					} catch (textError) {
						logWarn(
							'Failed to read text from clipboard after image paste fallback.',
							{
								source,
								error: stringifyLogDetails(textError),
							},
						);
					}
				}
			}
			return false;
		};

		const registerOsc52ClipboardHandler = () => {
			const parser = term.parser;
			if (!parser || typeof parser.registerOscHandler !== 'function') {
				logWarn('OSC 52 clipboard passthrough is unavailable.');
				return undefined;
			}

			return parser.registerOscHandler(52, data => {
				const parts = String(data).split(';');
				if (parts.length < 2) {
					return true;
				}

				const base64 = parts.slice(1).join(';').trim();
				if (!base64 || base64 === '?') {
					return true;
				}

				try {
					const binary = atob(base64);
					const bytes = new Uint8Array(binary.length);
					for (let index = 0; index < binary.length; index += 1) {
						bytes[index] = binary.charCodeAt(index);
					}
					const text = new TextDecoder('utf-8', {fatal: false}).decode(bytes);
					writeClipboardText(text, 'osc52');
				} catch (error) {
					logWarn('Failed to decode OSC 52 clipboard payload.', error);
				}

				return true;
			});
		};

		const shouldUseCtrlSelectionCopy = event => {
			if (
				isMacPlatform ||
				event.type !== 'keydown' ||
				!event.ctrlKey ||
				event.shiftKey ||
				event.altKey ||
				event.metaKey ||
				event.key.toLowerCase() !== 'c'
			) {
				return false;
			}
			return term.hasSelection() && Boolean(term.getSelection());
		};

		const isImagePasteShortcut = event => {
			if (event.type !== 'keydown') {
				return false;
			}
			const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
			if (key !== 'v' || event.shiftKey || event.metaKey) {
				return false;
			}
			if (isMacPlatform) {
				return event.ctrlKey && !event.altKey;
			}
			return event.altKey && !event.ctrlKey;
		};

		const isSystemPasteShortcut = event => {
			if (event.type !== 'keydown') {
				return false;
			}
			const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
			if (key !== 'v' || event.altKey) {
				return false;
			}
			if (isMacPlatform) {
				return event.metaKey && !event.ctrlKey;
			}
			return event.ctrlKey && !event.metaKey;
		};

		const handleImagePasteShortcut = event => {
			if (!isImagePasteShortcut(event)) {
				return undefined;
			}

			event.preventDefault?.();
			if (!isMacPlatform && !isRemoteSsh) {
				forwardImagePasteShortcutToTerminal('windows-alt-v-image-shortcut');
				// Returning false prevents xterm from also translating Alt+V into
				// ESC+v, which would trigger the CLI image paste handler twice.
				return false;
			}

			void handleClipboardPaste({
				allowNavigatorImage: true,
				fallbackToText: false,
				source: isRemoteSsh
					? 'remote-ssh-alt-v-image-shortcut'
					: 'macos-ctrl-v-image-shortcut',
			});
			return false;
		};

		const handleSystemPasteShortcut = event => {
			if (!isSystemPasteShortcut(event)) {
				return undefined;
			}

			if (!isMacPlatform) {
				pendingSystemPasteShortcut = true;
				suppressPasteUntilSystemPasteKeyup = false;
				return false;
			}

			return true;
		};

		const isSystemPasteKeyRelease = event => {
			if (isMacPlatform || event.type !== 'keyup') {
				return false;
			}
			const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
			return key === 'v';
		};

		const allowTerminalKeyEvent = event => {
			if (isSystemPasteKeyRelease(event)) {
				pendingSystemPasteShortcut = false;
				suppressPasteUntilSystemPasteKeyup = false;
				return true;
			}

			const imagePasteDecision = handleImagePasteShortcut(event);
			if (typeof imagePasteDecision === 'boolean') {
				return imagePasteDecision;
			}

			const systemPasteDecision = handleSystemPasteShortcut(event);
			if (typeof systemPasteDecision === 'boolean') {
				return systemPasteDecision;
			}

			if (shouldUseCtrlSelectionCopy(event)) {
				const selection = term.getSelection();
				if (selection) {
					writeClipboardText(selection, 'selection-keyboard');
				}
				return false;
			}
			return true;
		};

		const handlePasteEvent = event => {
			const pastedFile = getImageFileFromDataTransfer(event?.clipboardData);
			const text =
				event?.clipboardData?.getData('text/plain') ||
				event?.clipboardData?.getData('text') ||
				'';
			const isSystemShortcutPaste =
				!isMacPlatform && pendingSystemPasteShortcut;
			const isDuplicateSystemShortcutPaste =
				!isMacPlatform && suppressPasteUntilSystemPasteKeyup;

			event.preventDefault?.();
			event.stopImmediatePropagation?.();
			event.stopPropagation?.();

			if (isDuplicateSystemShortcutPaste) {
				return;
			}

			if (pastedFile) {
				pendingSystemPasteShortcut = false;
				suppressPasteUntilSystemPasteKeyup = isSystemShortcutPaste;
				if (isSystemShortcutPaste && !isMacPlatform && !isRemoteSsh) {
					forwardImagePasteShortcutToTerminal('windows-ctrl-v-image-shortcut');
					return;
				}

				void handleClipboardPaste({
					allowNavigatorImage: false,
					event,
					fallbackToText: false,
					source:
						isSystemShortcutPaste && isRemoteSsh
							? 'remote-ssh-ctrl-v-image-shortcut'
							: 'paste-event-image',
				});
				return;
			}

			if (text) {
				pendingSystemPasteShortcut = false;
				suppressPasteUntilSystemPasteKeyup = isSystemShortcutPaste;
				sendInput(text);
				return;
			}

			pendingSystemPasteShortcut = false;
			suppressPasteUntilSystemPasteKeyup = isSystemShortcutPaste;
			void handleClipboardPaste({
				allowNavigatorImage: true,
				fallbackToText: false,
				source: 'paste-event-image-probe',
			});
		};

		const handleContextMenu = event => {
			event.preventDefault();
			const selection = term.getSelection();
			if (selection) {
				writeClipboardText(selection, 'selection-context-menu');
				term.clearSelection();
				return;
			}

			void handleClipboardPaste({source: 'context-menu'});
		};

		return {
			allowTerminalKeyEvent,
			handleContextMenu,
			handlePasteEvent,
			registerOsc52ClipboardHandler,
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
				scheduleWebglRecoveryAttempt(lastFailureReason, webglRecoveryRecheckMs);
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
		const terminalTitleByTabId = new Map();

		const normalizeTabState = value => {
			if (!value || typeof value !== 'object') {
				return undefined;
			}
			const id = typeof value.id === 'string' ? value.id : '';
			const title = typeof value.title === 'string' ? value.title : '';
			const terminalTitle =
				typeof value.terminalTitle === 'string'
					? value.terminalTitle.trim()
					: '';
			if (!id || !title) {
				return undefined;
			}
			return {
				id,
				title,
				terminalTitle: terminalTitle || undefined,
				isActive: Boolean(value.isActive),
				isRunning: Boolean(value.isRunning),
				isRestarting: Boolean(value.isRestarting),
				exitCode:
					typeof value.exitCode === 'number' && Number.isFinite(value.exitCode)
						? value.exitCode
						: undefined,
			};
		};

		const getTabHoverTitle = tab => {
			const storedTitle = terminalTitleByTabId.get(tab.id);
			if (typeof storedTitle === 'string' && storedTitle.trim()) {
				return storedTitle.trim();
			}
			if (typeof tab.terminalTitle === 'string' && tab.terminalTitle.trim()) {
				return tab.terminalTitle.trim();
			}
			return tab.title;
		};

		const updateActiveTabTerminalTitle = title => {
			const normalizedTitle = typeof title === 'string' ? title.trim() : '';
			if (!currentTabId || !normalizedTitle) {
				return;
			}
			if (terminalTitleByTabId.get(currentTabId) === normalizedTitle) {
				return;
			}
			terminalTitleByTabId.set(currentTabId, normalizedTitle);
			renderTabs();
		};

		const createTabTooltipController = () => {
			const tooltip = document.createElement('div');
			tooltip.className = 'terminal-tab-tooltip';
			tooltip.setAttribute('role', 'tooltip');
			tooltip.hidden = true;
			document.body.appendChild(tooltip);

			let activeTarget;

			const positionTooltip = target => {
				if (!(target instanceof HTMLElement) || tooltip.hidden) {
					return;
				}
				const targetRect = target.getBoundingClientRect();
				const tooltipRect = tooltip.getBoundingClientRect();
				const viewportWidth =
					document.documentElement.clientWidth || window.innerWidth;
				const viewportHeight =
					document.documentElement.clientHeight || window.innerHeight;
				const margin = 6;
				let left =
					targetRect.left + targetRect.width / 2 - tooltipRect.width / 2;
				left = Math.max(
					margin,
					Math.min(left, viewportWidth - tooltipRect.width - margin),
				);

				let top = targetRect.bottom + margin;
				if (top + tooltipRect.height + margin > viewportHeight) {
					top = Math.max(margin, targetRect.top - tooltipRect.height - margin);
				}

				tooltip.style.left = `${Math.round(left)}px`;
				tooltip.style.top = `${Math.round(top)}px`;
			};

			const show = (target, text) => {
				const normalizedText = typeof text === 'string' ? text.trim() : '';
				if (!(target instanceof HTMLElement) || !normalizedText) {
					hide();
					return;
				}
				activeTarget = target;
				tooltip.textContent = normalizedText;
				tooltip.hidden = false;
				tooltip.classList.add('is-visible');
				positionTooltip(target);
				window.requestAnimationFrame(() => {
					if (activeTarget === target) {
						positionTooltip(target);
					}
				});
			};

			const hide = () => {
				activeTarget = undefined;
				tooltip.classList.remove('is-visible');
				tooltip.hidden = true;
			};

			const bindTarget = (target, getText) => {
				const resolveText =
					typeof getText === 'function' ? getText : () => String(getText || '');
				target.addEventListener('pointerenter', () => {
					show(target, resolveText());
				});
				target.addEventListener('pointerleave', hide);
				target.addEventListener('focus', () => {
					show(target, resolveText());
				});
				target.addEventListener('blur', hide);
				target.addEventListener('click', hide);
			};

			const dispose = () => {
				hide();
				tooltip.remove();
			};

			return {bindTarget, dispose, hide};
		};

		const tabTooltip = createTabTooltipController();
		registerCleanup(tabTooltip.dispose);

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
			tabTooltip.hide();
			tabStrip.replaceChildren();
			if (tabStates.length === 0) {
				return;
			}
			let activeItem;
			for (const tab of tabStates) {
				const hoverTitle = getTabHoverTitle(tab);
				const item = document.createElement('div');
				item.className = 'terminal-tab-item';
				item.dataset.tabId = tab.id;
				item.dataset.tooltip = hoverTitle;
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
				button.setAttribute(
					'aria-label',
					hoverTitle === tab.title ? tab.title : `${tab.title}: ${hoverTitle}`,
				);

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
				tabTooltip.bindTarget(item, () => getTabHoverTitle(tab));
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
				terminalTitleByTabId.clear();
				renderTabs();
				return;
			}
			const nextTabIds = new Set(normalizedTabs.map(tab => tab.id));
			for (const tabId of terminalTitleByTabId.keys()) {
				if (!nextTabIds.has(tabId)) {
					terminalTitleByTabId.delete(tabId);
				}
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

		const createBellPlayer = () => {
			const config = {
				enabled: true,
				volume: 0.5,
				sound: 'beep',
				visualFlash: true,
			};
			let audioCtx = null;
			let lastBellAt = 0;
			let visualFlashClearTimer = null;
			const MIN_BELL_INTERVAL_MS = 80;
			const VISUAL_FLASH_DURATION_MS = 320;

			const ensureAudioCtx = () => {
				if (audioCtx) {
					return audioCtx;
				}
				const Ctor =
					typeof window.AudioContext === 'function'
						? window.AudioContext
						: typeof window.webkitAudioContext === 'function'
						? window.webkitAudioContext
						: undefined;
				if (!Ctor) {
					return null;
				}
				try {
					audioCtx = new Ctor();
				} catch (error) {
					logWarn(
						'Failed to initialize AudioContext for terminal bell.',
						error,
					);
					audioCtx = null;
				}
				return audioCtx;
			};

			const unlockAudio = () => {
				const ctx = ensureAudioCtx();
				if (!ctx || ctx.state !== 'suspended') {
					return;
				}
				ctx.resume().catch(() => {
					// AudioContext will be retried on the next user gesture.
				});
			};

			const updateConfig = next => {
				if (!next || typeof next !== 'object') {
					return;
				}
				if (typeof next.enabled === 'boolean') {
					config.enabled = next.enabled;
				}
				if (typeof next.volume === 'number' && Number.isFinite(next.volume)) {
					config.volume = Math.min(1, Math.max(0, next.volume));
				}
				if (typeof next.sound === 'string') {
					config.sound = next.sound;
				}
				if (typeof next.visualFlash === 'boolean') {
					config.visualFlash = next.visualFlash;
				}
			};

			const flashBellOverlay = () => {
				if (!config.visualFlash) {
					return;
				}
				container.classList.remove('bell-flash');
				// Force reflow so the animation restarts on rapid consecutive bells.
				void container.offsetWidth;
				container.classList.add('bell-flash');
				if (visualFlashClearTimer) {
					clearTimeout(visualFlashClearTimer);
				}
				visualFlashClearTimer = setTimeout(() => {
					container.classList.remove('bell-flash');
					visualFlashClearTimer = null;
				}, VISUAL_FLASH_DURATION_MS);
			};

			const scheduleBellTone = (ctx, gainNode, spec) => {
				const oscillator = ctx.createOscillator();
				oscillator.type = spec.type || 'sine';
				oscillator.frequency.setValueAtTime(spec.frequency, spec.startTime);
				if (typeof spec.endFrequency === 'number') {
					oscillator.frequency.exponentialRampToValueAtTime(
						spec.endFrequency,
						spec.startTime + spec.duration,
					);
				}
				oscillator.connect(gainNode);
				oscillator.start(spec.startTime);
				oscillator.stop(spec.startTime + spec.duration + 0.02);
			};

			const renderSound = ctx => {
				const masterGain = ctx.createGain();
				masterGain.gain.value = config.volume;
				masterGain.connect(ctx.destination);

				const now = ctx.currentTime;
				const peak = 0.6; // pre-volume peak; final amplitude = peak * config.volume
				const tones = [];

				switch (config.sound) {
					case 'ding': {
						const envGain = ctx.createGain();
						envGain.gain.setValueAtTime(0.0001, now);
						envGain.gain.exponentialRampToValueAtTime(peak, now + 0.005);
						envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32);
						envGain.connect(masterGain);
						tones.push({
							type: 'triangle',
							frequency: 1320,
							startTime: now,
							duration: 0.32,
							gain: envGain,
						});
						tones.push({
							type: 'triangle',
							frequency: 1980,
							startTime: now,
							duration: 0.28,
							gain: envGain,
						});
						break;
					}
					case 'chime': {
						const env1 = ctx.createGain();
						env1.gain.setValueAtTime(0.0001, now);
						env1.gain.exponentialRampToValueAtTime(peak, now + 0.01);
						env1.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
						env1.connect(masterGain);
						tones.push({
							type: 'sine',
							frequency: 1046.5,
							startTime: now,
							duration: 0.2,
							gain: env1,
						});

						const env2 = ctx.createGain();
						env2.gain.setValueAtTime(0.0001, now + 0.16);
						env2.gain.exponentialRampToValueAtTime(peak, now + 0.17);
						env2.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
						env2.connect(masterGain);
						tones.push({
							type: 'sine',
							frequency: 783.99,
							startTime: now + 0.16,
							duration: 0.26,
							gain: env2,
						});
						break;
					}
					case 'pluck': {
						const envGain = ctx.createGain();
						envGain.gain.setValueAtTime(0.0001, now);
						envGain.gain.exponentialRampToValueAtTime(peak * 0.85, now + 0.005);
						envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
						envGain.connect(masterGain);
						tones.push({
							type: 'sawtooth',
							frequency: 660,
							endFrequency: 330,
							startTime: now,
							duration: 0.18,
							gain: envGain,
						});
						break;
					}
					case 'blip': {
						const envGain = ctx.createGain();
						envGain.gain.setValueAtTime(0.0001, now);
						envGain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
						envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
						envGain.connect(masterGain);
						tones.push({
							type: 'square',
							frequency: 1760,
							startTime: now,
							duration: 0.08,
							gain: envGain,
						});
						break;
					}
					case 'beep':
					default: {
						const envGain = ctx.createGain();
						envGain.gain.setValueAtTime(0.0001, now);
						envGain.gain.exponentialRampToValueAtTime(peak, now + 0.01);
						envGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
						envGain.connect(masterGain);
						tones.push({
							type: 'sine',
							frequency: 800,
							startTime: now,
							duration: 0.13,
							gain: envGain,
						});
						break;
					}
				}

				for (const tone of tones) {
					scheduleBellTone(ctx, tone.gain, tone);
				}
			};

			const playBell = () => {
				if (!config.enabled) {
					return;
				}
				const now = Date.now();
				if (now - lastBellAt < MIN_BELL_INTERVAL_MS) {
					return;
				}
				lastBellAt = now;
				flashBellOverlay();
				if (config.sound === 'none' || config.volume <= 0) {
					return;
				}
				const ctx = ensureAudioCtx();
				if (!ctx) {
					return;
				}
				if (ctx.state === 'suspended') {
					ctx.resume().catch(() => {
						// User has not yet interacted with the webview; visual flash is the only feedback this time.
					});
					return;
				}
				try {
					renderSound(ctx);
				} catch (error) {
					logWarn('Failed to play terminal bell.', error);
				}
			};

			const dispose = () => {
				if (visualFlashClearTimer) {
					clearTimeout(visualFlashClearTimer);
					visualFlashClearTimer = null;
				}
			};

			return {playBell, unlockAudio, updateConfig, dispose};
		};

		const {
			playBell: playTerminalBell,
			unlockAudio: unlockTerminalAudio,
			updateConfig: updateBellConfig,
			dispose: disposeBellPlayer,
		} = createBellPlayer();
		registerCleanup(disposeBellPlayer);

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
			const suspendedRemainingMs = getRendererHealthSuspendedRemainingMs(
				Date.now(),
			);
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
			scheduleTimer(
				TIMER_KEYS.webglStability,
				() => {
					if (activeRendererMode !== 'webgl' || !webglAddon) {
						return;
					}
					if (webglFailureCount > 0 || lastWebglFailureReason) {
						logInfo('WebGL renderer marked stable after recovery window.');
					}
					webglFailureCount = 0;
					lastWebglFailureReason = undefined;
					lastWebglEscalationRequestedAt = 0;
				},
				WEBGL_STABILITY_RESET_MS,
			);
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
				`reason=${reason}, activeRendererMode=${activeRendererMode}, webglActive=${Boolean(
					webglAddon,
				)}`,
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
				`cycle=${currentRecoveryCycleId || 'n/a'}, reason=${
					reason || 'unknown'
				}, failureCount=${webglFailureCount}`,
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
					`cycle=${currentRecoveryCycleId || 'n/a'}, reason=${
						reason || 'unknown'
					}, failureCount=${webglFailureCount}`,
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
			scheduleTimer(
				TIMER_KEYS.webglRecovery,
				() => {
					attemptWebglRecovery(reason, nextAttemptId);
				},
				nextDelay,
			);
			logInfo(
				'Scheduled WebGL recovery attempt.',
				`cycle=${
					currentRecoveryCycleId || 'n/a'
				}, attempt=${nextAttemptId}, reason=${
					reason || 'unknown'
				}, delayMs=${nextDelay}, failureCount=${webglFailureCount}`,
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
					reason ? {reason, error: stringifyLogDetails(error)} : error,
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
					`cycle=${currentRecoveryCycleId || 'n/a'}, attempt=${
						attemptId || 'n/a'
					}, reason=${reason || 'unknown'}`,
				);
				scheduleWebglRecoveryAttempt(reason, WEBGL_RECOVERY_RECHECK_MS);
				return;
			}
			const now = Date.now();
			const suspendedRemainingMs = getRendererHealthSuspendedRemainingMs(now);
			if (suspendedRemainingMs > 0) {
				logInfo(
					'Deferred WebGL recovery attempt because renderer health is suspended.',
					`cycle=${currentRecoveryCycleId || 'n/a'}, attempt=${
						attemptId || 'n/a'
					}, suspendedMs=${suspendedRemainingMs}`,
				);
				scheduleWebglRecoveryAttempt(
					reason,
					Math.max(WEBGL_RECOVERY_SUSPEND_DEFER_MIN_MS, suspendedRemainingMs),
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
				`cycle=${
					currentRecoveryCycleId || 'n/a'
				}, attempt=${currentRecoveryAttemptId}, reason=${
					reason || 'unknown'
				}, failureCount=${webglFailureCount}, heuristicAttempt=${attemptNumber}`,
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

		registerDisposable(
			term.onBell(() => {
				playTerminalBell();
			}),
		);

		if (typeof term.onTitleChange === 'function') {
			registerDisposable(
				term.onTitleChange(title => {
					updateActiveTabTerminalTitle(title);
				}),
			);
		}

		// AudioContext starts suspended in webviews until a user gesture occurs;
		// arm it on first interaction so subsequent bells can produce sound.
		addManagedListener(container, 'pointerdown', unlockTerminalAudio);
		addManagedListener(container, 'keydown', unlockTerminalAudio);

		const {
			allowTerminalKeyEvent,
			handleContextMenu,
			handlePasteEvent,
			registerOsc52ClipboardHandler,
		} = createClipboardAndContextController({term, sendInput});
		registerDisposable(registerOsc52ClipboardHandler());
		addManagedListener(document, 'paste', handlePasteEvent, true);

		// Returning false from xterm's custom key handler stops terminal key
		// processing, but the DOM keydown event can still lead to the native paste.
		// Windows Ctrl+V image paste is delegated to Snow CLI's Alt+V handler so
		// large images are not serialized through the webview/PTY input stream.
		// Existing in-app image paste shortcuts still work inside Snow CLI itself.
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
				applyTerminalBackground(term, payload.backgroundColor);
				fitTerminal();
				scheduleFocusRecovery();
			},
			updateBell: payload => {
				updateBellConfig(payload);
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
