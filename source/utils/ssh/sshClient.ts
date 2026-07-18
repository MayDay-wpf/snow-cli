import type {Client as SSH2Client, ConnectConfig, SFTPWrapper} from 'ssh2';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {logger} from '../core/logger.js';
import type {SSHConfig} from '../config/workingDirConfig.js';

// ---------------------------------------------------------------------------
// Lazy ssh2 loader
//
// We intentionally avoid a static `import` of the `ssh2` package because the
// native/JS files inside `ssh2` are occasionally missing in user installs
// (broken global npm install, antivirus quarantining `crypto/poly1305.js`,
// half-written `node_modules`, disk-full during install, etc.). A static
// import would crash the entire CLI at startup with an opaque
// "Cannot find module './crypto/poly1305.js'" stack trace.
//
// Instead, we lazy-load ssh2 on first SSH operation and translate load
// failures into a friendly, actionable error message.
// ---------------------------------------------------------------------------

type Ssh2Module = typeof import('ssh2');

let ssh2ModulePromise: Promise<Ssh2Module> | null = null;

function getFriendlySsh2ErrorMessage(error: unknown): string {
	const rawMessage = error instanceof Error ? error.message : String(error);
	const isModuleMissing =
		/Cannot find module/i.test(rawMessage) ||
		/MODULE_NOT_FOUND/i.test(rawMessage) ||
		/ENOENT/i.test(rawMessage);

	if (!isModuleMissing) {
		return `Failed to load ssh2 module: ${rawMessage}`;
	}

	return [
		'SSH module (ssh2) failed to load. It looks like the package is missing or corrupted.',
		`Underlying error: ${rawMessage}`,
		'',
		'How to fix:',
		'  1) Reinstall snow-ai:',
		'       npm uninstall -g snow-ai',
		'       npm cache clean --force',
		'       npm install -g snow-ai',
		'  2) Or repair the ssh2 sub-dependency only:',
		'       cd <snow-ai install dir>',
		'       npm install ssh2 --force',
		'  3) On Windows, temporarily disable antivirus / Windows Defender during install,',
		'     then add the snow-ai install directory to its whitelist (some AVs quarantine',
		"     ssh2's crypto/poly1305.js).",
	].join('\n');
}

async function loadSsh2(): Promise<Ssh2Module> {
	if (!ssh2ModulePromise) {
		ssh2ModulePromise = import('ssh2').catch((error: unknown) => {
			// Reset so subsequent calls can re-attempt (e.g. user may reinstall in another terminal
			// while the CLI is still running).
			ssh2ModulePromise = null;
			const friendly = new Error(getFriendlySsh2ErrorMessage(error));
			(friendly as Error & {cause?: unknown}).cause = error;
			throw friendly;
		});
	}
	return ssh2ModulePromise;
}

export interface SSHConnectionResult {
	success: boolean;
	error?: string;
}

export interface RemoteDirectoryEntry {
	name: string;
	isDirectory: boolean;
	size: number;
	modifyTime: Date;
}

/**
 * SSH Client for remote directory operations
 */
export class SSHClient {
	private client: SSH2Client | null = null;
	private sftp: SFTPWrapper | null = null;
	private connected = false;

	constructor() {
		// Intentionally empty: ssh2 is loaded lazily in connect() so that a broken
		// ssh2 install never crashes consumers that only construct the client.
	}

	/**
	 * Lazily obtain the underlying ssh2 Client, creating it on first use.
	 * Throws a friendly error if the ssh2 package is missing or broken.
	 */
	private async ensureClient(): Promise<SSH2Client> {
		if (!this.client) {
			const {Client} = await loadSsh2();
			this.client = new Client();
		}
		return this.client;
	}

