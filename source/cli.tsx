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
	console.error('  ⚠️  Node.js Version Compatibility Error');
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
			console.log('\n🔔 Update available!');
			console.log(`   Current version: ${currentVersion}`);
			console.log(`   Latest version:  ${latestVersion}`);
			console.log('   Run "snow --update" to update\n');
			console.log('   Github: https://github.com/MayDay-wpf/snow-cli');
		}
	} catch (error) {
		// Silently fail - don't interrupt user experience
	}
}

const cli = meow(
	`
Usage
  $ snow
  $ snow --ask \"your prompt\"
  $ snow --task \"your task description\"
  $ snow --task-list

Options
		--help        Show help
		--version     Show version
		--update      Update to latest version
		-c            Skip welcome screen and resume last conversation
		--ask         Quick question mode (headless mode with single prompt)
		--task        Create a background AI task (headless mode, saves session)
		--task-list   Open task manager to view and manage background tasks
		--yolo        Skip welcome screen and enable YOLO mode (auto-approve tools)
		--c-yolo      Skip welcome screen, resume last conversation, and enable YOLO mode
		--dev         Enable developer mode with persistent userId for testing
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
		},
	},
);

// Handle update flag
if (cli.flags.update) {
	console.log('🔄 Updating snow-ai to latest version...');
	try {
		execSync('npm install -g snow-ai@latest', {stdio: 'inherit'});
		console.log('✅ Update completed successfully!');
		process.exit(0);
	} catch (error) {
		console.error(
			'❌ Update failed:',
			error instanceof Error ? error.message : error,
		);
		process.exit(1);
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

// Dev mode and resource monitoring will be initialized in Startup component

// Startup component that shows loading spinner during update check
const Startup = ({
	version,
	skipWelcome,
	autoResume,
	headlessPrompt,
	showTaskList,
	isDevMode,
	enableYolo,
}: {
	version: string | undefined;
	skipWelcome: boolean;
	autoResume: boolean;
	headlessPrompt?: string;
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
				console.log('🔧 Developer mode enabled');
				console.log(`📝 Using persistent userId: ${userId}`);
				console.log(`📂 Stored in: ~/.snow/dev-user-id\n`);
			}

			// Start resource monitoring in development/debug mode
			if (process.env['NODE_ENV'] === 'development' || process.env['DEBUG']) {
				deps.resourceMonitor.startMonitoring(30000);
				setInterval(() => {
					const {hasLeak, reasons} = deps.resourceMonitor.checkForLeaks();
					if (hasLeak) {
						console.error('⚠️ Potential memory leak detected:');
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
		showTaskList={cli.flags.taskList}
		isDevMode={cli.flags.dev}
		enableYolo={Boolean(cli.flags.yolo || cli.flags.cYolo)}
	/>,
	{
		exitOnCtrlC: false,
		patchConsole: true,
	},
);
