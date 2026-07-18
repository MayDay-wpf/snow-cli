import fs from 'fs-extra';
import path from 'path';
import process from 'process';
import {
	readSettings,
	updateSettings,
	type UnifiedSettings,
} from './unifiedSettings.js';

export interface SSHConfig {
	host: string;
	port: number;
	username: string;
	// Authentication method: 'password' | 'privateKey' | 'agent'
	authMethod: 'password' | 'privateKey' | 'agent';
	// For password auth
	password?: string;
	// For privateKey auth
	privateKeyPath?: string;
	passphrase?: string;
}

export interface WorkingDirectory {
	path: string;
	isDefault: boolean;
	addedAt: number;
	// SSH remote directory support
	isRemote?: boolean;
	sshConfig?: SSHConfig;
	// Display name for remote directories
	displayName?: string;
}

export interface WorkingDirConfig {
	directories: WorkingDirectory[];
}

type StoredWorkingDirectory = NonNullable<
	UnifiedSettings['workingDirectories']
>[number];

function createDefaultWorkingDirConfig(): WorkingDirConfig {
	return {
		directories: [
			{
				path: process.cwd(),
				isDefault: true,
				addedAt: Date.now(),
			},
		],
	};
}

function toWorkingDirConfig(
	directories: StoredWorkingDirectory[] | undefined,
): WorkingDirConfig {
	if (!Array.isArray(directories)) {
		return createDefaultWorkingDirConfig();
	}

	return {
		directories: directories as WorkingDirectory[],
	};
}

/**
 * Load working directory configuration from project `.snow/settings.json`.
 *
 * 旧 `.snow/working-dirs.json` 只由启动期 legacyConfigMigration 负责扫描、
 * 合入 settings.json 并删除；这里不再做旧文件兼容读取。
 */
export function loadWorkingDirConfig(): Promise<WorkingDirConfig> {
	const settings = readSettings('project');
	return Promise.resolve(toWorkingDirConfig(settings.workingDirectories));
}

/**
 * Save working directory configuration to project `.snow/settings.json`.
 */
export function saveWorkingDirConfig(
	config: WorkingDirConfig,
): Promise<void> {
	updateSettings('project', settings => {
		settings.workingDirectories = config.directories;
	});

	return Promise.resolve();
}

/**
 * Add a new working directory
 */
export async function addWorkingDirectory(dirPath: string): Promise<boolean> {
	// Validate directory path
	const absolutePath = path.resolve(dirPath);

	try {
		const stats = await fs.stat(absolutePath);
		if (!stats.isDirectory()) {
			return false;
		}
	} catch {
		return false;
	}

	const config = await loadWorkingDirConfig();

	// Check if directory already exists
	if (config.directories.some(d => d.path === absolutePath)) {
		return false;
	}

	// Add new directory
	config.directories.push({
		path: absolutePath,
		isDefault: false,
		addedAt: Date.now(),
	});

	await saveWorkingDirConfig(config);
	return true;
}

/**
 * Remove working directories by paths
 */
export async function removeWorkingDirectories(paths: string[]): Promise<void> {
	const config = await loadWorkingDirConfig();

	// Filter out directories to be removed (except default)
	config.directories = config.directories.filter(
		d => d.isDefault || !paths.includes(d.path),
	);

	await saveWorkingDirConfig(config);
}

/**
 * Get all working directories
 */
export async function getWorkingDirectories(): Promise<WorkingDirectory[]> {
	const config = await loadWorkingDirConfig();
	return config.directories;
}

/**
 * Add a new SSH remote working directory
 */
export async function addSSHWorkingDirectory(
	sshConfig: SSHConfig,
	remotePath: string,
	displayName?: string,
): Promise<boolean> {
	const config = await loadWorkingDirConfig();

	// Generate unique identifier for SSH directory
	const sshIdentifier = `ssh://${sshConfig.username}@${sshConfig.host}:${sshConfig.port}${remotePath}`;

	// Check if directory already exists
	if (config.directories.some(d => d.path === sshIdentifier)) {
		return false;
	}

	// Add new SSH directory
	config.directories.push({
		path: sshIdentifier,
		isDefault: false,
		addedAt: Date.now(),
		isRemote: true,
		sshConfig: {
			host: sshConfig.host,
			port: sshConfig.port,
			username: sshConfig.username,
			authMethod: sshConfig.authMethod,
			privateKeyPath: sshConfig.privateKeyPath,
			password: sshConfig.password, // Store password for remote file access
		},
		displayName:
			displayName || `${sshConfig.username}@${sshConfig.host}:${remotePath}`,
	});

	await saveWorkingDirConfig(config);
	return true;
}
