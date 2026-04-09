import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {spawn, execSync} from 'child_process';
import {writeFileSync, readFileSync, existsSync, mkdirSync} from 'fs';
import {join} from 'path';
import {platform} from 'os';
import {
	getGlobalMCPConfig,
	getProjectMCPConfig,
	getGlobalMCPConfigFilePath,
	validateMCPConfig,
	type MCPConfigScope,
} from '../../utils/config/apiConfig.js';
import {useI18n} from '../../i18n/I18nContext.js';
import {useTheme} from '../contexts/ThemeContext.js';

type Props = {
	onBack: () => void;
	onSave: () => void;
};

function checkCommandExists(command: string): boolean {
	if (platform() === 'win32') {
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
	const envEditor = process.env['VISUAL'] || process.env['EDITOR'];
	if (envEditor && checkCommandExists(envEditor)) {
		return envEditor;
	}

	if (platform() === 'win32') {
		const windowsEditors = ['notepad++', 'notepad', 'code', 'vim', 'nano'];
		for (const editor of windowsEditors) {
			if (checkCommandExists(editor)) {
				return editor;
			}
		}
		return null;
	}

	const editors = ['nano', 'vim', 'vi'];
	for (const editor of editors) {
		if (checkCommandExists(editor)) {
			return editor;
		}
	}

	return null;
}

function getConfigFilePath(scope: MCPConfigScope): string {
	if (scope === 'project') {
		return join(process.cwd(), '.snow', 'mcp-config.json');
	}
	return getGlobalMCPConfigFilePath();
}

function getConfigByScope(scope: MCPConfigScope) {
	return scope === 'project' ? getProjectMCPConfig() : getGlobalMCPConfig();
}

interface I18nMessages {
	savedSuccess: string;
	configErrors: string;
	reverted: string;
	invalidJson: string;
	scopeProjectLabel: string;
	scopeGlobalLabel: string;
}

function openEditorForScope(
	scope: MCPConfigScope,
	onBack: () => void,
	i18nMessages: I18nMessages,
) {
	const configFilePath = getConfigFilePath(scope);
	const config = getConfigByScope(scope);
	const originalContent = JSON.stringify(config, null, 2);

	const dir = join(configFilePath, '..');
	if (!existsSync(dir)) {
		mkdirSync(dir, {recursive: true});
	}
	writeFileSync(configFilePath, originalContent, 'utf8');

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

	if (process.stdin.isTTY) {
		process.stdin.pause();
	}

	const child = spawn(editor, [configFilePath], {
		stdio: 'inherit',
	});

	child.on('close', () => {
		if (process.stdin.isTTY) {
			process.stdin.resume();
			process.stdin.setRawMode(true);
		}

		if (existsSync(configFilePath)) {
			try {
				const editedContent = readFileSync(configFilePath, 'utf8');
				const parsedConfig = JSON.parse(editedContent);
				const validationErrors = validateMCPConfig(parsedConfig);

				if (validationErrors.length === 0) {
					const scopeLabel =
						scope === 'project'
							? i18nMessages.scopeProjectLabel
							: i18nMessages.scopeGlobalLabel;
					console.log(
						i18nMessages.savedSuccess.replace('{scope}', scopeLabel),
					);
				} else {
					writeFileSync(configFilePath, originalContent, 'utf8');
					console.error(
						i18nMessages.configErrors.replace(
							'{errors}',
							validationErrors.join(', '),
						),
					);
					console.error(i18nMessages.reverted);
				}
			} catch {
				writeFileSync(configFilePath, originalContent, 'utf8');
				console.error(i18nMessages.invalidJson);
			}
		}

		onBack();
	});

	child.on('error', error => {
		if (process.stdin.isTTY) {
			process.stdin.resume();
			process.stdin.setRawMode(true);
		}

		console.error('Failed to open editor:', error.message);
		onBack();
	});
}

export default function MCPConfigScreen({onBack}: Props) {
	const {t} = useI18n();
	const {theme} = useTheme();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [editing, setEditing] = useState(false);

	const options: Array<{label: string; desc: string; scope: MCPConfigScope}> = [
		{
			label: t.mcpConfigScreen.scopeProject,
			desc: '.snow/mcp-config.json',
			scope: 'project',
		},
		{
			label: t.mcpConfigScreen.scopeGlobal,
			desc: '~/.snow/mcp-config.json',
			scope: 'global',
		},
	];

	useInput((_input, key) => {
		if (editing) return;

		if (key.escape) {
			onBack();
			return;
		}

		if (key.upArrow) {
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : options.length - 1));
			return;
		}
		if (key.downArrow) {
			setSelectedIndex(prev => (prev < options.length - 1 ? prev + 1 : 0));
			return;
		}

		if (key.return) {
			setEditing(true);
		}
	});

	useEffect(() => {
		if (!editing) return;
		const scope = options[selectedIndex]!.scope;
		openEditorForScope(scope, onBack, {
			savedSuccess: t.mcpConfigScreen.savedSuccess,
			configErrors: t.mcpConfigScreen.configErrors,
			reverted: t.mcpConfigScreen.reverted,
			invalidJson: t.mcpConfigScreen.invalidJson,
			scopeProjectLabel: t.mcpConfigScreen.scopeProject,
			scopeGlobalLabel: t.mcpConfigScreen.scopeGlobal,
		});
	}, [editing]);

	if (editing) {
		return null;
	}

	return (
		<Box flexDirection="column" padding={1}>
			<Box marginBottom={1}>
				<Text bold color={theme.colors.menuInfo}>
					{t.mcpConfigScreen.title}
				</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				{options.map((opt, idx) => {
					const isSelected = idx === selectedIndex;
					return (
						<Box key={opt.scope} marginBottom={1}>
							<Box flexDirection="column">
								<Text
									color={
										isSelected
											? theme.colors.menuSelected
											: theme.colors.menuNormal
									}
								>
									{isSelected ? '> ' : '  '}
									{opt.label}
								</Text>
								<Box marginLeft={3}>
									<Text color={theme.colors.menuSecondary} dimColor>
										{opt.desc}
									</Text>
								</Box>
							</Box>
						</Box>
					);
				})}
			</Box>

			<Box marginTop={1}>
				<Text color={theme.colors.menuSecondary} dimColor>
					{t.mcpConfigScreen.navigationHint}
				</Text>
			</Box>
		</Box>
	);
}
