import {useCallback, useRef} from 'react';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

interface UsageData {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

export const useUsagePersistence = () => {
	// 使用队列来避免并发写入冲突
	const writeQueueRef = useRef<Promise<void>>(Promise.resolve());

	const getActiveProfile = useCallback(async (): Promise<string> => {
		try {
			const homeDir = os.homedir();
			const profilePath = path.join(homeDir, '.snow', 'active-profile.txt');
			const profileName = await fs.readFile(profilePath, 'utf-8');
			return profileName.trim();
		} catch (error) {
			return 'default';
		}
	}, []);

	const getUsageDir = useCallback(async (): Promise<string> => {
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
	}, []);

	const getCurrentLogFile = useCallback(
		async (dateDir: string): Promise<string> => {
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
		},
		[],
	);

	const saveUsage = useCallback(
		(usageData: UsageData) => {
			// 将写入操作加入队列，避免并发写入
			writeQueueRef.current = writeQueueRef.current
				.then(async () => {
					try {
						const profileName = await getActiveProfile();
						const dateDir = await getUsageDir();
						const logFile = await getCurrentLogFile(dateDir);

						// 只保存非敏感数据：模型名、配置名和 token 使用量
						const record = {
							model: usageData.model,
							profileName,
							inputTokens: usageData.inputTokens,
							outputTokens: usageData.outputTokens,
							...(usageData.cacheCreationInputTokens !== undefined && {
								cacheCreationInputTokens: usageData.cacheCreationInputTokens,
							}),
							...(usageData.cacheReadInputTokens !== undefined && {
								cacheReadInputTokens: usageData.cacheReadInputTokens,
							}),
							timestamp: new Date().toISOString(),
						};

						// 追加到文件（JSONL格式：每行一个JSON对象）
						const line = JSON.stringify(record) + '\n';
						await fs.appendFile(logFile, line, 'utf-8');

						// console.log(`Usage data saved to: ${logFile}`);
					} catch (error) {
						console.error('Failed to save usage data:', error);
					}
				})
				.catch(error => {
					console.error('Usage persistence queue error:', error);
				});
		},
		[getActiveProfile, getUsageDir, getCurrentLogFile],
	);

	// Create a usage saver callback that can be passed to handleConversationWithTools
	const createUsageSaver = useCallback(
		(model: string) => {
			return (usage: any) => {
				if (usage) {
					saveUsage({
						model,
						inputTokens: usage.prompt_tokens || 0,
						outputTokens: usage.completion_tokens || 0,
						cacheCreationInputTokens: usage.cache_creation_input_tokens,
						cacheReadInputTokens: usage.cache_read_input_tokens,
					});
				}
			};
		},
		[saveUsage],
	);

	return {saveUsage, createUsageSaver};
};
