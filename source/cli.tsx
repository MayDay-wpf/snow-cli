#!/usr/bin/env node

// Force color support for all chalk instances (must be set before any imports)
// This ensures syntax highlighting works in cli-highlight and other color libraries
process.env['FORCE_COLOR'] = '3';

// Check Node.js version before anything else
const MIN_NODE_VERSION = 16;
const currentVersion = process.version;
const major = parseInt(currentVersion.slice(1).split('.')[0] || '0', 10);

if (major < MIN_NODE_VERSION) {
	console.error('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
	console.error('  Node.js Version Compatibility Error');
	console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
	console.error(`Current Node.js version: ${currentVersion}`);
	console.error(`Required: Node.js >= ${MIN_NODE_VERSION}.x\n`);
	console.error('Please upgrade Node.js to continue:\n');
	console.error('# Using nvm (recommended):');
	console.error(`  nvm install ${MIN_NODE_VERSION}`);
	console.error(`  nvm use ${MIN_NODE_VERSION}\n`);
	console.error('# Or download from official website:');
	console.error('  https://nodejs.org/\n');
	console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
	process.exit(1);
}

// Sanitize NODE_OPTIONS to prevent noisy Node warnings
// Some environments may inject an invalid `--localstorage-file` flag (e.g., without a path),
// which causes: "Warning: `--localstorage-file` was provided without a valid path".
function sanitizeNodeOptions() {
	const raw = process.env['NODE_OPTIONS'];
	if (!raw) return;

	const tokens = raw.split(/\s+/).filter(Boolean);
	const cleaned: string[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!;

		// Handle both `--localstorage-file <path>` and `--localstorage-file=<path>`
		if (token === '--localstorage-file') {
			const next = tokens[i + 1];
			// If missing/empty/looks like another flag, drop the flag entirely.
			if (!next || next.startsWith('-')) {
				continue;
			}
			// Keep as-is.
			cleaned.push(token, next);
			i++;
			continue;
		}

		if (token.startsWith('--localstorage-file=')) {
			const value = token.slice('--localstorage-file='.length);
			if (!value) {
				continue;
			}
			cleaned.push(token);
			continue;
		}

		cleaned.push(token);
	}

	const nextRaw = cleaned.join(' ');
	if (nextRaw !== raw) {
		process.env['NODE_OPTIONS'] = nextRaw;
	}
}

sanitizeNodeOptions();

// Some injected NODE_OPTIONS are parsed by Node before userland code runs.
// If that happens (e.g. `--localstorage-file` without a path), the process may
// already fail before we can sanitize. As a last resort, allow users to opt out
// of inheriting NODE_OPTIONS by setting SNOW_IGNORE_NODE_OPTIONS=1.
if (process.env['SNOW_IGNORE_NODE_OPTIONS'] === '1') {
	delete process.env['NODE_OPTIONS'];
}

// Suppress DEP0169 warning from dependencies
const originalEmitWarning = process.emitWarning;
process.emitWarning = function (warning: any, ...args: any[]) {
	// Check if this is the DEP0169 warning
	if (args[1] === 'DEP0169') return;
	return (originalEmitWarning as any).apply(process, [warning, ...args]);
};

// Check if this is a quick command that doesn't need loading indicator
const args = process.argv.slice(2);
const isQuickCommand = args.some(
	arg =>
		arg === '--version' || arg === '-v' || arg === '--help' || arg === '-h',
);

// Show loading indicator only for non-quick commands
if (!isQuickCommand) {
	process.stdout.write('\x1b[?25l'); // Hide cursor
	process.stdout.write('⠋ Loading...\r');
}

// Import only critical dependencies synchronously
import React from 'react';
import {render, Text, Box} from 'ink';
import {setUpdateNotice} from './utils/ui/updateNotice.js';
import Spinner from 'ink-spinner';
import meow from 'meow';
import {execSync} from 'child_process';
import {readFileSync} from 'fs';
import {join} from 'path';
import {fileURLToPath} from 'url';

// Read version from package.json
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const packageJson = JSON.parse(
	readFileSync(join(__dirname, '../package.json'), 'utf-8'),
);
const VERSION = packageJson.version;

// Load heavy dependencies asynchronously
async function loadDependencies() {
	// Import utils/index.js to register all commands (side-effect import)
	await import('./utils/index.js');

	//初始化全局代理（让MCP HTTP请求走代理）
	const {initGlobalProxy} = await import('./utils/core/proxyUtils.js');
	initGlobalProxy();

	const [
		appModule,
		vscodeModule,
		resourceModule,
		configModule,
		processModule,
		devModeModule,
		childProcessModule,
		utilModule,
		mcpModule,
	] = await Promise.all([
		import('./app.js'),
		import('./utils/ui/vscodeConnection.js'),
		import('./utils/core/resourceMonitor.js'),
		import('./utils/config/configManager.js'),
		import('./utils/core/processManager.js'),
		import('./utils/core/devMode.js'),
		import('child_process'),
		import('util'),
		import('./utils/execution/mcpToolsManager.js'),
	]);

	return {
		App: appModule.default,
		vscodeConnection: vscodeModule.vscodeConnection,
		resourceMonitor: resourceModule.resourceMonitor,
		initializeProfiles: configModule.initializeProfiles,
		processManager: processModule.processManager,
		enableDevMode: devModeModule.enableDevMode,
		getDevUserId: devModeModule.getDevUserId,
		exec: childProcessModule.exec,
		promisify: utilModule.promisify,
		closeAllMCPConnections: mcpModule.closeAllMCPConnections,
	};
}

let execAsync: any;

// Check for updates asynchronously
async function checkForUpdates(currentVersion: string): Promise<void> {
	try {
		const {stdout} = await execAsync(
			'npm view snow-ai version --registry https://registry.npmjs.org',
			{
				encoding: 'utf8',
			},
		);
		const latestVersion = stdout.trim();

		// Simple string comparison - force registry fetch ensures no cache issues
		if (latestVersion && latestVersion !== currentVersion) {
			setUpdateNotice({currentVersion, latestVersion});
		} else {
			setUpdateNotice(null);
		}
	} catch {
		// Silently fail - don't interrupt user experience
		setUpdateNotice(null);
	}
}

const cli = meow(
	`
Usage
  $ snow
  $ snow --ask \"your prompt\"
  $ snow --ask \"your prompt\" <sessionId>
  $ snow --task \"your task description\"
  $ snow --task-list

Options
		--help        Show help
		--version     Show version
		--update      Update to latest version
		-c            Skip welcome screen and resume last conversation
		--ask         Quick question mode (headless mode with single prompt, optional sessionId for continuous conversation)
		--task        Create a background AI task (headless mode, saves session)
		--task-list   Open task manager to view and manage background tasks
		--yolo        Skip welcome screen and enable YOLO mode (auto-approve tools)
		--c-yolo      Skip welcome screen, resume last conversation, and enable YOLO mode
		--dev         Enable developer mode with persistent userId for testing
		--sse         Start SSE server mode for external integration (foreground)
		--sse-daemon  Start SSE server as background daemon
		--sse-stop    Stop SSE daemon server
		--sse-status  Show SSE daemon server status
		--sse-port    SSE server port (default: 3000)
		--sse-timeout SSE server interaction timeout in milliseconds (default: 300000, i.e. 5 minutes)
		--work-dir    Working directory for SSE server (default: current directory)
`,
	{
		importMeta: import.meta,
		flags: {
			update: {
				type: 'boolean',
				default: false,
			},
			c: {
				type: 'boolean',
				default: false,
			},
			ask: {
				type: 'string',
			},
			task: {
				type: 'string',
			},
			taskList: {
				type: 'boolean',
				default: false,
				alias: 'task-list',
			},
			taskExecute: {
				type: 'string',
				alias: 'task-execute',
			},
			yolo: {
				type: 'boolean',
				default: false,
			},
			cYolo: {
				type: 'boolean',
				default: false,
				alias: 'c-yolo',
			},
			dev: {
				type: 'boolean',
				default: false,
			},
			sse: {
				type: 'boolean',
				default: false,
			},
			sseDaemon: {
				type: 'boolean',
				default: false,
				alias: 'sse-daemon',
			},
			sseDaemonMode: {
				type: 'boolean',
				default: false,
				alias: 'sse-daemon-mode',
			},
			sseStop: {
				type: 'boolean',
				default: false,
				alias: 'sse-stop',
			},
			sseStatus: {
				type: 'boolean',
				default: false,
				alias: 'sse-status',
			},
			ssePort: {
				type: 'number',
				default: 3000,
				alias: 'sse-port',
			},
			sseTimeout: {
				type: 'number',
				default: 300000,
				alias: 'sse-timeout',
			},
			workDir: {
				type: 'string',
				alias: 'work-dir',
			},
		},
	},
);

// Handle update flag
if (cli.flags.update) {
	console.log('Updating snow-ai to latest version...');
	try {
		execSync('npm install -g snow-ai@latest', {stdio: 'inherit'});
		console.log('Update completed successfully');
		process.exit(0);
	} catch (error) {
		console.error(
			'Update failed:',
			error instanceof Error ? error.message : error,
		);
		process.exit(1);
	}
}

// Handle SSE daemon stop
if (cli.flags.sseStop) {
	const {stopDaemon} = await import('./utils/sse/sseDaemon.js');
	// 支持通过PID或端口停止
	const target = cli.input[0] ? parseInt(cli.input[0]) : cli.flags.ssePort;
	stopDaemon(target);
	process.exit(0);
}

// Handle SSE daemon status
if (cli.flags.sseStatus) {
	const {daemonStatus} = await import('./utils/sse/sseDaemon.js');
	daemonStatus();
	process.exit(0);
}

// Handle SSE daemon mode
if (cli.flags.sseDaemon) {
	const {startDaemon} = await import('./utils/sse/sseDaemon.js');
	const port = cli.flags.ssePort || 3000;
	const timeout = cli.flags.sseTimeout || 300000;
	const workDir = cli.flags.workDir;
	startDaemon(port, workDir, timeout);
	process.exit(0);
}

// Handle SSE server mode
if (cli.flags.sse) {
	const {sseManager} = await import('./utils/sse/sseManager.js');
	const port = cli.flags.ssePort || 3000;
	const timeout = cli.flags.sseTimeout || 300000;
	const workDir = cli.flags.workDir;
	const isDaemonMode = cli.flags.sseDaemonMode;

	// 如果指定了工作目录，切换到该目录
	if (workDir) {
		try {
			process.chdir(workDir);
		} catch (error) {
			console.error(`错误: 无法切换到工作目录 ${workDir}`);
			console.error(error instanceof Error ? error.message : error);
			process.exit(1);
		}
	}

	// 守护进程模式：使用 DaemonLogger 纯文本日志
	if (isDaemonMode) {
		const {DaemonLogger} = await import('./utils/sse/daemonLogger.js');
		const logFilePath = process.env['SSE_DAEMON_LOG_FILE'];

		if (!logFilePath) {
			console.error('错误: 守护进程模式缺少日志文件路径');
			process.exit(1);
		}

		const logger = new DaemonLogger(logFilePath);

		// 设置日志回调
		sseManager.setLogCallback((message, level) => {
			logger.log(message, level);
		});

		await sseManager.start(port, timeout);

		// 保持进程运行
		process.on('SIGINT', async () => {
			logger.log('接收到 SIGINT 信号，正在停止服务器...', 'info');
			await sseManager.stop();
			process.exit(0);
		});

		process.on('SIGTERM', async () => {
			logger.log('接收到 SIGTERM 信号，正在停止服务器...', 'info');
			await sseManager.stop();
			process.exit(0);
		});

		// 阻止进程退出
		await new Promise(() => {});
	} else {
		// 前台模式：使用 Ink UI
		const {SSEServerStatus} = await import(
			'./ui/components/sse/SSEServerStatus.js'
		);
		const {I18nProvider} = await import('./i18n/I18nContext.js');

		// 渲染 SSE 服务器信息组件
		let logUpdater: (
			message: string,
			level?: 'info' | 'error' | 'success',
		) => void;

		const {unmount} = render(
			<I18nProvider>
				<SSEServerStatus
					port={port}
					workingDir={workDir || process.cwd()}
					onLogUpdate={callback => {
						logUpdater = callback;
					}}
				/>
			</I18nProvider>,
		);

		// 设置日志回调
		sseManager.setLogCallback((message, level) => {
			if (logUpdater) {
				logUpdater(message, level);
			}
		});

		await sseManager.start(port, timeout);

		// 保持进程运行
		process.on('SIGINT', async () => {
			unmount();
			console.log('\nStopping SSE server...');
			await sseManager.stop();
			process.exit(0);
		});

		process.on('SIGTERM', async () => {
			unmount();
			console.log('\nStopping SSE server...');
			await sseManager.stop();
			process.exit(0);
		});

		// 阻止进程退出
		await new Promise(() => {});
	}
}

// Handle task creation - create and execute in background
if (cli.flags.task) {
	const {taskManager} = await import('./utils/task/taskManager.js');
	const {executeTaskInBackground} = await import(
		'./utils/task/taskExecutor.js'
	);

	const task = await taskManager.createTask(cli.flags.task);
	await executeTaskInBackground(task.id, cli.flags.task);

	console.log(`Task created: ${task.id}`);
	console.log(`Title: ${task.title}`);
	console.log(`Use "snow --task-list" to view task status`);
	process.exit(0);
}

// Handle task execution (internal use by background process)
if (cli.flags.taskExecute) {
	const {executeTask} = await import('./utils/task/taskExecutor.js');
	const taskId = cli.flags.taskExecute;
	// Get prompt from remaining args after --
	const promptIndex = process.argv.indexOf('--');
	const prompt =
		promptIndex !== -1
			? process.argv.slice(promptIndex + 1).join(' ')
			: cli.input.join(' ');

	console.log(
		`[Task ${taskId}] Starting execution with prompt: ${prompt.slice(
			0,
			50,
		)}...`,
	);
	await executeTask(taskId, prompt);
	process.exit(0);
}

// Startup component that shows loading spinner during update check
const Startup = ({
	version,
	skipWelcome,
	autoResume,
	headlessPrompt,
	headlessSessionId,
	showTaskList,
	isDevMode,
	enableYolo,
}: {
	version: string | undefined;
	skipWelcome: boolean;
	autoResume: boolean;
	headlessPrompt?: string;
	headlessSessionId?: string;
	showTaskList?: boolean;
	isDevMode: boolean;
	enableYolo: boolean;
}) => {
	const [appReady, setAppReady] = React.useState(false);
	const [AppComponent, setAppComponent] = React.useState<any>(null);

	React.useEffect(() => {
		let mounted = true;

		const init = async () => {
			// Load all dependencies in parallel
			const deps = await loadDependencies();
			// Setup execAsync for checkForUpdates
			execAsync = deps.promisify(deps.exec);
			setUpdateNotice(null);

			// Initialize profiles system
			try {
				deps.initializeProfiles();
			} catch (error) {
				console.error('Failed to initialize profiles:', error);
			}

			// Handle dev mode
			if (isDevMode) {
				deps.enableDevMode();
				const userId = deps.getDevUserId();
				console.log('Developer mode enabled');
				console.log(`Using persistent userId: ${userId}`);
				console.log(`Stored in: ~/.snow/dev-user-id\n`);
			}

			// Start resource monitoring in development/debug mode
			if (process.env['NODE_ENV'] === 'development' || process.env['DEBUG']) {
				deps.resourceMonitor.startMonitoring(30000);
				setInterval(() => {
					const {hasLeak, reasons} = deps.resourceMonitor.checkForLeaks();
					if (hasLeak) {
						console.error('Potential memory leak detected:');
						reasons.forEach((reason: string) => console.error(`  - ${reason}`));
					}
				}, 5 * 60 * 1000);
			}

			// Store for cleanup
			(global as any).__deps = deps;

			// Check for updates with timeout
			const updateCheckPromise = VERSION
				? checkForUpdates(VERSION)
				: Promise.resolve();

			// Race between update check and 3-second timeout
			await Promise.race([
				updateCheckPromise,
				new Promise(resolve => setTimeout(resolve, 3000)),
			]);

			if (mounted) {
				setAppComponent(() => deps.App);
				setAppReady(true);
			}
		};

		init();

		return () => {
			mounted = false;
		};
	}, [version, isDevMode]);

	if (!appReady || !AppComponent) {
		return (
			<Box flexDirection="column">
				<Box>
					<Text color="cyan">
						<Spinner type="dots" />
					</Text>
					<Text> Loading...</Text>
				</Box>
			</Box>
		);
	}

	return (
		<AppComponent
			version={version}
			skipWelcome={skipWelcome}
			autoResume={autoResume}
			headlessPrompt={headlessPrompt}
			headlessSessionId={headlessSessionId}
			showTaskList={showTaskList}
			enableYolo={enableYolo}
		/>
	);
};

// Disable bracketed paste mode on startup
process.stdout.write('\x1b[?2004l');
// Clear the early loading indicator and show cursor
process.stdout.write('\x1b[2K\r'); // Clear line
process.stdout.write('\x1b[?25h'); // Show cursor

// Track cleanup state to prevent multiple cleanup calls
let isCleaningUp = false;

// Synchronous cleanup for 'exit' event (cannot be async)
const cleanupSync = () => {
	process.stdout.write('\x1b[?2004l');
	const deps = (global as any).__deps;
	if (deps) {
		// Kill all child processes synchronously
		deps.processManager.killAll();
		deps.resourceMonitor.stopMonitoring();
		deps.vscodeConnection.stop();
	}
};

// Async cleanup for SIGINT/SIGTERM - waits for graceful shutdown
const cleanupAsync = async () => {
	if (isCleaningUp) return;
	isCleaningUp = true;

	process.stdout.write('\x1b[?2004l');
	const deps = (global as any).__deps;
	if (deps) {
		// Close MCP connections first (graceful shutdown with timeout)
		try {
			await Promise.race([
				deps.closeAllMCPConnections?.(),
				new Promise(resolve => setTimeout(resolve, 2000)), // 2s timeout
			]);
		} catch {
			// Ignore MCP close errors
		}
		// Then kill remaining processes
		deps.processManager.killAll();
		deps.resourceMonitor.stopMonitoring();
		deps.vscodeConnection.stop();
	}
};

process.on('exit', cleanupSync);
process.on('SIGINT', async () => {
	await cleanupAsync();
	process.exit(0);
});
process.on('SIGTERM', async () => {
	await cleanupAsync();
	process.exit(0);
});
render(
	<Startup
		version={VERSION}
		skipWelcome={Boolean(cli.flags.c || cli.flags.yolo || cli.flags.cYolo)}
		autoResume={Boolean(cli.flags.c || cli.flags.cYolo)}
		headlessPrompt={cli.flags.ask}
		headlessSessionId={cli.input[0]}
		showTaskList={cli.flags.taskList}
		isDevMode={cli.flags.dev}
		enableYolo={Boolean(cli.flags.yolo || cli.flags.cYolo)}
	/>,
	{
		exitOnCtrlC: false,
		patchConsole: true,
	},
);
