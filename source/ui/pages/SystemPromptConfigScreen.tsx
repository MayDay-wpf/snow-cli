import {useEffect} from 'react';
import {useApp} from 'ink';
import {spawn} from 'child_process';
import {writeFileSync, readFileSync, existsSync, mkdirSync} from 'fs';
import {join} from 'path';
import {homedir, platform} from 'os';
import {getSystemPrompt} from '../../api/systemPrompt.js';

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
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

export default function SystemPromptConfigScreen({onBack}: Props) {
	const {exit} = useApp();

	useEffect(() => {
		const openEditor = async () => {
			ensureConfigDirectory();

			// 读取系统提示词文件，如果不存在则使用默认系统提示词
			let currentPrompt = getSystemPrompt();
			if (existsSync(SYSTEM_PROMPT_FILE)) {
				try {
					currentPrompt = readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
				} catch {
					// 读取失败，使用默认
					currentPrompt = getSystemPrompt();
				}
			}

			// 写入临时文件供编辑
			writeFileSync(SYSTEM_PROMPT_FILE, currentPrompt, 'utf8');

			const editor = getSystemEditor();

			exit();

			const child = spawn(editor, [SYSTEM_PROMPT_FILE], {
				stdio: 'inherit',
			});

			child.on('close', () => {
				// 读取编辑后的内容
				if (existsSync(SYSTEM_PROMPT_FILE)) {
					try {
						const editedContent = readFileSync(SYSTEM_PROMPT_FILE, 'utf8');
						const trimmedContent = editedContent.trim();

						if (
							trimmedContent === '' ||
							trimmedContent === getSystemPrompt().trim()
						) {
							// 内容为空或与默认相同，删除文件，使用默认提示词
							try {
								const fs = require('fs');
								fs.unlinkSync(SYSTEM_PROMPT_FILE);
								console.log(
									'System prompt reset to default. Please use `snow` to restart!',
								);
							} catch {
								// 删除失败，保存空内容
								writeFileSync(SYSTEM_PROMPT_FILE, '', 'utf8');
								console.log(
									'System prompt reset to default. Please use `snow` to restart!',
								);
							}
						} else {
							// 保存自定义提示词到文件
							writeFileSync(SYSTEM_PROMPT_FILE, editedContent, 'utf8');
							console.log(
								'Custom system prompt saved successfully! Please use `snow` to restart!',
							);
						}
					} catch (error) {
						console.error(
							'Failed to save system prompt:',
							error instanceof Error ? error.message : 'Unknown error',
						);
					}
				}

				process.exit(0);
			});

			child.on('error', error => {
				console.error('Failed to open editor:', error.message);
				process.exit(1);
			});
		};

		openEditor();
	}, [exit, onBack]);

	return null;
}
