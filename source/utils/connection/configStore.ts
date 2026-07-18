import {
	readSettings,
	updateSettings,
} from '../config/unifiedSettings.js';
import type {ConnectionConfig} from './types.js';

/**
 * Connection config storage.
 *
 * Now persisted to `<cwd>/.snow/settings.json` under the `connection` key
 * (previously a standalone `connection.json` file).
 */
export class ConfigStore {
	// Save connection config to file
	async save(config: ConnectionConfig): Promise<void> {
		try {
			updateSettings('project', settings => {
				settings.connection = config;
			});
		} catch {
			// Ignore save errors
		}
	}

	// Load connection config from file
	load(): ConnectionConfig | null {
		try {
			const settings = readSettings('project');
			const conn = settings.connection;
			if (
				conn &&
				typeof conn === 'object' &&
				typeof conn.apiUrl === 'string'
			) {
				return conn;
			}
			return null;
		} catch {
			return null;
		}
	}

	// Check if saved connection config exists
	hasSavedConfig(): boolean {
		try {
			return this.load() !== null;
		} catch {
			return false;
		}
	}

	// Clear saved connection config
	clear(): void {
		try {
			updateSettings('project', settings => {
				delete settings.connection;
			});
		} catch {
			// Ignore clear errors
		}
	}
}
