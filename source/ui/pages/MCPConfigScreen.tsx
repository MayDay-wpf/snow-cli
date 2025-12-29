import {useEffect} from 'react';
import {spawn, execSync} from 'child_process';
import {writeFileSync, readFileSync, existsSync} from 'fs';
import {join} from 'path';
import {homedir, platform} from 'os';
import {getMCPConfig, validateMCPConfig} from '../../utils/config/apiConfig.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
};

const CONFIG_DIR = join(homedir(), '.snow');
const MCP_CONFIG_FILE = join(CONFIG_DIR, 'mcp-config.json');

function checkCommandExists(command: string): boolean {
	if (platform() === 'win32') {
		// Windows: 使用 where 命令检查
		try {
			execSync(`where ${command}`, {
				stdio: 'ignore',
				windowsHide: true,
			});
			return true;
		} catch {
			return false;
		}
	}

	// Unix/Linux/macOS: 使用 command -v
	const shells = ['/bin/sh', '/bin/bash', '/bin/zsh'];
	for (const shell of shells) {
		try {
			execSync(`command -v ${command}`, {
				stdio: 'ignore',
				shell,
				env: process.env,
			});
			return true;
		} catch {
			// Try next shell
		}
	}

	return false;
}

function getSystemEditor(): string | null {
	// 优先使用环境变量指定的编辑器 (所有平台)
	const envEditor = process.env['VISUAL'] || process.env['EDITOR'];
	if (envEditor && checkCommandExists(envEditor)) {
		return envEditor;
	}

	if (platform() === 'win32') {
		// Windows: 按优先级检测常见编辑器
		const windowsEditors = ['notepad++', 'notepad', 'code', 'vim', 'nano'];
		for (const editor of windowsEditors) {
			if (checkCommandExists(editor)) {
				return editor;
			}
		}
		return null;
	}

	// Unix/Linux/macOS: 按优先级检测常见编辑器
	const editors = ['nano', 'vim', 'vi'];
	for (const editor of editors) {
		if (checkCommandExists(editor)) {
			return editor;
		}
	}

	return null;
}

export default function MCPConfigScreen({onBack}: Props) {
	useEffect(() => {
		const openEditor = async () => {
			const config = getMCPConfig();
			writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');

			const editor = getSystemEditor();

			if (!editor) {
				console.error(
					'No text editor found! Please set the EDITOR or VISUAL environment variable.',
				);
				console.error('');
				console.error('Examples:');
				if (platform() === 'win32') {
					console.error('  set EDITOR=notepad');
					console.error('  set EDITOR=code');
					console.error('  set EDITOR=notepad++');
				} else {
					console.error('  export EDITOR=nano');
					console.error('  export EDITOR=vim');
					console.error('  export EDITOR=code');
				}
				console.error('');
				console.error('Or install a text editor:');
				if (platform() === 'win32') {
					console.error('  Windows: Notepad++ or VS Code');
				} else {
					console.error('  Ubuntu/Debian: sudo apt-get install nano');
					console.error('  CentOS/RHEL:   sudo yum install nano');
					console.error('  macOS:         nano is usually pre-installed');
				}
				onBack();
				return;
			}

			// 暂停 Ink 应用以让编辑器接管终端
			if (process.stdin.isTTY) {
				process.stdin.pause();
			}

			const child = spawn(editor, [MCP_CONFIG_FILE], {
				stdio: 'inherit',
			});

			child.on('close', () => {
				// 恢复 Ink 应用
				if (process.stdin.isTTY) {
					process.stdin.resume();
					process.stdin.setRawMode(true);
				}

				// 读取编辑后的配置
				if (existsSync(MCP_CONFIG_FILE)) {
					try {
						const editedContent = readFileSync(MCP_CONFIG_FILE, 'utf8');
						const parsedConfig = JSON.parse(editedContent);
						const validationErrors = validateMCPConfig(parsedConfig);

						if (validationErrors.length === 0) {
							console.log(
								'MCP configuration saved successfully ! Please use `snow` restart!',
							);
						} else {
							console.error(
								'Configuration errors:',
								validationErrors.join(', '),
							);
						}
					} catch (parseError) {
						console.error('Invalid JSON format');
					}
				}

				onBack();
			});

			child.on('error', error => {
				// 恢复 Ink 应用
				if (process.stdin.isTTY) {
					process.stdin.resume();
					process.stdin.setRawMode(true);
				}

				console.error('Failed to open editor:', error.message);
				onBack();
			});
		};

		openEditor();
	}, [onBack]);

	return null;
}