	/**
	 * Connect to SSH server
	 */
	async connect(
		config: SSHConfig,
		password?: string,
	): Promise<SSHConnectionResult> {
		let client: SSH2Client;
		try {
			client = await this.ensureClient();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error('Failed to load ssh2 module', error);
			return {success: false, error: message};
		}

		return new Promise(resolve => {
			const connectConfig: ConnectConfig = {
				host: config.host,
				port: config.port,
				username: config.username,
			};

			// Set authentication method
			if (config.authMethod === 'password') {
				// Use password from config first, then fall back to parameter
				const pwd = config.password || password;
				if (pwd) {
					connectConfig.password = pwd;
				}
			} else if (config.authMethod === 'privateKey' && config.privateKeyPath) {
				try {
					const keyPath = config.privateKeyPath.startsWith('~')
						? path.join(os.homedir(), config.privateKeyPath.slice(1))
						: config.privateKeyPath;
					connectConfig.privateKey = fs.readFileSync(keyPath);
					if (config.passphrase) {
						connectConfig.passphrase = config.passphrase;
					}
				} catch (error) {
					resolve({
						success: false,
						error: `Failed to read private key: ${
							error instanceof Error ? error.message : String(error)
						}`,
					});
					return;
				}
			} else if (config.authMethod === 'agent') {
				connectConfig.agent = process.env['SSH_AUTH_SOCK'];
			}

			client.on('ready', () => {
				this.connected = true;
				client.sftp((err, sftp) => {
					if (err) {
						resolve({
							success: false,
							error: `SFTP initialization failed: ${err.message}`,
						});
						return;
					}
					this.sftp = sftp;
					resolve({success: true});
				});
			});

			client.on('error', err => {
				logger.error('SSH connection error', err);
				resolve({
					success: false,
					error: `Connection failed: ${err.message}`,
				});
			});

			client.connect(connectConfig);
		});
	}

	/**
	 * Test SSH connection without keeping it open
	 */
	async testConnection(
		config: SSHConfig,
		password?: string,
	): Promise<SSHConnectionResult> {
		const result = await this.connect(config, password);
		if (result.success) {
			this.disconnect();
		}
		return result;
	}

	/**
	 * List directory contents
	 */
	async listDirectory(remotePath: string): Promise<RemoteDirectoryEntry[]> {
		if (!this.sftp) {
			throw new Error('SFTP not initialized');
		}

		return new Promise((resolve, reject) => {
			this.sftp!.readdir(remotePath, (err, list) => {
				if (err) {
					reject(new Error(`Failed to list directory: ${err.message}`));
					return;
				}

				const entries: RemoteDirectoryEntry[] = list.map(item => ({
					name: item.filename,
					isDirectory: item.attrs.isDirectory(),
					size: item.attrs.size,
					modifyTime: new Date(item.attrs.mtime * 1000),
				}));

				resolve(entries);
			});
		});
	}

	/**
	 * Check if remote path exists and is a directory
	 */
	async isDirectory(remotePath: string): Promise<boolean> {
		if (!this.sftp) {
			throw new Error('SFTP not initialized');
		}

		return new Promise(resolve => {
			this.sftp!.stat(remotePath, (err, stats) => {
				if (err) {
					resolve(false);
					return;
				}
				resolve(stats.isDirectory());
			});
		});
	}

	/**
	 * Read file content from remote
	 */
	async readFile(remotePath: string): Promise<string> {
		if (!this.sftp) {
			throw new Error('SFTP not initialized');
		}

		return new Promise((resolve, reject) => {
			const chunks: Buffer[] = [];
			const stream = this.sftp!.createReadStream(remotePath);

			stream.on('data', (chunk: Buffer) => {
				chunks.push(chunk);
			});

			stream.on('end', () => {
				resolve(Buffer.concat(chunks).toString('utf-8'));
			});

			stream.on('error', (err: Error) => {
				reject(new Error(`Failed to read file: ${err.message}`));
			});
		});
	}

	/**
	 * Write file content to remote
	 */
	async writeFile(remotePath: string, content: string): Promise<void> {
		if (!this.sftp) {
			throw new Error('SFTP not initialized');
		}

		return new Promise((resolve, reject) => {
			const stream = this.sftp!.createWriteStream(remotePath);

			stream.on('close', () => {
				resolve();
			});

			stream.on('error', (err: Error) => {
				reject(new Error(`Failed to write file: ${err.message}`));
			});

			stream.end(content, 'utf-8');
		});
	}

