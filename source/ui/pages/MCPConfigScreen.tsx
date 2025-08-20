import { useEffect } from 'react';
import { useApp } from 'ink';
import { spawn } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir, platform } from 'os';
import {
	getMCPConfig,
	validateMCPConfig,
} from '../../utils/apiConfig.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
};

const CONFIG_DIR = join(homedir(), '.snow');
const MCP_CONFIG_FILE = join(CONFIG_DIR, 'mcp-config.json');

function getSystemEditor(): string {
	if (platform() === 'win32') {
		return 'notepad';
	}
	return process.env['EDITOR'] || 'vim';
}

export default function MCPConfigScreen({ onBack }: Props) {
	const { exit } = useApp();

	useEffect(() => {
		const openEditor = async () => {
			const config = getMCPConfig();
			writeFileSync(MCP_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
			
			const editor = getSystemEditor();
			
			exit();
			
			const child = spawn(editor, [MCP_CONFIG_FILE], {
				stdio: 'inherit'
			});

			child.on('close', () => {
				// 读取编辑后的配置
				if (existsSync(MCP_CONFIG_FILE)) {
					try {
						const editedContent = readFileSync(MCP_CONFIG_FILE, 'utf8');
						const parsedConfig = JSON.parse(editedContent);
						const validationErrors = validateMCPConfig(parsedConfig);
						
						if (validationErrors.length === 0) {
							console.log('MCP configuration saved successfully ! Please use `snow` restart!');
						} else {
							console.error('Configuration errors:', validationErrors.join(', '));
						}
					} catch (parseError) {
						console.error('Invalid JSON format');
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