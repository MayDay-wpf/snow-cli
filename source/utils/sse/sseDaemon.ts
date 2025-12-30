import {spawn, execSync} from 'child_process';
import {
	existsSync,
	readFileSync,
	writeFileSync,
	unlinkSync,
	readdirSync,
	mkdirSync,
} from 'fs';
import {join} from 'path';
import {homedir} from 'os';
import {getCurrentLanguage} from '../config/languageConfig.js';
import {translations} from '../../i18n/index.js';

/**
 * SSE 守护进程管理器
 * 支持多实例运行，通过端口或PID管理
 */

// 获取翻译文本
function getTranslation() {
	const currentLanguage = getCurrentLanguage();
	return translations[currentLanguage].sseDaemon;
}

// 字符串模板替换
function formatMessage(template: string, params: Record<string, any>): string {
	return template.replace(/\{(\w+)\}/g, (match, key) => {
		return params[key]?.toString() ?? match;
	});
}

// PID 文件存储目录
const SNOW_DIR = join(homedir(), '.snow');
const DAEMON_DIR = join(SNOW_DIR, 'sse-daemons');
const LOG_DIR = join(SNOW_DIR, 'sse-logs');

// 确保目录存在
if (!existsSync(DAEMON_DIR)) {
	mkdirSync(DAEMON_DIR, {recursive: true});
}
if (!existsSync(LOG_DIR)) {
	mkdirSync(LOG_DIR, {recursive: true});
}

interface DaemonInfo {
	pid: number;
	port: number;
	workDir: string;
	timeout: number;
	startTime: string;
}

/**
 * 获取指定端口的PID文件路径
 */
function getPidFilePath(port: number): string {
	return join(DAEMON_DIR, `port-${port}.pid`);
}

/**
 * 获取指定端口的日志文件路径
 */
function getLogFilePath(port: number): string {
	return join(LOG_DIR, `port-${port}.log`);
}

/**
 * 启动 SSE 守护进程
 */