	/**
	 * Execute command on remote server
	 */
	async exec(
		command: string,
		options?: {
			timeout?: number;
			signal?: AbortSignal;
		},
	): Promise<{stdout: string; stderr: string; code: number}> {
		if (!this.connected || !this.client) {
			throw new Error('Not connected');
		}
		const client = this.client;

		return new Promise((resolve, reject) => {
			client.exec(command, (err, stream) => {
				if (err) {
					reject(new Error(`Failed to execute command: ${err.message}`));
					return;
				}

				let stdout = '';
				let stderr = '';
				let settled = false;

				const safeResolve = (value: {
					stdout: string;
					stderr: string;
					code: number;
				}) => {
					if (settled) return;
					settled = true;
					safeCleanup();
					resolve(value);
				};
				const safeReject = (error: any) => {
					if (settled) return;
					settled = true;
					safeCleanup();
					reject(error);
				};

				let timeoutTimer: NodeJS.Timeout | null = null;
				const safeCleanup = () => {
					if (timeoutTimer) {
						clearTimeout(timeoutTimer);
						timeoutTimer = null;
					}
					if (options?.signal && abortHandler) {
						options.signal.removeEventListener('abort', abortHandler);
					}
				};

				const abortHandler = options?.signal
					? () => {
							const abortError: any = new Error('SSH command aborted');
							abortError.code = 'ABORT_ERR';
							abortError.stdout = stdout;
							abortError.stderr = stderr;
							try {
								stream.close();
								stream.destroy();
							} catch {
								// Ignore.
							}
							safeReject(abortError);
					  }
					: null;

				if (options?.signal && abortHandler) {
					if (options.signal.aborted) {
						abortHandler();
						return;
					}
					options.signal.addEventListener('abort', abortHandler);
				}

				const timeoutMs = options?.timeout;
				if (typeof timeoutMs === 'number' && timeoutMs > 0) {
					timeoutTimer = setTimeout(() => {
						const timeoutError: any = new Error(
							`SSH command timed out after ${timeoutMs}ms`,
						);
						timeoutError.code = 'ETIMEDOUT';
						timeoutError.stdout = stdout;
						timeoutError.stderr = stderr;
						try {
							stream.close();
							stream.destroy();
						} catch {
							// Ignore.
						}
						safeReject(timeoutError);
					}, timeoutMs);
				}

				stream.on('close', (code: number) => {
					safeResolve({stdout, stderr, code});
				});

				stream.on('data', (data: Buffer) => {
					stdout += data.toString();
				});

				stream.stderr.on('data', (data: Buffer) => {
					stderr += data.toString();
				});
			});
		});
	}

	/**
	 * Disconnect from SSH server
	 */
	disconnect(): void {
		if (this.connected && this.client) {
			this.client.end();
			this.connected = false;
			this.sftp = null;
		}
	}

	/**
	 * Check if connected
	 */
	isConnected(): boolean {
		return this.connected;
	}
}

/**
 * Parse SSH URL to extract connection info
 * Format: ssh://user@host:port/path
 */
export function parseSSHUrl(url: string): {
	username: string;
	host: string;
	port: number;
	path: string;
} | null {
	const match = url.match(/^ssh:\/\/([^@]+)@([^:]+):(\d+)(.*)$/);
	if (!match) {
		return null;
	}

	return {
		username: match[1]!,
		host: match[2]!,
		port: parseInt(match[3]!, 10),
		path: match[4] || '/',
	};
}

/**
 * Get default SSH key path
 */
export function getDefaultSSHKeyPath(): string {
	return path.join(os.homedir(), '.ssh', 'id_rsa');
}

/**
 * Check if SSH agent is available
 */
export function isSSHAgentAvailable(): boolean {
	return Boolean(process.env['SSH_AUTH_SOCK']);
}
