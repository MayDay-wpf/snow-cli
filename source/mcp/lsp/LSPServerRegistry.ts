import {promisify} from 'util';
import {exec} from 'child_process';

const execAsync = promisify(exec);

export interface LSPServerConfig {
	command: string;
	args: string[];
	fileExtensions: string[];
	installCommand: string;
	initializationOptions?: any;
}

export const LSP_SERVERS: Record<string, LSPServerConfig> = {
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

export class LSPServerRegistry {
	private static installedServers: Map<string, boolean> = new Map();

	static getServerForFile(filePath: string): {
		language: string;
		config: LSPServerConfig;
	} | null {
		const ext = filePath.slice(filePath.lastIndexOf('.'));

		for (const [language, config] of Object.entries(LSP_SERVERS)) {
			if (config.fileExtensions.includes(ext)) {
				return {language, config};
			}
		}

		return null;
	}

	static getConfig(language: string): LSPServerConfig | null {
		return LSP_SERVERS[language] || null;
	}

	static getInstallCommand(language: string): string | null {
		return LSP_SERVERS[language]?.installCommand || null;
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
	}
}
