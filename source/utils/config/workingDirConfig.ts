import fs from 'fs-extra';
import path from 'path';
import process from 'process';
import {logger} from '../core/logger.js';

const SNOW_DIR = '.snow';
const WORKING_DIR_FILE = 'working-dirs.json';

export interface WorkingDirectory {
	path: string;
	isDefault: boolean;
	addedAt: number;
}

export interface WorkingDirConfig {
	directories: WorkingDirectory[];
}

/**
 * Get the .snow directory path
 */
function getSnowDirPath(): string {
	return path.join(process.cwd(), SNOW_DIR);
}

/**
 * Get the working directory config file path
 */
function getConfigFilePath(): string {
	return path.join(getSnowDirPath(), WORKING_DIR_FILE);
}

/**
 * Ensure .snow directory exists
 */
async function ensureSnowDir(): Promise<void> {
	const snowDir = getSnowDirPath();
	try {
		await fs.ensureDir(snowDir);
	} catch (error) {
		logger.error('Failed to create .snow directory', error);
		throw error;
	}
}

/**
 * Load working directory configuration
 */
export async function loadWorkingDirConfig(): Promise<WorkingDirConfig> {
	const configPath = getConfigFilePath();

	try {
		if (await fs.pathExists(configPath)) {
			const content = await fs.readFile(configPath, 'utf-8');
			const config = JSON.parse(content) as WorkingDirConfig;
			return config;
		}
	} catch (error) {
		logger.error('Failed to load working directory config', error);
	}

	// Return default config with current directory
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

/**
 * Save working directory configuration
 */
export async function saveWorkingDirConfig(
	config: WorkingDirConfig,
): Promise<void> {
	await ensureSnowDir();
	const configPath = getConfigFilePath();

	try {
		await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
	} catch (error) {
		logger.error('Failed to save working directory config', error);
		throw error;
	}
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