export function startDaemon(
	port: number = 3000,
	workDir?: string,
	timeout: number = 300000,
): void {
	const pidFile = getPidFilePath(port);
	const logFile = getLogFilePath(port);

	// 检查该端口是否已有进程在运行
	if (existsSync(pidFile)) {
		try {
			const daemonInfo: DaemonInfo = JSON.parse(readFileSync(pidFile, 'utf-8'));
			const {pid} = daemonInfo;

			// 检查进程是否真的在运行
			try {
				process.kill(pid, 0);
				const t = getTranslation();
				console.error(formatMessage(t.portOccupied, {port, pid}));
				console.error(formatMessage(t.stopExistingByPort, {port}));
				console.error(formatMessage(t.stopExistingByPid, {pid}));
				process.exit(1);
			} catch {
				// 进程不存在，清理旧文件
				unlinkSync(pidFile);
			}
		} catch {
			// PID文件损坏，删除它
			unlinkSync(pidFile);
		}
	}

	const t = getTranslation();
	console.log(formatMessage(t.startingDaemon, {port}));

	// 构建启动参数
	const args = [
		'--sse',
		'--sse-port',
		port.toString(),
		'--sse-daemon-mode', // 标识为守护进程模式，禁用Ink UI
	];

	if (workDir) {
		args.push('--work-dir', workDir);
	}

	if (timeout !== 300000) {
		args.push('--sse-timeout', timeout.toString());
	}

	// 获取当前执行文件路径
	const scriptPath = process.argv[1] || ''; // 当前脚本路径

	// 判断是开发模式还是打包模式
	const isDev = scriptPath.includes('source');
	let command: string;
	let commandArgs: string[];

	if (isDev) {
		// 开发模式：使用 tsx
		command = 'npx';
		commandArgs = ['tsx', scriptPath, ...args];
	} else {
		// 打包模式：直接使用 Node.js 执行脚本
		// 兼容所有平台（Windows/Linux/macOS）
		command = process.execPath; // Node.js 可执行文件路径
		commandArgs = [scriptPath, ...args];
	}

	// 守护进程模式：使用 DaemonLogger 进行纯文本日志记录
	// 不再直接重定向 stdio 到文件，而是通过环境变量传递日志文件路径
	const env = {
		...process.env,
		SSE_DAEMON_LOG_FILE: logFile, // 传递日志文件路径给子进程
	};

	// 启动守护进程
	const child = spawn(command, commandArgs, {
		detached: true,
		stdio: ['ignore', 'ignore', 'ignore'], // 忽略所有stdio，避免Ink UI字符污染
		windowsHide: true,
		cwd: workDir || process.cwd(),
		env, // 传递环境变量
	});

	// 解除父进程引用，使其可以独立运行
	child.unref();

	// 保存进程信息
	const daemonInfo: DaemonInfo = {
		pid: child.pid!,
		port,
		workDir: workDir || process.cwd(),
		timeout,
		startTime: new Date().toISOString(),
	};

	try {
		writeFileSync(pidFile, JSON.stringify(daemonInfo, null, 2));
		const t = getTranslation();
		console.log(t.daemonStarted);
		console.log(`${t.pid}: ${child.pid}`);
		console.log(`${t.port}: ${port}`);
		console.log(`${t.workDir}: ${daemonInfo.workDir}`);
		console.log(`${t.timeout}: ${timeout}ms`);
		console.log(`${t.logFile}: ${logFile}`);
		console.log(`\n${t.stopService}:`);
		console.log(`  ${t.stopByPort}: snow --sse-stop --sse-port ${port}`);
		console.log(`  ${t.stopByPid}:  snow --sse-stop ${child.pid}`);
		console.log(`\n${t.checkStatus}: snow --sse-status`);
	} catch (error) {
		const t = getTranslation();
		console.error(`${t.savePidFailed}:`, error);
		// 杀死子进程
		try {
			process.kill(child.pid!);
		} catch {}
		process.exit(1);
	}

	// 等待一秒后检查进程是否仍在运行
	setTimeout(() => {
		try {
			process.kill(child.pid!, 0); // 检查进程是否存在
		} catch {
			const t = getTranslation();
			console.error(t.daemonStartFailed);
			console.error(`  ${logFile}`);
			// 清理 PID 文件
			try {
				unlinkSync(pidFile);
			} catch {}
		}
	}, 1000);
}

/**
 * 停止 SSE 守护进程
 * @param target 端口号或PID
 */
export function stopDaemon(target?: number): void {
	// 如果没有指定目标，尝试停止默认端口3000
	if (target === undefined) {
		target = 3000;
	}

	// 判断target是端口还是PID
	// 策略：先检查是否存在对应端口的PID文件，存在则按端口处理，否则按PID处理
	const pidFile = getPidFilePath(target);
	const isPort = target <= 65535 && existsSync(pidFile);

	if (isPort) {
		// 通过端口停止
		try {
			const daemonInfo: DaemonInfo = JSON.parse(readFileSync(pidFile, 'utf-8'));
			killProcess(daemonInfo.pid, pidFile);
		} catch (error) {
			const t = getTranslation();
			console.error(`${t.readPidFailed}:`, error);
			console.log(t.tryRemoveInvalidPid);
			try {
				unlinkSync(pidFile);
			} catch {}
		}
	} else {
		// 通过PID停止
		const allPidFiles = getAllPidFiles();
		let found = false;

		for (const pidFile of allPidFiles) {
			try {
				const daemonInfo: DaemonInfo = JSON.parse(
					readFileSync(pidFile, 'utf-8'),
				);
				if (daemonInfo.pid === target) {
					found = true;
					killProcess(daemonInfo.pid, pidFile);
					break;
				}
			} catch {}
		}

		if (!found) {
			const t = getTranslation();
			console.log(formatMessage(t.noDaemonForPid, {pid: target}));
		}
	}
}

