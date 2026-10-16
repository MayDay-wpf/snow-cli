import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {spawn, execSync} from 'child_process';
import {
	writeFileSync,
	readFileSync,
	existsSync,
	mkdirSync,
	unlinkSync,
} from 'fs';
import {join} from 'path';
import {platform} from 'os';
import {
	getGlobalMCPConfig,
	getProjectMCPConfig,
	updateMCPConfig,
	validateMCPConfig,
	type MCPConfigScope,
} from '../../utils/config/apiConfig.js';
import {useI18n} from '../../i18n/I18nContext.js';
import {useTheme} from '../contexts/ThemeContext.js';
import {useTerminalTitle} from '../../hooks/ui/useTerminalTitle.js';
import {logger} from '../../utils/core/logger.js';

const pageLog = logger.child('ui:pages');

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
		} catch (error) {
			pageLog.debug('where command check failed', {error, command});
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
		} catch (error) {
			pageLog.debug('shell command check failed', {error, command, shell});
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

/**
 * The "config file" for MCP is now a section inside the unified `settings.json`.
 * For the in-IDE editor flow we keep using a sidecar draft file so the user can
 * still edit only the MCP portion — the parsed result is written back through
 * `updateMCPConfig` (see openEditorForScope below), which targets settings.json.
 *
 * [MCP 2026-07-28] Protocol notes for MCP server configuration:
 * - HTTP servers now receive MCP-Protocol-Version: 2026-07-28 header (SEP-2575)
 * - Legacy HTTP+SSE transport is officially deprecated (SEP-2577), removal ~2027-07.
 *   New server configs should use "type": "http" (Streamable HTTP) instead of SSE.
 * - Roots, Sampling, and Logging capabilities are deprecated (SEP-2577) with a
 *   12-month minimum window. New implementations should not adopt them.
 * - server/discover RPC is available for optional upfront capability discovery.
 * - List responses (tools/list etc.) may carry ttlMs/cacheScope cache hints (SEP-2549).
 * - MRTR (Multi Round-Trip Requests) replaces server-initiated elicitation (SEP-2322).
 */
function getConfigFilePath(scope: MCPConfigScope): string {
	if (scope === 'project') {
		return join(process.cwd(), '.snow', 'mcp-config.draft.json');
	}
	return join(process.cwd(), '.snow', 'mcp-config.global.draft.json');
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
		const examples =
			platform() === 'win32'
				? '  set EDITOR=notepad\n  set EDITOR=code\n  set EDITOR=notepad++'
				: '  export EDITOR=nano\n  export EDITOR=vim\n  export EDITOR=code';
		const recommendations =
			platform() === 'win32'
				? '  Windows: Notepad++ or VS Code'
				: '  Ubuntu/Debian: sudo apt-get install nano\n  CentOS/RHEL:   sudo yum install nano\n  macOS:         nano is usually pre-installed';

		pageLog.error(
			`No text editor found! Please set the EDITOR or VISUAL environment variable.\n\nExamples:\n${examples}\n\nOr install a text editor:\n${recommendations}`,
		);
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
					// Persist parsed MCP config back into the unified settings.json
					updateMCPConfig(parsedConfig, scope);
					const scopeLabel =
						scope === 'project'
							? i18nMessages.scopeProjectLabel
							: i18nMessages.scopeGlobalLabel;
					pageLog.info(i18nMessages.savedSuccess.replace('{scope}', scopeLabel));
				} else {
					pageLog.error(
						i18nMessages.configErrors.replace(
							'{errors}',
							validationErrors.join(', '),
						),
					);
					pageLog.error(i18nMessages.reverted);
				}
			} catch (error) {
				pageLog.error(i18nMessages.invalidJson, error);
			}

			// The draft file only exists as a scratch area for the external editor.
			// Clean it up so it doesn't show up in the project tree.
			try {
				unlinkSync(configFilePath);
			} catch (error) {
				pageLog.debug('Failed to unlink temporary config file', {error});
			}
		}

		onBack();
	});

	child.on('error', error => {
		if (process.stdin.isTTY) {
			process.stdin.resume();
			process.stdin.setRawMode(true);
		}

		pageLog.error('Failed to open editor', error);
		onBack();
	});
}

export default function MCPConfigScreen({onBack}: Props) {
	const {t} = useI18n();
	useTerminalTitle(`Snow CLI - ${t.mcpConfigScreen.title}`);
	const {theme} = useTheme();
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [editing, setEditing] = useState(false);

	const options: Array<{label: string; desc: string; scope: MCPConfigScope}> = [
		{
			label: t.mcpConfigScreen.scopeProject,
			desc: '.snow/settings.json (mcpServers)',
			scope: 'project',
		},
		{
			label: t.mcpConfigScreen.scopeGlobal,
			desc: '~/.snow/settings.json (mcpServers)',
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
									{isSelected ? '❯ ' : '  '}
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
