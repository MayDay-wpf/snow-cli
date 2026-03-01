import * as fs from 'fs';
import * as path from 'path';
import type {ConnectionConfig} from './types.js';

export class ConfigStore {
	private readonly snowDir: string;
	private readonly configPath: string;

	constructor() {
		this.snowDir = path.join(process.cwd(), '.snow');
		this.configPath = path.join(this.snowDir, 'connection.json');
	}

	// Ensure .snow directory exists
	private ensureSnowDir(): void {
		if (!fs.existsSync(this.snowDir)) {
			fs.mkdirSync(this.snowDir, {recursive: true});
		}
	}

	// Save connection config to file
	async save(config: ConnectionConfig): Promise<void> {
		try {
			this.ensureSnowDir();
			// Save full config including password
			fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
		} catch {
			// Ignore save errors
		}
	}

	// Load connection config from file
	load(): ConnectionConfig | null {
		try {
			if (!fs.existsSync(this.configPath)) {
				return null;
			}
			const content = fs.readFileSync(this.configPath, 'utf-8');
			const config = JSON.parse(content) as ConnectionConfig;
			return config;
		} catch {
			return null;
		}
	}

	// Check if saved connection config exists
	hasSavedConfig(): boolean {
		try {
			return fs.existsSync(this.configPath);
		} catch {
			return false;
		}
	}

	// Clear saved connection config
	clear(): void {
		try {
			if (fs.existsSync(this.configPath)) {
				fs.unlinkSync(this.configPath);
			}
		} catch {
			// Ignore clear errors
		}
	}
}
