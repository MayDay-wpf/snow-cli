import {exec} from 'child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'fs';
import {homedir} from 'os';
import {join} from 'path';
import {promisify} from 'util';

const execAsync = promisify(exec);

export interface LSPServerConfig {
	command: string;
	args: string[];
	fileExtensions: string[];
	installCommand?: string;
	initializationOptions?: any;
}

export interface LSPConfigFile {
	schemaVersion: 1;
	servers: Record<string, LSPServerConfig>;
}

const CONFIG_DIR = join(homedir(), '.snow');
const LSP_CONFIG_FILE = join(CONFIG_DIR, 'lsp-config.json');

export const DEFAULT_LSP_SERVERS: Record<string, LSPServerConfig> = {
	typescript: {
		command: 'typescript-language-server',
		args: ['--stdio'],
		fileExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
		installCommand: 'npm install -g typescript-language-server typescript',
		initializationOptions: {},
	},
	python: {
		command: 'pylsp',
		args: [],
		fileExtensions: ['.py'],
		installCommand: 'pip install python-lsp-server',
		initializationOptions: {},
	},
	go: {
		command: 'gopls',
		args: [],
		fileExtensions: ['.go'],
		installCommand: 'go install golang.org/x/tools/gopls@latest',
		initializationOptions: {},
	},
	rust: {
		command: 'rust-analyzer',
		args: [],
		fileExtensions: ['.rs'],
		installCommand: 'rustup component add rust-analyzer',
		initializationOptions: {},
	},
	java: {
		command: 'jdtls',
		args: [],
		fileExtensions: ['.java'],
		installCommand: 'brew install jdtls',
		initializationOptions: {},
	},
	csharp: {
		command: 'omnisharp',
		args: ['--languageserver'],
		fileExtensions: ['.cs'],
		installCommand: 'brew install omnisharp',
		initializationOptions: {},
	},
};

export const LSP_SERVERS = DEFAULT_LSP_SERVERS;

function ensureConfigDirectory(): void {
	if (!existsSync(CONFIG_DIR)) {
		mkdirSync(CONFIG_DIR, {recursive: true});
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	return value.filter((item): item is string => typeof item === 'string');
}

function parseServerConfig(value: unknown): LSPServerConfig | null {
	if (!isRecord(value)) {
		return null;
	}

	const commandValue = value['command'];
	const installCommandValue = value['installCommand'];
	const argsValue = value['args'];
	const fileExtensionsValue = value['fileExtensions'];
	const initializationOptionsValue = value['initializationOptions'];

	const command = typeof commandValue === 'string' ? commandValue : undefined;
	const installCommand =
		typeof installCommandValue === 'string' ? installCommandValue : undefined;
	const args = toStringArray(argsValue);
	const fileExtensions = toStringArray(fileExtensionsValue);

	if (!command || !args || !fileExtensions) {
		return null;
	}

	const serverConfig: LSPServerConfig = {
		command,
		args,
		fileExtensions,
	};

	if (installCommand) {
		serverConfig.installCommand = installCommand;
	}

	if ('initializationOptions' in value) {
		serverConfig.initializationOptions = initializationOptionsValue;
	}

	return serverConfig;
}

function parseServersConfig(
	value: unknown,
): Record<string, LSPServerConfig> | null {
	if (!isRecord(value)) {
		return null;
	}

	const servers: Record<string, LSPServerConfig> = {};
	for (const [language, serverValue] of Object.entries(value)) {
		const serverConfig = parseServerConfig(serverValue);
		if (!serverConfig) {
			return null;
		}

		servers[language] = serverConfig;
	}

	return Object.keys(servers).length > 0 ? servers : null;
}

function parseLspConfigFile(
	value: unknown,
): Record<string, LSPServerConfig> | null {
	if (!isRecord(value)) {
		return null;
	}

	if (value['schemaVersion'] !== 1) {
		return parseServersConfig(value);
	}

	const serversValue = value['servers'];
	return parseServersConfig(serversValue);
}

function getDefaultConfigFile(): LSPConfigFile {
	return {
		schemaVersion: 1,
		servers: DEFAULT_LSP_SERVERS,
	};
}

function loadServersFromDisk(): Record<string, LSPServerConfig> {
	ensureConfigDirectory();

	if (!existsSync(LSP_CONFIG_FILE)) {
		try {
			writeFileSync(
				LSP_CONFIG_FILE,
				JSON.stringify(getDefaultConfigFile(), null, 2),
				'utf8',
			);
		} catch (error) {
			console.debug('Failed to write default lsp-config.json:', error);
		}

		return DEFAULT_LSP_SERVERS;
	}

	try {
		const configText = readFileSync(LSP_CONFIG_FILE, 'utf8');
		const parsed: unknown = JSON.parse(configText);

		const serversFromConfig = parseLspConfigFile(parsed);
		return serversFromConfig ?? DEFAULT_LSP_SERVERS;
	} catch (error) {
		console.debug('Failed to read lsp-config.json, using defaults:', error);
		return DEFAULT_LSP_SERVERS;
	}
}

export class LSPServerRegistry {
	private static installedServers: Map<string, boolean> = new Map();
	private static serversCache: Record<string, LSPServerConfig> | undefined;

	private static getServers(): Record<string, LSPServerConfig> {
		if (!this.serversCache) {
			this.serversCache = loadServersFromDisk();
		}

		return this.serversCache;
	}

	static getServerForFile(filePath: string): {
		language: string;
		config: LSPServerConfig;
	} | null {
		const ext = filePath.slice(filePath.lastIndexOf('.'));

		for (const [language, config] of Object.entries(this.getServers())) {
			if (config.fileExtensions.includes(ext)) {
				return {language, config};
			}
		}

		return null;
	}

	static getConfig(language: string): LSPServerConfig | null {
		return this.getServers()[language] || null;
	}

	static getInstallCommand(language: string): string | null {
		return this.getServers()[language]?.installCommand || null;
	}

	static async isServerInstalled(language: string): Promise<boolean> {
		if (this.installedServers.has(language)) {
			return this.installedServers.get(language)!;
		}

		const config = this.getConfig(language);
		if (!config) {
			return false;
		}

		try {
			const {command} = config;
			const testCommand =
				process.platform === 'win32' ? `where ${command}` : `which ${command}`;

			await execAsync(testCommand);
			this.installedServers.set(language, true);
			return true;
		} catch {
			this.installedServers.set(language, false);
			return false;
		}
	}

	static clearCache(): void {
		this.installedServers.clear();
		this.serversCache = undefined;
	}
}
