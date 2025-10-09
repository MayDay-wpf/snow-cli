import { useEffect } from 'react';
import { useApp } from 'ink';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import {
	getOpenAiConfig,
	updateOpenAiConfig,
} from '../../utils/apiConfig.js';
import { SYSTEM_PROMPT } from '../../api/systemPrompt.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
};

const CONFIG_DIR = join(homedir(), '.snow');
const SYSTEM_PROMPT_FILE = join(CONFIG_DIR, 'system-prompt.txt');

function getSystemEditor(): string {
	if (platform() === 'win32') {
		return 'notepad';
	}
	return process.env['EDITOR'] || 'vim';
}

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, { recursive: true });
	}
}

export default function SystemPromptConfigScreen({ onBack }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		const openEditor = async () => {
			ensureConfigDirectory();

			// 读取当前配置的自定义系统提示词，如果为空则使用默认系统提示词
			const config = getOpenAiConfig();
			const currentPrompt = config.systemPrompt || SYSTEM_PROMPT;

			// 写入临时文件供编辑
			writeFileSync(SYSTEM_PROMPT_FILE, currentPrompt, 'utf8');

			const editor = getSystemEditor();

			exit();

			const child = spawn(editor, [SYSTEM_PROMPT_FILE], {
				stdio: 'inherit'
			});

			child.on('close', () => {
				// 读取编辑后的内容
				if (existsSync(SYSTEM_PROMPT_FILE)) {
					try {
						const editedContent = readFileSync(SYSTEM_PROMPT_FILE, 'utf8');

						// 如果编辑后的内容为空或与默认提示词相同，则保存为空（使用默认）
						// 否则保存自定义提示词
						const trimmedContent = editedContent.trim();

						if (trimmedContent === '' || trimmedContent === SYSTEM_PROMPT.trim()) {
							// 保存为空，表示使用默认提示词
							updateOpenAiConfig({ systemPrompt: undefined });
							console.log('System prompt reset to default. Please use `snow` to restart!');
						} else {
							// 保存自定义提示词
							updateOpenAiConfig({ systemPrompt: editedContent });
							console.log('Custom system prompt saved successfully! Please use `snow` to restart!');
						}
					} catch (error) {
						console.error('Failed to read edited content:', error instanceof Error ? error.message : 'Unknown error');
					}
				}

				process.exit(0);
			});

			child.on('error', (error) => {
				console.error('Failed to open editor:', error.message);
				process.exit(1);
			});
		};

		openEditor();
	}, [exit, onBack]);

	return null;
}
