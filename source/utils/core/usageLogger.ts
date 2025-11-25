import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface UsageLogEntry {
	model: string;
	profileName: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	timestamp: string;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

// 队列来避免并发写入冲突
let writeQueue = Promise.resolve();

async function getActiveProfile(): Promise<string> {
	try {
		const homeDir = os.homedir();
		const jsonPath = path.join(homeDir, '.snow', 'active-profile.json');
		const legacyPath = path.join(homeDir, '.snow', 'active-profile.txt');

		// Try JSON format first
		try {
			const fileContent = await fs.readFile(jsonPath, 'utf-8');
			const data = JSON.parse(fileContent.trim());
			return data.activeProfile || 'default';
		} catch {
			// Fallback to legacy .txt format if JSON doesn't exist
			try {
				const profileName = await fs.readFile(legacyPath, 'utf-8');
				return profileName.trim() || 'default';
			} catch {
				return 'default';
			}
		}
	} catch (error) {
		return 'default';
	}
}

async function getUsageDir(): Promise<string> {
	const homeDir = os.homedir();
	const snowDir = path.join(homeDir, '.snow', 'usage');
	const today = new Date().toISOString().split('T')[0] || ''; // YYYY-MM-DD
	const dateDir = path.join(snowDir, today);

	// 确保目录存在
	try {
		await fs.mkdir(dateDir, {recursive: true});
	} catch (error) {
		// 目录可能已存在，忽略错误
	}

	return dateDir;
}

async function getCurrentLogFile(dateDir: string): Promise<string> {
	try {
		const files = (await fs.readdir(dateDir)).filter(
			f => f.startsWith('usage-') && f.endsWith('.jsonl'),
		);

		if (files.length === 0) {
			return path.join(dateDir, 'usage-001.jsonl');
		}

		// 按文件名排序，获取最新的文件
		files.sort();
		const latestFileName = files[files.length - 1];
		if (!latestFileName) {
			return path.join(dateDir, 'usage-001.jsonl');
		}

		const latestFile = path.join(dateDir, latestFileName);

		// 检查文件大小
		const stats = await fs.stat(latestFile);
		if (stats.size >= MAX_FILE_SIZE) {
			// 创建新文件
			const match = latestFileName.match(/usage-(\d+)\.jsonl/);
			const nextNum = match && match[1] ? parseInt(match[1]) + 1 : 1;
			return path.join(
				dateDir,
				`usage-${String(nextNum).padStart(3, '0')}.jsonl`,
			);
		}

		return latestFile;
	} catch (error) {
		// 如果目录不存在或读取失败，返回默认文件名
		return path.join(dateDir, 'usage-001.jsonl');
	}
}

/**
 * Save usage data to file system
 * This is called directly from API layers to ensure all usage is tracked
 */
export function saveUsageToFile(
	model: string,
	usage: {
		prompt_tokens?: number;
		completion_tokens?: number;
		cache_creation_input_tokens?: number;
		cache_read_input_tokens?: number;
		cached_tokens?: number; // OpenAI Chat/Responses API format
	},
): void {
	// Add to write queue to avoid concurrent writes
	writeQueue = writeQueue
		.then(async () => {
			try {
				const profileName = await getActiveProfile();
				const dateDir = await getUsageDir();
				const logFile = await getCurrentLogFile(dateDir);

				// Extract cache tokens (different API formats)
				const cacheReadTokens =
					usage.cache_read_input_tokens ?? usage.cached_tokens;

				// Only save non-sensitive data: model name, profile, and token counts
				const record: UsageLogEntry = {
					model,
					profileName,
					inputTokens: usage.prompt_tokens || 0,
					outputTokens: usage.completion_tokens || 0,
					...(usage.cache_creation_input_tokens !== undefined && {
						cacheCreationInputTokens: usage.cache_creation_input_tokens,
					}),
					...(cacheReadTokens !== undefined && {
						cacheReadInputTokens: cacheReadTokens,
					}),
					timestamp: new Date().toISOString(),
				};

				// Append to file (JSONL format: one JSON object per line)
				const line = JSON.stringify(record) + '\n';
				await fs.appendFile(logFile, line, 'utf-8');
			} catch (error) {
				console.error('Failed to save usage data:', error);
			}
		})
		.catch(error => {
			console.error('Usage persistence queue error:', error);
		});
}
