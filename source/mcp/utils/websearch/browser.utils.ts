/**
 * Browser detection utilities for web search
 */

import {execSync, spawn, type ChildProcess} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {platform} from 'node:os';
import {request} from 'node:http';

/**
 * Check if running inside WSL (Windows Subsystem for Linux)
 * @returns true if running in WSL environment
 */
export function isWSL(): boolean {
	try {
		// Check /proc/version for Microsoft/WSL indicators
		if (existsSync('/proc/version')) {
			const version = readFileSync('/proc/version', 'utf8').toLowerCase();
			return version.includes('microsoft') || version.includes('wsl');
		}
		// Check for WSL-specific environment variables
		if (process.env['WSL_DISTRO_NAME'] || process.env['WSL_INTEROP']) {
			return true;
		}
	} catch {
		// Ignore errors
	}
	return false;
}

/**
 * Find Windows browser path when running in WSL
 * @returns Windows browser path accessible from WSL, or null
 */
export function findWindowsBrowserInWSL(): string | null {
	const windowsPaths = [
		'/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
		'/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
		'/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
		'/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
	];

	for (const path of windowsPaths) {
		if (existsSync(path)) {
			return path;
		}
	}

	return null;
}

/**
 * Find a usable Windows PowerShell executable path when running inside WSL.
 *
 * WSL with `appendWindowsPath=false` (a common configuration) does NOT inject
 * the Windows PATH into the Linux side, so `powershell.exe` / `pwsh.exe`
 * cannot be invoked by their bare names — `spawn('powershell.exe', ...)` fails
 * with `ENOENT`. This function enumerates well-known Windows mount paths
 * and falls back to a `which` lookup (for `appendWindowsPath=true` users) to
 * resolve a usable PowerShell binary. The result is cached for the process
 * lifetime to avoid repeated filesystem probes.
 *
 * @returns PowerShell executable path accessible from WSL, or null if none found
 */
let cachedPowerShellPath: string | null | undefined;

export function findPowerShellInWSL(): string | null {
	if (cachedPowerShellPath !== undefined) {
		return cachedPowerShellPath;
	}

	// Well-known Windows PowerShell locations (mounted under /mnt/c by WSL).
	// Prefer Windows PowerShell 5.x first because the Start-Process / clipboard
	// scripts use features that are stable across 5.1+, then PowerShell 7+.
	const candidates = [
		'/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
		'/mnt/c/Windows/SysWOW64/WindowsPowerShell/v1.0/powershell.exe',
		'/mnt/c/Program Files/PowerShell/7/pwsh.exe',
		'/mnt/c/Program Files/PowerShell/6/pwsh.exe',
	];

	for (const candidate of candidates) {
		try {
			if (existsSync(candidate)) {
				cachedPowerShellPath = candidate;
				return candidate;
			}
		} catch {
			// Ignore permission/IO errors on individual candidates
		}
	}

	// Fallback: query PATH via `which` (works when appendWindowsPath=true).
	for (const bin of ['powershell.exe', 'pwsh.exe', 'powershell', 'pwsh']) {
		try {
			const resolved = execSync(`which ${bin}`, {
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'ignore'],
			}).trim();
			if (resolved) {
				cachedPowerShellPath = resolved;
				return resolved;
			}
		} catch {
			// Not in PATH, try next candidate
		}
	}

	cachedPowerShellPath = null;
	return null;
}

// Store reference to spawned browser process for cleanup
let spawnedBrowserProcess: ChildProcess | null = null;

/**
 * Launch Windows browser from WSL with remote debugging enabled
 * @param browserPath - Path to Windows browser executable
 * @param debugPort - Remote debugging port (default: 9222)
 * @returns WebSocket debugger URL or null if failed
 */
