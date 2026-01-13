import {Client, type ConnectConfig, type SFTPWrapper} from 'ssh2';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import {logger} from '../core/logger.js';
import type {SSHConfig} from '../config/workingDirConfig.js';

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
	private client: Client;
	private sftp: SFTPWrapper | null = null;
	private connected = false;

	constructor() {
		this.client = new Client();
	}

	/**
	 * Connect to SSH server
	 */
	async connect(
		config: SSHConfig,
		password?: string,
	): Promise<SSHConnectionResult> {
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

			this.client.on('ready', () => {
				this.connected = true;
				this.client.sftp((err, sftp) => {
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

			this.client.on('error', err => {
				logger.error('SSH connection error', err);
				resolve({
					success: false,
					error: `Connection failed: ${err.message}`,
				});
			});

			this.client.connect(connectConfig);
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
	): Promise<{stdout: string; stderr: string; code: number}> {
		if (!this.connected) {
			throw new Error('Not connected');
		}

		return new Promise((resolve, reject) => {
			this.client.exec(command, (err, stream) => {
				if (err) {
					reject(new Error(`Failed to execute command: ${err.message}`));
					return;
				}

				let stdout = '';
				let stderr = '';

				stream.on('close', (code: number) => {
					resolve({stdout, stderr, code});
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
		if (this.connected) {
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