/**
 * 杀死进程并清理PID文件
 */
function killProcess(pid: number, pidFile: string): void {
	const t = getTranslation();
	console.log(formatMessage(t.stoppingDaemon, {pid}));

	try {
		if (process.platform === 'win32') {
			// Windows: 使用 taskkill 杀死进程树（同步执行）
			try {
				execSync(`taskkill /PID ${pid} /T /F`, {stdio: 'ignore'});
				console.log(t.daemonStopped);
			} catch (error: any) {
				// taskkill 失败时尝试使用 process.kill
				try {
					process.kill(pid, 'SIGTERM');
					console.log(t.daemonStopped);
				} catch {
					console.error(t.stopProcessFailed);
				}
			}
		} else {
			// Unix: 使用 SIGTERM
			process.kill(pid, 'SIGTERM');
			console.log(t.daemonStopped);
		}

		// 删除 PID 文件
		try {
			unlinkSync(pidFile);
		} catch {}
	} catch (error: any) {
		if (error.code === 'ESRCH') {
			console.log(t.processNotExists);
			try {
				unlinkSync(pidFile);
			} catch {}
		} else {
			console.error(`${t.stopProcessError}:`, error.message);
		}
	}
}

/**
 * 获取所有PID文件路径
 */
function getAllPidFiles(): string[] {
	try {
		return readdirSync(DAEMON_DIR)
			.filter(file => file.endsWith('.pid'))
			.map(file => join(DAEMON_DIR, file));
	} catch {
		return [];
	}
}

/**
 * 查看所有 SSE 守护进程状态
 */
export function daemonStatus(): void {
	const allPidFiles = getAllPidFiles();
	const t = getTranslation();

	if (allPidFiles.length === 0) {
		console.log(t.noRunningDaemons);
		return;
	}

	const runningDaemons: DaemonInfo[] = [];
	const stoppedPidFiles: string[] = [];

	// 检查每个守护进程状态
	for (const pidFile of allPidFiles) {
		try {
			const daemonInfo: DaemonInfo = JSON.parse(readFileSync(pidFile, 'utf-8'));
			const {pid} = daemonInfo;

			// 检查进程是否仍在运行
			try {
				process.kill(pid, 0);
				runningDaemons.push(daemonInfo);
			} catch {
				// 进程已停止，记录待清理的文件
				stoppedPidFiles.push(pidFile);
			}
		} catch {
			// PID文件损坏，记录待清理的文件
			stoppedPidFiles.push(pidFile);
		}
	}

	if (runningDaemons.length === 0) {
		console.log(t.noRunningDaemons);
		if (stoppedPidFiles.length > 0) {
			console.log(
				`\n${formatMessage(t.foundInvalidPids, {
					count: stoppedPidFiles.length,
				})}`,
			);
			console.log(t.cleanupHint);
		}
		return;
	}

	console.log(
		`${formatMessage(t.runningDaemons, {count: runningDaemons.length})}:\n`,
	);

	for (const daemon of runningDaemons) {
		const {pid, port, workDir, timeout, startTime} = daemon;
		const logFile = getLogFilePath(port);

		console.log(`${t.pid}: ${pid} | ${t.port}: ${port}`);
		console.log(`  ${t.workDir}: ${workDir}`);
		console.log(`  ${t.timeout}: ${timeout}ms`);
		console.log(`  ${t.startTime}: ${new Date(startTime).toLocaleString()}`);
		console.log(`  ${t.logFile}: ${logFile}`);
		console.log(`  ${t.endpoint}: http://localhost:${port}/events`);
		console.log(
			`  ${t.stopCommand}: snow --sse-stop ${pid} 或 snow --sse-stop --sse-port ${port}`,
		);
		console.log('');
	}

	if (stoppedPidFiles.length > 0) {
		console.log(
			formatMessage(t.invalidPidsStopped, {count: stoppedPidFiles.length}),
		);
		console.log(t.autoCleanupHint);
	}
}