export async function launchWindowsBrowserFromWSL(
	browserPath: string,
	debugPort: number = 9222,
): Promise<string | null> {
	// Keep one stable Windows-side profile per debug port to avoid profile locks
	// when different Snow processes use different browserDebugPort values.
	const userDataDir = `C:\\temp\\snow-browser-debug-${debugPort}`;

	// Build the command to run via PowerShell
	// Convert /mnt/c/... path to C:\... for PowerShell
	const windowsPath = browserPath
		.replace(/^\/mnt\/([a-z])\//, '$1:\\\\')
		.replace(/\//g, '\\\\');

	const args = [
		'--headless=new',
		'--disable-gpu',
		'--no-sandbox',
		'--disable-dev-shm-usage',
		`--remote-debugging-port=${debugPort}`,
		`--user-data-dir=${userDataDir}`,
	];

	try {
		// Resolve a usable PowerShell binary. With WSL `appendWindowsPath=false`,
		// the bare `powershell.exe` name is NOT on PATH and `spawn` would fail
		// with ENOENT. findPowerShellInWSL() probes well-known /mnt/c paths.
		const psExe = findPowerShellInWSL();
		if (!psExe) {
			// No Windows PowerShell accessible from WSL — return null so the
			// caller can fall back to launching a native Linux browser instead.
			return null;
		}

		// Use PowerShell to start the browser process on Windows side
		const psCommand = `Start-Process -FilePath '${windowsPath}' -ArgumentList '${args.join(
			' ',
		)}' -PassThru`;

		spawnedBrowserProcess = spawn(psExe, ['-Command', psCommand], {
			detached: true,
			stdio: 'ignore',
		});

		// `spawn()` emits the 'error' event asynchronously (e.g. ENOENT when the
		// binary cannot be executed, or EACCES). Without a listener Node would
		// crash the process with an uncaught exception; capture the failure so
		// we can return null and let callers fall back gracefully.
		let spawnFailed = false;
		spawnedBrowserProcess.on('error', () => {
			spawnFailed = true;
		});

		spawnedBrowserProcess.unref();

		// Wait for browser to start and get WebSocket URL
		const maxRetries = 10;
		const retryDelay = 500;

		for (let i = 0; i < maxRetries; i++) {
			await new Promise(resolve => setTimeout(resolve, retryDelay));

			if (spawnFailed) {
				// PowerShell failed to start (ENOENT / permission / exec format).
				return null;
			}

			// Use node:http to check if browser is ready (avoids proxy issues)
			const wsUrl = await getRunningBrowserWSEndpoint(debugPort);
			if (wsUrl) {
				return wsUrl;
			}
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Check if a browser is already running with remote debugging on specified port
 * Uses node:http instead of fetch to avoid proxy issues in WSL
 * @param debugPort - Remote debugging port to check
 * @returns WebSocket debugger URL if browser is running, null otherwise
 */
export async function getRunningBrowserWSEndpoint(
	debugPort: number = 9222,
): Promise<string | null> {
	return new Promise(resolve => {
		const req = request(
			{
				hostname: 'localhost',
				port: debugPort,
				path: '/json/version',
				method: 'GET',
				timeout: 3000,
			},
			res => {
				let data = '';
				res.on('data', chunk => {
					data += chunk;
				});
				res.on('end', () => {
					try {
						const json = JSON.parse(data) as {webSocketDebuggerUrl?: string};
						resolve(json.webSocketDebuggerUrl || null);
					} catch {
						resolve(null);
					}
				});
			},
		);

		req.on('error', () => {
			resolve(null);
		});

		req.on('timeout', () => {
			req.destroy();
			resolve(null);
		});

		req.end();
	});
}

/**
 * Detect system Chrome/Edge browser executable path
 * @returns Browser executable path or null if not found
 */
export function findBrowserExecutable(): string | null {
	const os = platform();
	const paths: string[] = [];

	if (os === 'win32') {
		// Windows: Prioritize Edge (built-in), then Chrome
		const edgePaths = [
			'C:\\\\Program Files\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
			'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',
		];
		const chromePaths = [
			'C:\\\\Program Files\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
			'C:\\\\Program Files (x86)\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
			process.env['LOCALAPPDATA'] +
				'\\\\Google\\\\Chrome\\\\Application\\\\chrome.exe',
		];
		paths.push(...edgePaths, ...chromePaths);
	} else if (os === 'darwin') {
		// macOS
		paths.push(
			'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
			'/Applications/Chromium.app/Contents/MacOS/Chromium',
			'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
		);
	} else {
		// Linux (including WSL - but for WSL we prefer Windows browser)
		const binPaths = [
			'google-chrome',
			'chromium',
			'chromium-browser',
			'microsoft-edge',
		];
		for (const bin of binPaths) {
			try {
				const path = execSync(`which ${bin}`, {encoding: 'utf8'}).trim();
				if (path) {
					return path;
				}
			} catch {
				// Continue to next binary
			}
		}
	}

	// Check if any path exists
	for (const path of paths) {
		if (path && existsSync(path)) {
			return path;
		}
	}

	return null;
}
