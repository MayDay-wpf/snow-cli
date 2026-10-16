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
import {logger} from '../core/logger.js';

const sseLog = logger.child('sse:daemon');

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
try {
	if (!existsSync(DAEMON_DIR)) {
		mkdirSync(DAEMON_DIR, {recursive: true});
	}
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, {recursive: true});
	}
} catch (err) {
	sseLog.debug('Failed to create daemon directories:', err);
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
				sseLog.error(formatMessage(t.portOccupied, {port, pid}));
				sseLog.error(formatMessage(t.stopExistingByPort, {port}));
				sseLog.error(formatMessage(t.stopExistingByPid, {pid}));
				process.exit(1);
			} catch (err) {
				// 进程不存在，清理旧文件
				sseLog.debug(`Process ${pid} is not running, unlinking stale pid file ${pidFile}:`, err);
				try {
					unlinkSync(pidFile);
				} catch (unlinkErr) {
					sseLog.debug(`Failed to unlink stale pid file ${pidFile}:`, unlinkErr);
				}
			}
		} catch (err) {
			// PID文件损坏，删除它
			sseLog.debug(`Corrupted PID file ${pidFile}, deleting:`, err);
			try {
				unlinkSync(pidFile);
			} catch (unlinkErr) {
				sseLog.debug(`Failed to unlink corrupted pid file ${pidFile}:`, unlinkErr);
			}
		}
	}

	const t = getTranslation();
	sseLog.info(formatMessage(t.startingDaemon, {port}));

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
		sseLog.info(t.daemonStarted);
		sseLog.info(`${t.pid}: ${child.pid}`);
		sseLog.info(`${t.port}: ${port}`);
		sseLog.info(`${t.workDir}: ${daemonInfo.workDir}`);
		sseLog.info(`${t.timeout}: ${timeout}ms`);
		sseLog.info(`${t.logFile}: ${logFile}`);
		sseLog.info(`\n${t.stopService}:`);
		sseLog.info(`  ${t.stopByPort}: snow --sse-stop --sse-port ${port}`);
		sseLog.info(`  ${t.stopByPid}:  snow --sse-stop ${child.pid}`);
		sseLog.info(`\n${t.checkStatus}: snow --sse-status`);
	} catch (error) {
		const t = getTranslation();
		sseLog.error(`${t.savePidFailed}:`, error);
		// 杀死子进程
		try {
			process.kill(child.pid!);
		} catch (killErr) {
			sseLog.debug(`Failed to kill child ${child.pid} after pid save failure:`, killErr);
		}
		process.exit(1);
	}

	// 等待一秒后检查进程是否仍在运行
	setTimeout(() => {
		try {
			process.kill(child.pid!, 0); // 检查进程是否存在
		} catch (err) {
			const t = getTranslation();
			sseLog.error(t.daemonStartFailed);
			sseLog.error(`  ${logFile}`);
			sseLog.debug(`Daemon process ${child.pid} terminated shortly after spawn:`, err);
			// 清理 PID 文件
			try {
				unlinkSync(pidFile);
			} catch (unlinkErr) {
				sseLog.debug(`Failed to unlink pid file ${pidFile}:`, unlinkErr);
			}
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
			sseLog.error(`${t.readPidFailed}:`, error);
			sseLog.info(t.tryRemoveInvalidPid);
			try {
				unlinkSync(pidFile);
			} catch (unlinkErr) {
				sseLog.debug(`Failed to unlink invalid pid file ${pidFile}:`, unlinkErr);
			}
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
			} catch (err) {
				sseLog.debug(`Failed to read pid file ${pidFile}:`, err);
			}
		}

		if (!found) {
			const t = getTranslation();
			sseLog.info(formatMessage(t.noDaemonForPid, {pid: target}));
		}
	}
}

/**
 * 杀死进程并清理PID文件
 */
function killProcess(pid: number, pidFile: string): void {
	const t = getTranslation();
	sseLog.info(formatMessage(t.stoppingDaemon, {pid}));

	try {
		if (process.platform === 'win32') {
			// Windows: 使用 taskkill 杀死进程树（同步执行）
			try {
				execSync(`taskkill /PID ${pid} /T /F`, {stdio: 'ignore'});
				sseLog.info(t.daemonStopped);
			} catch (error: any) {
				sseLog.debug(`taskkill failed for pid ${pid}, falling back to process.kill:`, error);
				// taskkill 失败时尝试使用 process.kill
				try {
					process.kill(pid, 'SIGTERM');
					sseLog.info(t.daemonStopped);
				} catch (killErr) {
					sseLog.error(t.stopProcessFailed);
					sseLog.debug(`process.kill fallback failed for pid ${pid}:`, killErr);
				}
			}
		} else {
			// Unix: 使用 SIGTERM
			process.kill(pid, 'SIGTERM');
			sseLog.info(t.daemonStopped);
		}

		// 删除 PID 文件
		try {
			unlinkSync(pidFile);
		} catch (unlinkErr) {
			sseLog.debug(`Failed to unlink pid file ${pidFile}:`, unlinkErr);
		}
	} catch (error: any) {
		if (error.code === 'ESRCH') {
			sseLog.info(t.processNotExists);
			try {
				unlinkSync(pidFile);
			} catch (unlinkErr) {
				sseLog.debug(`Failed to unlink pid file ${pidFile}:`, unlinkErr);
			}
		} else {
			sseLog.error(`${t.stopProcessError}:`, error.message);
			sseLog.debug(`Error stopping process ${pid}:`, error);
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
	} catch (err) {
		sseLog.debug(`Failed to read pid directory ${DAEMON_DIR}:`, err);
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
		sseLog.info(t.noRunningDaemons);
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
			} catch (err) {
				// 进程已停止，记录待清理的文件
				sseLog.debug(`Daemon process ${pid} is not alive:`, err);
				stoppedPidFiles.push(pidFile);
			}
		} catch (err) {
			// PID文件损坏，记录待清理的文件
			sseLog.debug(`Corrupted PID file ${pidFile}:`, err);
			stoppedPidFiles.push(pidFile);
		}
	}

	if (runningDaemons.length === 0) {
		sseLog.info(t.noRunningDaemons);
		if (stoppedPidFiles.length > 0) {
			sseLog.info(
				`\n${formatMessage(t.foundInvalidPids, {
					count: stoppedPidFiles.length,
				})}`,
			);
			sseLog.info(t.cleanupHint);
		}
		return;
	}

	sseLog.info(
		`${formatMessage(t.runningDaemons, {count: runningDaemons.length})}:\n`,
	);

	for (const daemon of runningDaemons) {
		const {pid, port, workDir, timeout, startTime} = daemon;
		const logFile = getLogFilePath(port);

		sseLog.info(`${t.pid}: ${pid} | ${t.port}: ${port}`);
		sseLog.info(`  ${t.workDir}: ${workDir}`);
		sseLog.info(`  ${t.timeout}: ${timeout}ms`);
		sseLog.info(`  ${t.startTime}: ${new Date(startTime).toLocaleString()}`);
		sseLog.info(`  ${t.logFile}: ${logFile}`);
		sseLog.info(`  ${t.endpoint}: http://localhost:${port}/events`);
		sseLog.info(
			`  ${t.stopCommand}: snow --sse-stop ${pid} 或 snow --sse-stop --sse-port ${port}`,
		);
		sseLog.info('');
	}

	if (stoppedPidFiles.length > 0) {
		sseLog.info(
			formatMessage(t.invalidPidsStopped, {count: stoppedPidFiles.length}),
		);
		sseLog.info(t.autoCleanupHint);
	}
}
